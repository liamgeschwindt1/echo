import { readFile, writeFile, statfs } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { defaultScenario, newNode, newSource, renderLengthS } from '../packages/sim-core/src/scenario.js';
import { renderScenario } from '../packages/sim-core/src/render.js';
import { analyseMeasured } from '../packages/sim-core/src/measured.js';
import { loadBenchmarkClips, codeManifest } from '../packages/sim-core/src/benchmark/node.js';
import { classify } from '../packages/sim-core/src/label.js';
import { loadNodeRunners, closeNodeRunners } from '../packages/sim-core/src/node-models.js';
import { speedOfSound } from '../packages/sim-core/src/physics.js';
import { audioHash } from '../packages/sim-core/src/benchmark/cache.js';

const { values } = parseArgs({ options: { 'discard-renders': { type: 'boolean' } } });
if (!values['discard-renders']) throw new Error('This sequential study requires --discard-renders (no raw audio retained)');
const root = new URL('../', import.meta.url);
const specBytes = await readFile(new URL('docs/experiments/round2-labelling.json', root)), spec = JSON.parse(specBytes);
const audioManifest = JSON.parse(await readFile(new URL('packages/assets/public/test-audio/manifest.json', root)));
const clips = await loadBenchmarkClips(spec.clips);
const manifest = await codeManifest();
const output = new URL('baselines/round2-labelling.json', root);
const events = [], oracles = [], renders = [];
const report = { kind: 'echo-labelling-benchmark', schema: manifest.schema, spec,
  manifest: { ...manifest, preregistration_sha256: createHash('sha256').update(specBytes).digest('hex'), cache_policy: 'discard-render-immediately', complete: false },
  events, oracles, renders, summary: null };
