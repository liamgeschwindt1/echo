// Fixed-seed multi-source scenario suite A-E, shared by scripts/sim-suite.mjs and the regression test.
// SIMULATED results only. The diffraction model is unvalidated. Nothing here is a real-world accuracy claim.
import { readFileSync } from 'node:fs';
import { validateScenario, renderLengthS } from '../src/sim/core/scenario.js';
import { renderScenario } from '../src/sim/core/render.js';
import { analyseScenario, TRACK_INTERVAL_S, TRACK_WINDOW_S } from '../src/sim/core/analyse.js';
import { speedOfSound, distance } from '../src/sim/core/physics.js';
import { positionAt, isMoving, motionSpan } from '../src/sim/core/motion.js';
import { mulberry32 } from '../src/sim/core/rng.js';
import { readWavMono48k } from '../scripts/lib-wav.mjs';

export const SCENARIOS = ['A', 'B', 'C', 'D', 'E'];
export const ERROR_SETTINGS = { heading_error_sigma_deg: 2.5, mic_gain_sigma_db: 1, mic_position_sigma_mm: 5 };
export const WBR_ERROR_M = 10; // primary: reliable fix with horizontal error above this
export const WBR_SECONDARY_M = [5, 3];
export const RANGE_BINS = [[10, 25], [25, 50], [50, 100], [100, Infinity]];

let clipCache = null;
export function loadClips() {
  if (clipCache) return clipCache;
  const manifest = JSON.parse(readFileSync(new URL('../public/test-audio/manifest.json', import.meta.url), 'utf8'));
  const file = (id) => new URL(`../public/test-audio/${manifest.clips.find((c) => c.id === id).file}`, import.meta.url).pathname;
  const clips = new Map(['glass_breaking', 'engine', 'footsteps', 'car_horn', 'dog'].map((id) => [id, readWavMono48k(file(id))]));
  clipCache = { clips, durations: new Map([...clips].map(([k, v]) => [k, v.length / 48000])) };
  return clipCache;
}

// Three axis-aligned boxes standing in for building footprints. The repo holds no real footprint data (see report).
const BUILDINGS = [
  { id: 'b1', position: [40, -22], size: [18, 12, 12], rotation_deg: 0 },
  { id: 'b2', position: [-25, 30], size: [14, 20, 15], rotation_deg: 0 },
  { id: 'b3', position: [95, 25], size: [16, 14, 10], rotation_deg: 0 }
];

// Drop any box within 6 m of a node, a source or a source path, so scaling the layout never puts anything inside a building.
function clearBuildings(buildings, nodes, sources) {
  const pts = nodes.map((n) => n.position);
  for (const s of sources) {
    const kf = s.keyframes;
    for (let i = 0; i < kf.length; i++) {
      pts.push(kf[i].position);
      if (i) for (let u = 0.02; u < 1; u += 0.02) pts.push([0, 1, 2].map((a) => kf[i - 1].position[a] + u * (kf[i].position[a] - kf[i - 1].position[a])));
    }
  }
  return buildings.filter((b) => !pts.some((p) => Math.abs(p[0] - b.position[0]) < b.size[0] / 2 + 6 && Math.abs(p[1] - b.position[1]) < b.size[1] / 2 + 6));
}

const node = (id, x, y) => ({ id, position: [x, y, 5], rotation_deg: 0, mic_layout: 'flat_square', mic_spacing_m: 0.1 });
const src = (id, clip, x, y, level, start, extra = {}) => ({ id, clip, keyframes: [{ t: 0, position: [x, y, 1.5] }], level_1m_db: level, start_s: start, ...extra });

/**
 * Scenario for (letter, seed). The seed drives noise, heading/gain/position errors and a small placement jitter
 * (so no single layout is tuned for). `thirdNode` adds a node (Phase 2 option).
 */
