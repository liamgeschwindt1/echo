import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultScenario } from '../packages/sim-core/src/scenario.js';
import { renderScenario } from '../packages/sim-core/src/render.js';
import { analyseScenario } from '../packages/sim-core/src/analyse.js';
import { speedOfSound, distance } from '../packages/sim-core/src/physics.js';
import { estimateNotchHeightCue } from '../packages/sim-core/src/ext/cues/notch-height.js';
import { dopplerFrequencyHz, dopplerRangeMeasurementAt, estimateDopplerCue } from '../packages/sim-core/src/ext/cues/doppler-range.js';
import { estimateSoundSpeed } from '../packages/sim-core/src/ext/cues/sound-speed.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const cuesDir = resolve(root, 'docs/tracks/cues/prereg');
const baselinesDir = resolve(root, 'baselines');
const now = new Date().toISOString().replace(/[:.]/g, '-');
const outputPath = resolve(baselinesDir, `cues-track-eval-${now}.json`);

const rng = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};
const gaussian = (random) => {
  const u1 = Math.max(1e-12, random());
  const u2 = random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
};
const mean = (values) => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
const pctl = (values, q) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[idx];
};
const bootstrapCI = (values, draws = 2000, seed = 9001) => {
  if (!values.length) return [null, null];
  const random = rng(seed);
  const samples = [];
  for (let i = 0; i < draws; i++) {
    const batch = [];
    for (let j = 0; j < values.length; j++) batch.push(values[Math.floor(random() * values.length)]);
    samples.push(mean(batch));
  }
  return [pctl(samples, 0.025), pctl(samples, 0.975)];
};

function notchStudy() {
  const random = rng(4501);
  const c = 343;
  const reflectivity = [0, 0.2, 0.4, 0.8];
  const heights = [1.5, 40, 80, 120];
  const ranges = [20, 60, 120, 200];
  const errors = [];
  const classOk = [];
  const failures = { low_reflectivity: 0, grazing_geometry: 0, low_snr: 0, unknown: 0 };
  for (const hs of heights) for (const d of ranges) for (const r of reflectivity) {
    const nodeCues = [0, 1, 2, 3].map((k) => {
      const nodeHeight = 5;
      const dk = d * (0.9 + 0.08 * k);
      const spacing = c * dk / (2 * hs * nodeHeight);
      const snr = 4 + 24 * r;
      const jitter = r > 0 ? (0.01 + 0.2 / Math.max(2, snr)) * gaussian(random) : NaN;
      const measured = Number.isFinite(jitter) ? spacing * (1 + jitter) : null;
      return {
        node_id: `n${k + 1}`,
        node_height_m: nodeHeight,
        horizontal_range_m: dk,
        spacing_hz: measured,
        ground_reflectivity: r,
        notch_snr_db: snr
      };
    });
    const estimate = estimateNotchHeightCue(nodeCues, { speedOfSoundMps: c });
    if (estimate.height_m == null) {
      failures.unknown += 1;
      continue;
    }
    errors.push(Math.abs(estimate.height_m - hs));
    classOk.push((hs > 4) === (estimate.class === 'aerial') ? 1 : 0);
    for (const node of estimate.per_node) {
      for (const warning of node.warnings || []) failures[warning] = (failures[warning] ?? 0) + 1;
    }
  }
  return {
    n_cases: errors.length,
    height_mae_m: mean(errors),
    height_p90_m: pctl(errors, 0.9),
    ground_vs_aerial_accuracy: mean(classOk),
    failure_modes: failures
  };
}

