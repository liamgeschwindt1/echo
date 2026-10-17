// Placeholder levels at 1 m (dB SPL); confirmed: false until measured.
export const PLACEHOLDER_LEVELS = {
  gunshot: 140, glass_breaking: 100, scream: 110, car_horn: 105, dog: 100, door_wood_knock: 85, chainsaw: 110, engine: 95,
  airplane: 120, rain: 70, footsteps: 75, fireworks: 130, thunderstorm: 120, crying_baby: 100, laughing: 90
};

export async function loadManifest() {
  const res = await fetch('/test-audio/manifest.json');
  const m = await res.json();
  return m.clips.map((c) => ({ id: c.id, name: c.name, file: c.file, level_1m_db: PLACEHOLDER_LEVELS[c.id] ?? 90, confirmed: false, labels: c.labels }));
}

// OfflineAudioContext decodes straight to the render rate.
export async function decodeToMono(arrayBuffer, rate = 48000) {
  const ctx = new OfflineAudioContext(1, 1, rate);
  const buf = await ctx.decodeAudioData(arrayBuffer);
  const out = new Float32Array(buf.length);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < out.length; i++) out[i] += d[i] / buf.numberOfChannels;
  }
  return out;
}

export async function fetchClip(entry, rate) {
  const res = await fetch(`/test-audio/${entry.file}`);
  if (!res.ok) throw new Error(`clip ${entry.id} missing (${res.status}); run "npm run fetch-test-audio"`);
  return decodeToMono(await res.arrayBuffer(), rate);
}