export function buildScenario(letter, seed, { thirdNode = false, errors = true, buildings = true, settings = {} } = {}) {
  const rnd = mulberry32(seed * 7919 + letter.charCodeAt(0));
  // Layout scale (log-uniform 0.3-1.6) spreads source ranges over about 15-130 m so every range bin is populated.
  const k = Math.exp(Math.log(0.3) + rnd() * (Math.log(1.6) - Math.log(0.3)));
  const j = (m) => (rnd() * 2 - 1) * m;
  const start = 3 + rnd() * 0.3;
  const nodes = [node('n1', 0, 0), node('n2', 80 * k, 0)];
  if (thirdNode) nodes.push(node('n3', 40 * k, 70 * k));
  let sources;
  const glass = () => src('glass', 'glass_breaking', 40 * k + j(6), 35 * k + j(6), 110, start);
  const engine = () => {
    const y0 = 55 * k + j(5);
    return src('engine', 'engine', 5 * k + j(5), y0, 108, start, {
      keyframes: [{ t: start, position: [5 * k + j(5), y0, 1.5] }, { t: start + 5, position: [90 * k + j(5), y0 + j(5), 1.5] }]
    });
  };
  const steps = () => src('footsteps', 'footsteps', 62 * k + j(5), 20 * k + j(5), 78, start);
  if (letter === 'A') sources = [glass()];
  else if (letter === 'B') sources = [src('horn', 'car_horn', 30 * k + j(5), 40 * k + j(5), 108, start), src('dog', 'dog', 55 * k + j(5), 35 * k + j(5), 88, start)];
  else if (letter === 'C') sources = [src('horn', 'car_horn', 30 * k + j(5), 40 * k + j(5), 100, start), src('dog', 'dog', 58 * k + j(5), 38 * k + j(5), 100, start)];
  else if (letter === 'D' || letter === 'E') sources = [glass(), engine(), steps()];
  else throw new Error(`unknown scenario ${letter}`);
  const s = {
    seed,
    ...(errors ? ERROR_SETTINGS : {}),
    ...(letter === 'E' ? { noise_floor_db_spl: 60 } : {}), // continuous background: ambient noise 15 dB above default
    ...settings
  };
  return validateScenario({ version: '0.2', settings: s, nodes, sources, buildings: buildings ? clearBuildings(BUILDINGS.map((b) => ({ ...b, position: b.position.map((v) => v * k) })), nodes, sources) : [] });
}

// --- measured quantities on the mixture (what a real node could compute) ---------------------------------------
const frameMean = (frames, t0, t1, frameS) => {
  const f0 = Math.max(0, Math.floor(t0 / frameS));
  const f1 = Math.min(frames.length, Math.max(f0 + 1, Math.ceil(t1 / frameS)));
  let s = 0;
  for (let f = f0; f < f1; f++) s += frames[f];
  return s / Math.max(1, f1 - f0);
};
const db = (x) => 10 * Math.log10(Math.max(x, 1e-30));

/** Mixture mean power at mic 1 over [t0,t1] relative to the median quiet-period power (first 2.5 s, before any source). */
export function mixtureSnrDb(frames, t0, t1, frameS, quietS = 2.5) {
  const quiet = frames.slice(0, Math.floor(quietS / frameS)).sort((a, b) => a - b);
  const noise = quiet[Math.floor(quiet.length / 2)] || 1e-30;
  return db(frameMean(frames, t0, t1, frameS) / noise);
}

function mixtureFrames(mic, band, fs, frameS) {
  // Whole-signal FFT band-pass (raised-cosine edges as activity.js), then 10 ms mean-square frames.
  const n = 2 ** Math.ceil(Math.log2(mic.length));
  const x = new Float64Array(n);
  x.set(mic);
  return { x, n, band, fs, frameS };
}

// Band-limited mixture frame power at mic 1, via dsp rfft/irfft.
async function bandFrames(mic, band, fs, frameS) {
  const { rfft, irfft } = await import('../src/sim/core/dsp.js');
  const { bandWeight } = await import('../src/sim/core/activity.js');
  const { x, n } = mixtureFrames(mic, band, fs, frameS);
  const { re, im } = rfft(x, n);
  for (let k = 0; k < re.length; k++) {
    const w = bandWeight((k * fs) / n, band);
    re[k] *= w;
    im[k] *= w;
  }
  const y = irfft(re, im, n);
  const len = Math.round(frameS * fs);
  const out = [];
  for (let f = 0; f + len <= mic.length; f += len) {
    let s = 0;
    for (let i = f; i < f + len; i++) s += y[i] * y[i];
    out.push(s / len);
  }
  return out;
}