const { cat, runners, models } = await loadNodeRunners();
report.models = models;
report.manifest.audio = await audioHash(clips);
report.manifest.model_files = await Promise.all([
  'model/yamnet.tflite', `models/${models.clap.id}/onnx/audio_model_quantized.onnx`,
  'config/labels.json', 'config/priorities.json', 'config/clap_text_embeddings.json'
].map(async (file) => ({ file, sha256: createHash('sha256').update(await readFile(new URL(`packages/assets/public/${file}`, root))).digest('hex') })));
try {
  for (const clip of spec.clips) for (const range of spec.ranges_m) for (const noise of spec.noise_floors_db_spl) for (const seed of spec.seeds) {
    const disk = await statfs(process.cwd());
    if (1 - disk.bavail / disk.blocks > 0.85) throw new Error('Disk exceeds 85%; not starting another render');
    const scenario = defaultScenario();
    scenario.nodes = spec.nodes.map((p, i) => ({ ...newNode(`n${i + 1}`, p[0], p[1]), position: p }));
    scenario.sources = [{ ...newSource('s1', clip, 0, range, 105), start_s: 1 }];
    scenario.buildings = [];
    Object.assign(scenario.settings, { ground_reflectivity: 0, reflection_order: 0, diffraction_order: 0, noise_floor_db_spl: noise, seed });
    const duration = clips.get(clip).length / scenario.settings.render_sample_rate;
    const started = performance.now();
    const rendered = renderScenario(scenario, clips, { lengthS: renderLengthS(scenario, new Map([[clip, duration]])) + 1 });
    const render_ms = performance.now() - started;
    const measured = analyseMeasured({ nodes: scenario.nodes, settings: scenario.settings, buildings: [] }, {
      sample_rate: rendered.sample_rate, nodes: rendered.nodes.map(({ id, mics, mic_positions }) => ({ id, mics, mic_positions }))
    }, { c: speedOfSound(scenario.settings.temperature_c) });
    const accepted = audioManifest.clips.find((c) => c.id === clip).labels;
    for (let ni = 0; ni < rendered.nodes.length; ni++) {
      const base = { clip, range_m: range, node_range_m: Math.hypot(range, 15), noise_floor_db_spl: noise, seed, node_id: scenario.nodes[ni].id };
      const activity = rendered.activity[ni];
      const signalPower = Math.max(...activity.per_source[0].detection);
      const snr_db = signalPower > 0 && activity.noise_detection_power > 0 ? 10 * Math.log10(signalPower / activity.noise_detection_power) : null;
      oracles.push({ ...base, label: accepted[0] ?? null, correct: accepted.length ? true : null, note: 'Known label and source presence; not measured detection' });
      for (const normalisation of spec.input_normalisation) {
        const signal = rendered.nodes[ni].mics[0];
        let power = 0;
        for (const x of signal) power += x * x;
        const rms = Math.sqrt(power / signal.length);
        if (!(rms > 0)) throw new Error('Cannot normalise a silent model input');
        const gain = normalisation === 'raw' ? 1 : 0.1 / rms;
        const input = normalisation === 'raw' ? signal : Float32Array.from(signal, (x) => x * gain);
        const modelStart = performance.now();
        const prediction = await classify(input, rendered.sample_rate, 'clap5', { cat, runners });
        const period = [...prediction.periods].filter((p) => p.label).sort((a, b) => b.confidence - a.confidence || a.start_s - b.start_s)[0];
        const associations = period ? measured.fixes.flatMap((f, fi) => f.node_tracks.some((key) => {
          const [nodeIndex, ti] = key.split(':').map(Number);
          if (nodeIndex !== ni) return false;
          const tr = measured.nodes[ni].tracks[ti];
          return tr.windows[0].t_s <= period.end_s && tr.windows.at(-1).t_s >= period.start_s;
        }) ? [fi] : []) : [];
        events.push({
          ...base, normalisation, snr_db, input_rms_dbfs: 20 * Math.log10(rms), applied_gain_db: 20 * Math.log10(gain),
          label: period?.label ?? null, confidence: period?.confidence ?? null, correct: accepted.length ? accepted.includes(period?.label) : null,
          period_s: period ? [period.start_s, period.end_s] : null, associated_measured_fix_indices: associations,
          measured_fix_count: measured.fixes.length, model_ms: performance.now() - modelStart
        });
      }
    }
    renders.push({ clip, range_m: range, noise_floor_db_spl: noise, seed, render_ms });
    await writeFile(output, JSON.stringify(report, null, 2) + '\n');
    console.log(`${renders.length}/${spec.expected_renders} ${clip} range=${range} noise=${noise} seed=${seed}`);
  }
  if (renders.length !== spec.expected_renders || events.length !== spec.expected_model_events || oracles.length !== spec.expected_oracle_events) throw new Error('Incomplete preregistered labelling population');
  const keys = [...new Set(events.map((e) => `${e.clip}|${e.range_m}|${e.noise_floor_db_spl}|${e.normalisation}`))];
  report.summary = keys.map((key) => {
    const subset = events.filter((e) => `${e.clip}|${e.range_m}|${e.noise_floor_db_spl}|${e.normalisation}` === key);
    return { key, n: subset.length, accuracy: subset.filter((e) => e.correct).length / subset.length,
      localised_label_rate: subset.filter((e) => e.correct && e.associated_measured_fix_indices.length).length / subset.length,
      mean_snr_db: subset.every((e) => Number.isFinite(e.snr_db)) ? subset.reduce((s, e) => s + e.snr_db, 0) / subset.length : null };
  });
  report.snr_bins = spec.input_normalisation.flatMap((normalisation) => [[-Infinity, 0], [0, 10], [10, 20], [20, Infinity]].map(([low, high]) => {
    const subset = events.filter((e) => e.normalisation === normalisation && Number.isFinite(e.snr_db) && e.snr_db >= low && e.snr_db < high);
    return { normalisation, min_snr_db: Number.isFinite(low) ? low : null, max_snr_db: Number.isFinite(high) ? high : null,
      n: subset.length, accuracy: subset.length ? subset.filter((e) => e.correct).length / subset.length : null };
  }));
  report.manifest.complete = true;
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
} finally { closeNodeRunners(); }