function dopplerStudy() {
  const random = rng(4502);
  const tone = 480;
  const speeds = [5, 10, 15, 25];
  const snrs = [5, 15, 25];
  const ranges = [20, 40, 70];
  const speedErrors = [];
  const rangeErrors = [];
  const rmseBearingOnly = [];
  const rmseCue = [];
  for (const speed of speeds) for (const snr of snrs) for (const closestRange of ranges) {
    const samples = [];
    const truthTrack = [];
    for (let i = 0; i < 300; i++) {
      const t = i * 0.02;
      const freq = dopplerFrequencyHz({
        tone_hz: tone,
        speed_mps: speed,
        closest_range_m: closestRange,
        closest_time_s: 3,
        sample_time_s: t
      });
      const sigmaHz = tone / Math.max(20, snr * 7);
      samples.push({ time_s: t, frequency_hz: freq + sigmaHz * gaussian(random) });
      truthTrack.push({ t, x: speed * (t - 3), y: closestRange });
    }
    const fit = estimateDopplerCue(samples, { tone_hz: tone, speed_max_mps: 35, range_max_m: 120 });
    if (!fit.usable) continue;
    speedErrors.push(Math.abs(fit.speed_mps - speed));
    rangeErrors.push(Math.abs(fit.closest_range_m - closestRange));
    const fixedRange = 100;
    const errBearing = [];
    const errCue = [];
    for (const point of truthTrack) {
      const bearing = Math.atan2(point.y, point.x) + (5 / Math.max(5, snr)) * gaussian(random) * Math.PI / 180;
      const bx = fixedRange * Math.cos(bearing), by = fixedRange * Math.sin(bearing);
      errBearing.push(Math.hypot(bx - point.x, by - point.y));
      const cueRange = dopplerRangeMeasurementAt(fit, point.t);
      const cx = cueRange.range_m * Math.cos(bearing), cy = cueRange.range_m * Math.sin(bearing);
      errCue.push(Math.hypot(cx - point.x, cy - point.y));
    }
    rmseBearingOnly.push(Math.sqrt(mean(errBearing.map((x) => x * x))));
    rmseCue.push(Math.sqrt(mean(errCue.map((x) => x * x))));
  }
  return {
    n_cases: speedErrors.length,
    speed_mae_mps: mean(speedErrors),
    closest_range_mae_m: mean(rangeErrors),
    track_rmse_bearing_only_m: mean(rmseBearingOnly),
    track_rmse_with_doppler_m: mean(rmseCue),
    relative_gain: (mean(rmseBearingOnly) - mean(rmseCue)) / mean(rmseBearingOnly)
  };
}

function weatherSoundSpeedStudy() {
  const random = rng(4503);
  const nominalTemp = 15;
  const nominalC = speedOfSound(nominalTemp);
  const offsets = [-10, -5, 0, 5, 10];
  const winds = [0, 5, 10];
  const baselines = [40, 80, 120];
  const errorNo = [];
  const errorYes = [];
  const rangeNo = [];
  const rangeYes = [];
  for (const offset of offsets) for (const wind of winds) {
    const trueC = speedOfSound(nominalTemp + offset) + 0.25 * wind;
    const pairs = baselines.map((d) => {
      const t = d / trueC + 0.0002 * gaussian(random);
      return { distance_m: d, time_s: t, time_sigma_s: 0.0002 };
    });
    const estimate = estimateSoundSpeed({
      nominal_temperature_c: nominalTemp,
      temperature_sensor_c: nominalTemp + offset + 0.3 * gaussian(random),
      pairs
    });
    errorNo.push(Math.abs(nominalC - trueC));
    errorYes.push(Math.abs(estimate.sound_speed_mps - trueC));
    const truthDistance = 100;
    const observedTime = truthDistance / trueC;
    rangeNo.push(Math.abs(observedTime * nominalC - truthDistance));
    rangeYes.push(Math.abs(observedTime * estimate.sound_speed_mps - truthDistance));
  }
  return {
    n_cases: offsets.length * winds.length,
    speed_error_without_correction_mps: mean(errorNo),
    speed_error_with_correction_mps: mean(errorYes),
    range_error_without_correction_m: mean(rangeNo),
    range_error_with_correction_m: mean(rangeYes)
  };
}

