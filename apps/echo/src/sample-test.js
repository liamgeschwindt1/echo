import { PRIORITY_RANK, priorityFor } from '@echo/shared/catalogue.js';

export function expectedNight(clip, cat) {
  if (!clip.labels.length) return null;
  const levels = new Set(clip.labels.map((label) => priorityFor(cat, label, 'night')));
  return levels.size === 1 ? [...levels][0] : null;
}

export function scoreSamples(test, rows, periods, cat) {
  return test.clips.map((clip) => {
    const start = test.started_ms + clip.start_s * 1000;
    const end = test.started_ms + clip.end_s * 1000;
    const overlapping = (a, b) => a < end && b > start;
    const models = {};
    for (const model of ['yamnet', 'clap']) {
      const readings = rows.filter((r) => r.model === model && overlapping(Date.parse(r.timestamp) - r.window_s * 1000, Date.parse(r.timestamp)));
      const accepted = model === 'yamnet' ? clip.yamnet : clip.labels;
      const hits = (n) => readings.filter((r) => Array.from({ length: n }, (_, i) => i + 1)
        .some((i) => accepted.includes(r[`top${i}_label`]) && r[`top${i}_score`] > 0)).length;
      models[model] = {
        windows: readings.length,
        top1_windows: hits(1),
        top5_windows: hits(5),
        recognition: !readings.length ? 'no readings' : !accepted.length ? 'unmapped' : hits(1) ? 'top 1' : hits(5) ? 'top 5' : 'absent'
      };
    }
    const detected = periods.filter((p) => overlapping(Date.parse(p.start), Date.parse(p.end)));
    const max = detected.reduce((best, p) => PRIORITY_RANK[p.default_priority] > PRIORITY_RANK[best] ? p.default_priority : best, 'ignore');
    const expected = expectedNight(clip, cat);
    const complete = test.finished_ms !== null && test.finished_ms >= end;
    const hasReadings = Object.values(models).some((m) => m.windows > 0);
    return {
      id: clip.id, name: clip.name, complete, has_readings: hasReadings, expected_night: expected,
      priority_cap: clip.max_priority, observed_priority: max,
      priority_match: !complete || !expected || !hasReadings ? null : expected === 'ignore'
        ? max === 'ignore'
        : detected.some((p) => clip.labels.includes(p.label) && p.default_priority === expected),
      excessive_priority: !complete || !clip.max_priority ? null : PRIORITY_RANK[max] > PRIORITY_RANK[clip.max_priority],
      detected: detected.map((p) => ({ id: p.id, label: p.label, priority: p.default_priority })),
      models
    };
  });
}

export function normalizeMono(buffer, targetPeak = 10 ** (-6 / 20)) {
  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < mono.length; i++) mono[i] += data[i] / buffer.numberOfChannels;
  }
  let peak = 0;
  for (const sample of mono) peak = Math.max(peak, Math.abs(sample));
  if (!peak) throw new Error('Sample is silent');
  const gain = targetPeak / peak;
  for (let i = 0; i < mono.length; i++) mono[i] *= gain;
  return { samples: mono, gain };
}

export async function prepareSamples(ctx, manifest, files, windowS, onProgress) {
  const gap = Math.max(3, windowS + 3);
  const clips = [];
  let cursor = gap;
  for (const clip of manifest.clips) {
    const file = files.get(clip.id);
    if (!clip.file && !file) continue;
    onProgress(`Preparing ${clip.name}...`);
    let bytes;
    if (file) bytes = await file.arrayBuffer();
    else {
      const response = await fetch(`/test-audio/${clip.file}`);
      if (!response.ok) throw new Error(`${clip.name}: HTTP ${response.status}. Run npm run fetch-test-audio.`);
      bytes = await response.arrayBuffer();
    }
    const decoded = await ctx.decodeAudioData(bytes);
    if (decoded.duration < 0.1 || decoded.duration > 15) throw new Error(`${clip.name}: use a clip between 0.1 and 15 seconds`);
    const { samples, gain } = normalizeMono(decoded);
    const start = Math.round(cursor * ctx.sampleRate);
    clips.push({
      ...clip, source: file ? `Local file: ${file.name}` : manifest.source,
      start_s: start / ctx.sampleRate, end_s: (start + samples.length) / ctx.sampleRate,
      gain, samples
    });
    cursor = (start + samples.length) / ctx.sampleRate + gap;
  }
  if (!clips.length) throw new Error('No samples are available');
  const track = ctx.createBuffer(1, Math.ceil(cursor * ctx.sampleRate), ctx.sampleRate);
  for (const clip of clips) track.copyToChannel(clip.samples, 0, Math.round(clip.start_s * ctx.sampleRate));
  return {
    buffer: track,
    test: {
      manifest_version: manifest.version, dataset_revision: manifest.revision,
      normalization: 'Mono, peak -6 dBFS; original duration, no tiling',
      time_of_day: 'night', gap_s: gap, duration_s: track.duration,
      started_ms: null, finished_ms: null,
      missing: manifest.clips.filter((c) => !c.file && !files.has(c.id)).map((c) => c.id),
      clips: clips.map(({ samples, ...clip }) => clip)
    }
  };
}