// --- scoring -----------------------------------------------------------------------------------------------
const FRAME_S = 0.01;
const meanOver = (arr, t0, t1) => frameMean(arr, t0, t1, FRAME_S);

/** Run one (scenario, seed): render, analyse, return per-source records labelled oracle / measured. */
export async function runOne(letter, seed, opts = {}) {
  const { clips, durations } = loadClips();
  const scn = buildScenario(letter, seed, opts);
  const out = renderScenario(scn, clips, { lengthS: renderLengthS(scn, durations) });
  const res = analyseScenario(scn, out, durations, { progressive: false });
  const c = speedOfSound(scn.settings.temperature_c);
  const band = scn.settings.localisation_band_hz;
  const mixFrames = await Promise.all(out.nodes.map((rn) => bandFrames(rn.mics[0], band, out.sample_rate, FRAME_S)));
  return res.map((r, si) => {
    const s = scn.sources[si];
    const moving = isMoving(s);
    const truth = r.true_position;
    const used = r.nodes.filter((n) => n.bearing && n.heard && n.reliable);
    const est = r.fix?.position ?? null;
    const err = r.error_horizontal_m;
    const rangeMean = used.length ? used.reduce((a, n) => a + n.range_m, 0) / used.length : r.nodes.reduce((a, n) => a + n.range_m, 0) / r.nodes.length;
    const nodes = r.nodes.map((n, ni) => {
      const w = n.window_s;
      const act = out.activity[ni];
      const own = meanOver(act.per_source[si].all, w[0], w[1]);
      let others = 0;
      act.per_source.forEach((p, oi) => {
        if (oi !== si) others += meanOver(p.all, w[0], w[1]);
      });
      return {
        node: n.node_id,
        range_m: n.range_m,
        status: n.localisation_status,
        reliable: n.reliable,
        window_s: w,
        snr_db_oracle: n.snr_db,
        sinr_db_oracle: db(own / (others + act.noise_band_power)),
        mixture_snr_db_measured: mixtureSnrDb(mixFrames[ni], w[0], w[1], FRAME_S),
        bearing_residual_s_measured: n.bearing?.residual_s ?? null,
        bearing_error_deg: n.azimuth_error_deg,
        overlapped_with_oracle: n.overlapped_with
      };
    });
    // Moving-source track: fraction of the path (emission time) with a track fix.
    let coverage = null;
    let trackErr = null;
    let stampLag = null;
    if (moving) {
      const [k0, k1] = motionSpan(s);
      const emit = (f) => {
        const pos = f.position;
        const ranges = scn.nodes.map((nd) => distance(nd.position, pos));
        return f.t_s - TRACK_WINDOW_S / 2 - Math.min(...ranges) / c; // approximate: nearest node range
      };
      const times = r.track.fixes.map((f) => ({ t: emit(f), f }));
      let covered = 0;
      let samples = 0;
      for (let t = k0; t < k1; t += 0.05) {
        samples++;
        if (times.some((q) => Math.abs(q.t - t) <= TRACK_INTERVAL_S / 2 + 1e-9)) covered++;
      }
      coverage = samples ? covered / samples : null;
      const errs = times.map(({ t, f }) => Math.hypot(f.position[0] - positionAt(s, t)[0], f.position[1] - positionAt(s, t)[1]));
      const lags = times.map(({ t, f }) => Math.hypot(positionAt(s, t)[0] - positionAt(s, f.t_s)[0], positionAt(s, t)[1] - positionAt(s, f.t_s)[1]));
      trackErr = errs.length ? errs : null;
      stampLag = lags.length ? lags : null;
    }
    const reliable = !!est;
    return {
      scenario: letter,
      seed,
      source: s.id,
      moving,
      range_m: rangeMean,
      nodes_used: used.length,
      localised: !!est,
      reliable_fix: reliable,
      error_m: err,
      wrong_but_reliable: reliable && err > WBR_ERROR_M,
      wbr_5m: reliable && err > 5,
      wbr_3m: reliable && err > 3,
      suspect_flag: r.fix?.fix_suspect ?? null,
      nodes,
      track_coverage: coverage,
      track_error_m: trackErr,
      arrival_stamp_lag_m: stampLag,
      true_position: truth
    };
  });
}