function toneClip({ fs = 48000, seconds = 4, hz = 480 }) {
  const n = Math.round(fs * seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = 0.3 * Math.sin(2 * Math.PI * hz * i / fs);
  return out;
}

function buildAerialScene(seed, truth) {
  const scenario = defaultScenario();
  scenario.settings.analysis_mode = 'truth_assisted';
  scenario.settings.noise_floor_db_spl = 35;
  scenario.settings.mic_self_noise_db_spl = 25;
  scenario.settings.ground_reflectivity = 0.5;
  scenario.settings.seed = seed;
  scenario.nodes = [
    { id: 'n2', position: [-32.5, 39.7, 5], rotation_deg: 0, mic_layout: 'flat_square', mic_spacing_m: 0.1 },
    { id: 'n4', position: [53.5, 14.2, 5], rotation_deg: 0, mic_layout: 'flat_square', mic_spacing_m: 0.1 }
  ];
  scenario.sources = [{
    id: 'drone1',
    clip: 'tone',
    level_1m_db: 100,
    start_s: 2.5,
    keyframes: [
      { t: 2.5, position: [truth[0], truth[1], truth[2]] },
      { t: 6.5, position: [truth[0] + 35, truth[1] - 15, truth[2]] }
    ]
  }];
  return scenario;
}

function cueHeightEstimate(scenario, truth) {
  const c = speedOfSound(scenario.settings.temperature_c);
  const nodeCues = scenario.nodes.map((node, i) => {
    const d = Math.hypot(truth[0] - node.position[0], truth[1] - node.position[1]);
    const spacing = c * d / (2 * Math.max(0.5, truth[2]) * node.position[2]);
    return {
      node_id: node.id,
      node_height_m: node.position[2],
      horizontal_range_m: d,
      spacing_hz: spacing * (1 + 0.03 * Math.sin(i + d / 80)),
      ground_reflectivity: scenario.settings.ground_reflectivity,
      notch_snr_db: 16
    };
  });
  return estimateNotchHeightCue(nodeCues, { speedOfSoundMps: c }).height_m;
}

function runAerialCase(sceneTruth, seed) {
  const scenario = buildAerialScene(seed, sceneTruth);
  const clips = new Map([['tone', toneClip({ hz: 480 })]]);
  const rendered = renderScenario(scenario, clips, { lengthS: 8 });
  const [sourceResult] = analyseScenario(scenario, rendered, new Map([['tone', 4]]));
  const base = sourceResult.fix?.position ?? null;
  const trueMid = [sceneTruth[0] + 17.5, sceneTruth[1] - 7.5, sceneTruth[2]];
  const cueHeight = cueHeightEstimate(scenario, trueMid);
  const cue = base && Number.isFinite(cueHeight) ? [base[0], base[1], cueHeight] : null;
  const baseErr2d = base ? Math.hypot(base[0] - trueMid[0], base[1] - trueMid[1]) : null;
  const baseErr3d = base ? Math.hypot(base[0] - trueMid[0], base[1] - trueMid[1], base[2] - trueMid[2]) : null;
  const cueErr3d = cue ? Math.hypot(cue[0] - trueMid[0], cue[1] - trueMid[1], cue[2] - trueMid[2]) : null;
  return {
    base_fix: base,
    cue_fix: cue,
    truth: trueMid,
    base_err2d_m: baseErr2d,
    base_err3d_m: baseErr3d,
    cue_err3d_m: cueErr3d,
    base_height_error_m: base ? Math.abs(base[2] - trueMid[2]) : null,
    cue_height_error_m: cue ? Math.abs(cue[2] - trueMid[2]) : null
  };
}

function aerialStudy() {
  const truths = [
    [-55.4, 44.8, 75],
    [-48.1, 42.3, 40],
    [-60.2, 39.5, 100],
    [-25, 54, 120],
    [-10, 20, 60]
  ];
  const cases = truths.map((truth, i) => runAerialCase(truth, 4504 + i));
  const base3d = cases.filter((x) => x.base_err3d_m != null).map((x) => x.base_err3d_m);
  const cue3d = cases.filter((x) => x.cue_err3d_m != null).map((x) => x.cue_err3d_m);
  const baseH = cases.filter((x) => x.base_height_error_m != null).map((x) => x.base_height_error_m);
  const cueH = cases.filter((x) => x.cue_height_error_m != null).map((x) => x.cue_height_error_m);
  return {
    n_cases: cases.length,
    base_3d_fix_rate: base3d.length / cases.length,
    cue_3d_fix_rate: cue3d.length / cases.length,
    base_3d_error_m: mean(base3d),
    cue_3d_error_m: mean(cue3d),
    base_height_error_m: mean(baseH),
    cue_height_error_m: mean(cueH),
    base_3d_error_ci95: bootstrapCI(base3d, 1000, 45040),
    cue_3d_error_ci95: bootstrapCI(cue3d, 1000, 45041),
    base_height_error_ci95: bootstrapCI(baseH, 1000, 45042),
    cue_height_error_ci95: bootstrapCI(cueH, 1000, 45043),
    cases
  };
}

async function preregHashes() {
  const files = [
    'notch-height-study.json',
    'doppler-range-study.json',
    'weather-sound-speed-study.json',
    'aerial-check-study.json'
  ];
  const out = {};
  for (const file of files) {
    const text = await readFile(resolve(cuesDir, file), 'utf8');
    out[file] = createHash('sha256').update(text).digest('hex');
  }
  return out;
}

const results = {
  generated_at: new Date().toISOString(),
  prereg_hashes: await preregHashes(),
  notch_height: notchStudy(),
  doppler_range: dopplerStudy(),
  weather_sound_speed: weatherSoundSpeedStudy(),
  aerial_checks: aerialStudy()
};

await mkdir(baselinesDir, { recursive: true });
await writeFile(outputPath, JSON.stringify(results, null, 2) + '\n', 'utf8');
console.log(outputPath);
