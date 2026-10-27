// Acceptance 7 and 8: overlap case and the SNR comparison, with the real ESC-50 clips.
import { readFileSync } from 'node:fs';
import { validateScenario } from '../src/scenario.js';
import { renderScenario } from '../src/render.js';
import { analyseScenario } from '../src/analyse.js';
import { renderLengthS } from '../src/scenario.js';
import { rfft } from '../src/dsp.js';
import { estimateBearing } from '../src/localise.js';
import { distance, speedOfSound } from '../src/physics.js';
import { readWavMono48k } from './lib-wav.mjs';

const manifest = JSON.parse(readFileSync(new URL('../../assets/public/test-audio/manifest.json', import.meta.url), 'utf8'));
const clipFile = (id) => new URL(`../../assets/public/test-audio/${manifest.clips.find((c) => c.id === id).file}`, import.meta.url).pathname;
const clips = new Map(['car_horn', 'fireworks'].map((id) => [id, readWavMono48k(clipFile(id))]));
const durations = new Map([...clips].map(([k, v]) => [k, v.length / 48000]));

// Share of the clip's energy inside the localisation band, and its loudest 125 ms.
for (const [id, x] of clips) {
  const n = 2 ** Math.ceil(Math.log2(x.length));
  const { re, im } = rfft(x, n);
  let inBand = 0;
  let all = 0;
  for (let k = 1; k < n / 2; k++) {
    const p = re[k] ** 2 + im[k] ** 2;
    all += p;
    const f = (k * 48000) / n;
    if (f >= 200 && f <= 1600) inBand += p;
  }
  console.log(`${id}: ${(x.length / 48000).toFixed(2)} s, share of energy in 200-1600 Hz = ${(100 * inBand / all).toFixed(1)} %`);
}

function run(file, label) {
  const scn = validateScenario(JSON.parse(readFileSync(new URL(`../test/scenarios/${file}`, import.meta.url), 'utf8')));
  const t0 = Date.now();
  const out = renderScenario(scn, clips, { lengthS: renderLengthS(scn, durations) });
  const res = analyseScenario(scn, out, durations);
  console.log(`\n${label} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  // The old method: a fixed window of the whole clip length from the true arrival, blind to other sources.
  const c = speedOfSound(scn.settings.temperature_c);
  const horn = scn.sources[0];
  const rn = out.nodes[0];
  const r = distance(horn.keyframes[0].position, scn.nodes[0].position);
  const a = Math.round((horn.start_s + r / c - 0.02) * 48000);
  const b = Math.min(out.length, Math.round((horn.start_s + durations.get(horn.clip) + r / c + 0.05) * 48000));
  const old = estimateBearing({ mics: rn.mics, positions: rn.mic_positions, startSample: a, endSample: b, fs: 48000, c, band: scn.settings.localisation_band_hz });
  console.log(`  old fixed 5 s window for the horn: est az ${old.azimuth_deg.toFixed(1)} deg (window ${(a / 48000).toFixed(2)}-${(b / 48000).toFixed(2)} s)`);
  for (const r of res) {
    const n = r.nodes[0];
    console.log(
      `  ${r.source_id}: true az ${n.true_azimuth_deg.toFixed(1)}, est az ${n.bearing.azimuth_deg.toFixed(1)}, error ${n.azimuth_error_deg.toFixed(1)} deg, stated +/-${n.bearing.uncertainty_deg.toFixed(2)}, ` +
        `status ${n.localisation_status}, overlapped_with [${n.overlapped_with}], overlap ${n.overlap_s.toFixed(2)} s, level diff ${n.level_diff_db?.toFixed(1)} dB, reliable ${n.reliable}, ` +
        `window ${n.window_s.map((v) => v.toFixed(2)).join('-')}, SNR ${n.snr_db.toFixed(1)} (direct ${n.snr_direct_db?.toFixed(1)}, broadband ${n.snr_broadband_db.toFixed(1)}), picked ${n.picked_path_type}, uncertainty_valid ${n.uncertainty_valid}`
    );
  }
}

run('overlap-horn-fireworks.json', 'Fireworks at 12.9 s (overlapping the horn)');
run('overlap-horn-fireworks-s6-late.json', 'Fireworks moved to 25 s');