// --- aggregation ---------------------------------------------------------------------------------------------
export const quantile = (a, q) => {
  const v = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!v.length) return null;
  const i = (v.length - 1) * q;
  const lo = Math.floor(i);
  return v[lo] + (v[Math.ceil(i)] - v[lo]) * (i - lo);
};

export function summarise(records) {
  const out = {};
  for (const letter of SCENARIOS) {
    const rows = records.filter((r) => r.scenario === letter);
    if (!rows.length) continue;
    const bySource = {};
    for (const id of [...new Set(rows.map((r) => r.source))]) {
      const rs = rows.filter((r) => r.source === id);
      const errs = rs.map((r) => r.error_m).filter((v) => v != null);
      const rel = rs.filter((r) => r.reliable_fix);
      const cov = rs.map((r) => r.track_coverage).filter((v) => v != null);
      const allNodes = rs.flatMap((r) => r.nodes);
      bySource[id] = {
        n: rs.length,
        localised_frac: rs.filter((r) => r.localised).length / rs.length,
        error_m_median: quantile(errs, 0.5),
        error_m_p90: quantile(errs, 0.9),
        wrong_but_reliable_rate: rs.filter((r) => r.wrong_but_reliable).length / rs.length,
        wbr_5m_rate: rs.filter((r) => r.wbr_5m).length / rs.length,
        wbr_3m_rate: rs.filter((r) => r.wbr_3m).length / rs.length,
        wrong_but_reliable_of_reliable: rel.length ? rel.filter((r) => r.wrong_but_reliable).length / rel.length : null,
        track_coverage_median: quantile(cov, 0.5),
        track_coverage_p90: quantile(cov, 0.9),
        track_error_m_median: quantile(rs.flatMap((r) => r.track_error_m || []), 0.5),
        arrival_stamp_lag_m_median: quantile(rs.flatMap((r) => r.arrival_stamp_lag_m || []), 0.5),
        oracle_snr_db_median: quantile(allNodes.map((n) => n.snr_db_oracle), 0.5),
        oracle_sinr_db_median: quantile(allNodes.map((n) => n.sinr_db_oracle), 0.5),
        measured_mixture_snr_db_median: quantile(allNodes.map((n) => n.mixture_snr_db_measured), 0.5),
        measured_bearing_residual_us_median: (quantile(allNodes.map((n) => n.bearing_residual_s_measured), 0.5) ?? NaN) * 1e6,
        bearing_error_deg_median: quantile(allNodes.map((n) => n.bearing_error_deg), 0.5),
        bearing_error_deg_p90: quantile(allNodes.map((n) => n.bearing_error_deg), 0.9),
        node_status: Object.fromEntries([...new Set(allNodes.map((n) => n.status))].map((k) => [k, allNodes.filter((n) => n.status === k).length / allNodes.length])),
        by_range: RANGE_BINS.map(([a, b]) => {
          const e = rs.filter((r) => r.range_m >= a && r.range_m < b);
          const ee = e.map((r) => r.error_m).filter((v) => v != null);
          return { range: `${a}-${b === Infinity ? 'inf' : b} m`, n: e.length, localised_frac: e.length ? e.filter((r) => r.localised).length / e.length : null, median: quantile(ee, 0.5), p90: quantile(ee, 0.9), wbr_10m: e.length ? e.filter((r) => r.wrong_but_reliable).length / e.length : null, wbr_5m: e.length ? e.filter((r) => r.wbr_5m).length / e.length : null, wbr_3m: e.length ? e.filter((r) => r.wbr_3m).length / e.length : null };
        }).filter((x) => x.n)
      };
    }
    out[letter] = bySource;
  }
  return out;
}
