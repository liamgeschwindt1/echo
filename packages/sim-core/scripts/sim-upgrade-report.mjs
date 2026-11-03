// Per-scene table for the schema 0.4 upgrade: horizontal and 3D fix error, per-node azimuth error, usable nodes,
// flags, track fixes and 1/2-sigma calibration. Renders once per scene and caches the audio, so the analysis
// can be compared between two copies of the core (e.g. `--core .before/src` against the working tree).
//   node scripts/sim-upgrade-report.mjs [--suite upgrade|exports] [--core src] [--json out.json] [--scenes a,b] [--set key=value ...]
// --suite exports runs the seven exported 0.3 runs (test/export-scenes.js) instead of the six upgrade scenes.
// SIMULATED results only. Not a real-world accuracy claim.
import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SCENE_IDS, upgradeScenario } from '../test/upgrade-scenes.js';
import { EXPORT_IDS, exportScenario } from '../test/export-scenes.js';
import { readWavMono48k } from './lib-wav.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const coreDir = resolve(opt('--core', 'src'));
const exportsSuite = opt('--suite', 'upgrade') === 'exports';
const buildScene = exportsSuite ? exportScenario : upgradeScenario;
const scenes = opt('--scenes', (exportsSuite ? EXPORT_IDS : SCENE_IDS).join(',')).split(',');
const settings = {};
args.forEach((a, i) => {
  if (args[i - 1] !== '--set') return;
  const [k, v] = a.split('=');
  settings[k] = v === 'true' ? true : v === 'false' ? false : Number.isFinite(Number(v)) ? Number(v) : v;
});

const core = async (m) => import(pathToFileURL(`${coreDir}/${m}`).href);
const { renderScenario } = await core('render.js');
const { analyseScenario } = await core('analyse.js');
const { renderLengthS } = await core('scenario.js');

const manifest = JSON.parse(readFileSync(new URL('../../assets/public/test-audio/manifest.json', import.meta.url), 'utf8'));
const clips = new Map();
for (const c of manifest.clips) if (c.file) clips.set(c.id, readWavMono48k(new URL(`../../assets/public/test-audio/${c.file}`, import.meta.url).pathname));
const durations = new Map([...clips].map(([k, v]) => [k, v.length / 48000]));

const f = (v, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? '-' : v.toFixed(d));
const out = [];
for (const id of scenes) {
  const scn = buildScene(id, settings);
  const used = new Map(scn.sources.map((s) => [s.clip, clips.get(s.clip)]));
  const rendered = renderScenario(scn, used, { lengthS: renderLengthS(scn, durations) });
  const t0 = Date.now();
  const results = analyseScenario(scn, rendered, durations);
  const analyseMs = Date.now() - t0;
  for (const r of results) {
    const nodes = r.nodes.map((n) => {
      const sigma = n.bearing?.uncertainty_deg ?? null;
      return {
        node_id: n.node_id,
        azimuth_error_deg: n.azimuth_error_deg,
        sigma_deg: sigma,
        within_1sigma: sigma && n.azimuth_error_deg !== null ? n.azimuth_error_deg <= sigma : null,
        within_2sigma: sigma && n.azimuth_error_deg !== null ? n.azimuth_error_deg <= 2 * sigma : null,
        status: n.localisation_status,
        policy: n.window_policy ?? 'fixed',
        window_s: n.window_s,
        weight: n.weight ?? null
      };
    });
    const flags = [];
    if (r.fix?.poorly_conditioned) flags.push('poorly_conditioned');
    if (r.fix?.fix_suspect) flags.push(`suspect${r.fix.suspect_reasons ? `(${r.fix.suspect_reasons.join('+')})` : ''}`);
    if (r.fix?.z_clamped) flags.push('z_clamped');
    const trackErr = (r.track?.fixes || []).map((x) => x.error_m).filter(Number.isFinite);
    out.push({
      scene: id,
      source_id: r.source_id,
      error_horizontal_m: r.error_horizontal_m,
      error_3d_m: r.error_3d_m,
      fix_z_m: r.fix?.position?.[2] ?? null,
      heard_nodes: r.heard_nodes,
      usable_nodes: r.usable_nodes ?? r.heard_nodes,
      inliers: r.fix?.inlier_nodes ?? null,
      rejected: r.fix?.rejected_nodes ?? null,
      flags,
      track_fixes: r.track?.fixes?.length ?? 0,
      track_median_error_m: trackErr.length ? trackErr.sort((a, b) => a - b)[Math.floor(trackErr.length / 2)] : null,
      track_rejected: r.track?.rejected_count ?? null,
      backtrace_true_rank: r.backtrace?.true_rank ?? null,
      backtrace_candidates: r.backtrace?.n_candidates ?? null,
      analyse_ms: analyseMs,
      nodes
    });
  }
}

const allNodes = out.flatMap((r) => r.nodes.filter((n) => n.within_1sigma !== null));
const cal = {
  n: allNodes.length,
  within_1sigma: allNodes.filter((n) => n.within_1sigma).length / Math.max(1, allNodes.length),
  within_2sigma: allNodes.filter((n) => n.within_2sigma).length / Math.max(1, allNodes.length)
};

console.log(`core: ${coreDir}`);
console.log('| scene | source | horiz m | 3D m | z m | heard | usable | flags | track fixes (median m) | per-node az error deg (policy) |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const r of out) {
  const per = r.nodes.map((n) => `${n.node_id} ${f(n.azimuth_error_deg)}${n.policy !== 'fixed' ? ` ${n.policy[0]}` : ''}`).join(', ');
  console.log(`| ${r.scene} | ${r.source_id} | ${f(r.error_horizontal_m)} | ${f(r.error_3d_m)} | ${f(r.fix_z_m)} | ${r.heard_nodes} | ${r.usable_nodes} | ${r.flags.join(' ') || '-'} | ${r.track_fixes} (${f(r.track_median_error_m)}) | ${per} |`);
}
console.log(`\ncalibration: ${cal.n} node bearings, ${(100 * cal.within_1sigma).toFixed(0)}% within 1 sigma, ${(100 * cal.within_2sigma).toFixed(0)}% within 2 sigma`);
const json = opt('--json', null);
if (json) {
  const dir = resolve(json, '..');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(json, JSON.stringify({ core: coreDir, settings, calibration: cal, rows: out }, null, 2));
}
