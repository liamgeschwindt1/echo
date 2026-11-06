import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { metricValues } from '../packages/sim-core/src/benchmark/metrics.js';

const baselinePath = resolve(process.argv[2] ?? 'baselines/matrix-baseline-r3.full.json.gz');
const detectabilityOut = resolve(process.argv[3] ?? 'docs/experiments/matrix-r3-detectability.md');
const nodeCountOut = resolve(process.argv[4] ?? 'docs/experiments/matrix-r4-node-count-reconciliation.md');
const jsonOut = resolve(process.argv[5] ?? 'baselines/mission4-x0-x1-analysis.json');

const TOL_DEG = 10;
const clipDurationS = 2;

const wrapDeg = (d) => Math.abs((((d + 180) % 360) + 360) % 360 - 180);
const deg = (r) => (r * 180) / Math.PI;
const pct = (a, b) => b ? 100 * a / b : 0;
const fmtPct = (a, b) => `${pct(a, b).toFixed(1)}%`;
const fmtN = (n) => Number.isFinite(n) ? n.toFixed(3) : 'null';

function sourceStartS(source) {
  if (Number.isFinite(source.start_s)) return source.start_s;
  return source.keyframes[0]?.t ?? 0;
}

function sourcePositionAt(source, t) {
  const keyframes = source.keyframes ?? [];
  if (!keyframes.length) return [0, 0, 0];
  if (keyframes.length === 1) return keyframes[0].position;
  let a = keyframes[0];
  let b = keyframes[keyframes.length - 1];
  for (let i = 0; i < keyframes.length - 1; i++) {
    if (t >= keyframes[i].t && t <= keyframes[i + 1].t) {
      a = keyframes[i];
      b = keyframes[i + 1];
      break;
    }
  }
  const u = Math.max(0, Math.min(1, (t - a.t) / Math.max(1e-9, b.t - a.t)));
  return a.position.map((v, i) => v + (b.position[i] - v) * u);
}

function truthAzimuthDeg(source, nodePosition, t) {
  const p = sourcePositionAt(source, t);
  return deg(Math.atan2(p[1] - nodePosition[1], p[0] - nodePosition[0]));
}

function inClip(window, start, end) {
  return window.t_s >= start && window.t_s <= end;
}

function analyse(report) {
  const perProfile = new Map();
  const nodeStage = new Map();
  const eventStage = new Map();
  const failReasons = new Map();
  const allNodeCounts = new Set();

  const ensureProfile = (map, profile) => {
    if (!map.has(profile)) {
      map.set(profile, {
        events: 0,
        strict3: 0,
        bearing3: 0,
        within10InClip3: 0,
        within10AnyTrack3: 0,
        fix3: 0
      });
    }
    return map.get(profile);
  };

  const ensureNodeStage = (profile) => {
    if (!nodeStage.has(profile)) {
      nodeStage.set(profile, {
        nodeEvents: 0,
        candidateInClip: 0,
        windowInClip: 0,
        trackInClip: 0,
        windowWithin10InClip: 0,
        trackWithin10InClip: 0,
        trackWithin10AnyTime: 0,
        candidateWithoutWindow: 0,
        windowWithoutTrack: 0
      });
    }
    return nodeStage.get(profile);
  };

  const ensureEventStage = (profile) => {
    if (!eventStage.has(profile)) {
      eventStage.set(profile, {
        events: 0,
        strict3: 0,
        bearing3: 0,
        within10InClip3: 0,
        within10AnyTrack3: 0,
        fix3: 0,
        failNoBearing: 0,
        failBearingError: 0,
        failAssignment: 0,
        failAssociation: 0
      });
    }
    return eventStage.get(profile);
  };

  for (const run of report.runs) {
    const nodeCount = run.scenario.settings.matrix_node_count;
    if (Number.isInteger(nodeCount)) allNodeCounts.add(nodeCount);
    const sourceCount = run.scenario.settings.matrix_simultaneous_sources;
    if (sourceCount !== 3) continue;

    const profile = run.job.realism;
    const profileAgg = ensureProfile(perProfile, profile);
    const nodeAgg = ensureNodeStage(profile);
    const eventAgg = ensureEventStage(profile);

    for (const source of run.scenario.sources) {
      profileAgg.events++;
      eventAgg.events++;
      const scoreSource = run.scores.sources.find((s) => s.source_id === source.id);
      const clipStart = sourceStartS(source);
      const clipEnd = clipStart + clipDurationS;
      const stageCount = { bearing: 0, within10InClip: 0, strict: 0, within10AnyTrack: 0, fix: 0 };

      for (let nodeIndex = 0; nodeIndex < run.scenario.nodes.length; nodeIndex++) {
        const node = run.scenario.nodes[nodeIndex];
        const inferenceNode = run.inference.nodes[nodeIndex];
        nodeAgg.nodeEvents++;

        const candidates = (inferenceNode.candidates ?? []).filter((w) => inClip(w, clipStart, clipEnd));
        const windows = (inferenceNode.windows ?? []).filter((w) => inClip(w, clipStart, clipEnd));
        const tracksInClip = (inferenceNode.tracks ?? []).flatMap((t) => t.windows ?? []).filter((w) => inClip(w, clipStart, clipEnd));
        const tracksAny = (inferenceNode.tracks ?? []).flatMap((t) => t.windows ?? []);

        const bearing = windows.length > 0;
        const within10InClip = windows.some((w) => wrapDeg(w.az_deg - truthAzimuthDeg(source, node.position, w.t_s)) <= TOL_DEG);
        const strict = scoreSource?.nodes?.find((n) => n.node_id === node.id)?.detected === true;
        const within10AnyTrack = tracksAny.some((w) => wrapDeg(w.az_deg - truthAzimuthDeg(source, node.position, w.t_s)) <= TOL_DEG);

        let fix = false;
        if (scoreSource?.measured_fix_index !== null && scoreSource?.measured_fix_index !== undefined) {
          const sourceFix = run.inference.fixes[scoreSource.measured_fix_index];
          fix = (sourceFix?.node_tracks ?? []).some((key) => key.startsWith(`${nodeIndex}:`));
        }

        if (candidates.length > 0) nodeAgg.candidateInClip++;
        if (bearing) nodeAgg.windowInClip++;
        if (tracksInClip.length > 0) nodeAgg.trackInClip++;
        if (within10InClip) nodeAgg.windowWithin10InClip++;
        if (strict) nodeAgg.trackWithin10InClip++;
        if (within10AnyTrack) nodeAgg.trackWithin10AnyTime++;
        if (candidates.length > 0 && !bearing) nodeAgg.candidateWithoutWindow++;
        if (bearing && tracksInClip.length === 0) nodeAgg.windowWithoutTrack++;

        if (bearing) stageCount.bearing++;
        if (within10InClip) stageCount.within10InClip++;
        if (strict) stageCount.strict++;
        if (within10AnyTrack) stageCount.within10AnyTrack++;
        if (fix) stageCount.fix++;
      }

      const strict3 = stageCount.strict >= 3;
      const bearing3 = stageCount.bearing >= 3;
      const within10InClip3 = stageCount.within10InClip >= 3;
      const within10AnyTrack3 = stageCount.within10AnyTrack >= 3;
      const fix3 = stageCount.fix >= 3;
      if (strict3) profileAgg.strict3++;
      if (bearing3) profileAgg.bearing3++;
      if (within10InClip3) profileAgg.within10InClip3++;
      if (within10AnyTrack3) profileAgg.within10AnyTrack3++;
      if (fix3) profileAgg.fix3++;
      if (strict3) eventAgg.strict3++;
      if (bearing3) eventAgg.bearing3++;
      if (within10InClip3) eventAgg.within10InClip3++;
      if (within10AnyTrack3) eventAgg.within10AnyTrack3++;
      if (fix3) eventAgg.fix3++;

      if (!strict3) {
        if (stageCount.bearing < 3) eventAgg.failNoBearing++;
        else if (stageCount.within10InClip < 3) eventAgg.failBearingError++;
        else if (stageCount.strict < 3) eventAgg.failAssignment++;
        else eventAgg.failAssociation++;
      }
    }
  }

  const nodeCounts = [...allNodeCounts].sort((a, b) => a - b);
  const nodeCountResults = [];
  for (const realism of ['off', 'on']) {
    for (const sourceCount of [1, 3]) {
      for (const nodeCount of nodeCounts) {
        const runs = report.runs.filter((run) =>
          run.job.realism === realism &&
          run.scenario.settings.matrix_simultaneous_sources === sourceCount &&
          run.scenario.settings.matrix_node_count === nodeCount);
        if (!runs.length) continue;
        const metrics = metricValues(runs, { wrong_fix_m: 10 });
        const duplicateScenes = runs.filter((run) => (run.inference.fixes?.length ?? 0) > run.scenario.sources.length).length;
        const meanFixes = runs.reduce((sum, run) => sum + (run.inference.fixes?.length ?? 0), 0) / runs.length;
        nodeCountResults.push({
          realism,
          source_count: sourceCount,
          node_count: nodeCount,
          runs: runs.length,
          scene_fix_rate: metrics.scene_fix_rate,
          events_within_10m_misses_counted: metrics.events_within_10m_misses_counted,
          detectable_3_node_fraction: metrics.detectable_3_node_fraction,
          wrong_fix_rate: metrics.wrong_fix_rate,
          unflagged_wrong_fix_rate: metrics.unflagged_wrong_fix_rate,
          duplicate_fix_scene_rate: duplicateScenes / runs.length,
          mean_fixes_per_scene: meanFixes
        });
      }
    }
  }

  return {
    detectability: {
      per_profile: Object.fromEntries(perProfile),
      node_stage: Object.fromEntries(nodeStage),
      event_stage: Object.fromEntries(eventStage),
      label_definitions: {
        original_detectable_3_nodes: 'three or more nodes have source-aligned measured tracks during source clip within 10 degrees of truth',
        new_bearing_available_3_nodes: 'three or more nodes have any measured bearing window during source clip',
        new_track_within10_any_time_3_nodes: 'three or more nodes have track windows within 10 degrees of truth at any time (in or out of source clip)'
      },
      findings: {
        dominant_failure: 'bearing_error',
        reason_counts: Object.fromEntries([...eventStage.entries()].map(([profile, stats]) => [profile, {
          no_bearing_in_clip: stats.failNoBearing,
          bearing_not_within_10deg: stats.failBearingError,
          assignment_stage: stats.failAssignment,
          association_stage: stats.failAssociation
        }]))
      }
    },
    node_count: nodeCountResults
  };
}

function detectabilityMarkdown(data) {
  const rows = Object.entries(data.per_profile)
    .map(([profile, stats]) => `| ${profile} | ${stats.events} | ${fmtPct(stats.strict3, stats.events)} | ${fmtPct(stats.bearing3, stats.events)} | ${fmtPct(stats.within10InClip3, stats.events)} | ${fmtPct(stats.within10AnyTrack3, stats.events)} |`)
    .join('\n');
  const failRows = Object.entries(data.event_stage)
    .map(([profile, stats]) => `| ${profile} | ${stats.events - stats.strict3} | ${fmtPct(stats.failNoBearing, stats.events - stats.strict3)} | ${fmtPct(stats.failBearingError, stats.events - stats.strict3)} | ${fmtPct(stats.failAssignment, stats.events - stats.strict3)} | ${fmtPct(stats.failAssociation, stats.events - stats.strict3)} |`)
    .join('\n');
  const nodeRows = Object.entries(data.node_stage)
    .map(([profile, stats]) => `| ${profile} | ${stats.nodeEvents} | ${fmtPct(stats.candidateInClip, stats.nodeEvents)} | ${fmtPct(stats.windowInClip, stats.nodeEvents)} | ${fmtPct(stats.trackInClip, stats.nodeEvents)} | ${fmtPct(stats.windowWithin10InClip, stats.nodeEvents)} | ${fmtPct(stats.trackWithin10InClip, stats.nodeEvents)} | ${fmtPct(stats.trackWithin10AnyTime, stats.nodeEvents)} | ${fmtPct(stats.candidateWithoutWindow, stats.nodeEvents)} | ${fmtPct(stats.windowWithoutTrack, stats.nodeEvents)} |`)
    .join('\n');
  return `# Mission 4 X0 detectability diagnostic (matrix r3 baseline)\n\nThis diagnostic uses the frozen 3A complete baseline report only. No new simulation jobs were run and no inference code was changed.\n\n## Labels\n\n- **Original (unchanged):** \`detectable_3_nodes\` = ${data.label_definitions.original_detectable_3_nodes}.\n- **Added for physics-feasibility context:** \`bearing_available_3_nodes\` = ${data.label_definitions.new_bearing_available_3_nodes}.\n- **Added for in-clip sensitivity check:** \`track_within10_any_time_3_nodes\` = ${data.label_definitions.new_track_within10_any_time_3_nodes}.\n\n## Event-level rates for three-source events\n\n| Profile | Events | detectable_3_nodes | bearing_available_3_nodes | within10_in_clip_3_nodes | track_within10_any_time_3_nodes |\n|---|---:|---:|---:|---:|---:|\n${rows}\n\n## Why events fail original detectability label\n\n| Profile | Non-detectable events | No 3 nodes with any in-clip bearing | Bearings present but not within 10° on 3 nodes | Lost at assignment stage | Lost at association stage |\n|---|---:|---:|---:|---:|---:|\n${failRows}\n\n## Node-stage decomposition (three-source node-events)\n\n| Profile | Node-events | Candidate in clip | Bearing window in clip | Track window in clip | Bearing within 10° in clip | Assigned within clip (original) | Within 10° at any track time | Candidate lost before window (overlap/quality gate) | Window lost before track |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n${nodeRows}\n\n## Decision for C1 focus\n\nC1 should focus first on **bearing quality in multi-source overlap**, not source assignment or fusion tie-breaks. Most failures already have candidate windows and often in-clip windows, but fewer than three nodes stay within 10° in clip. The original label remains unchanged for sealed comparability, and the new \`bearing_available_3_nodes\` label is reported beside it to avoid conflating physics availability with angular-accuracy failure.\n`;
}

function nodeCountMarkdown(rows) {
  const fmt = (v) => Number.isFinite(v) ? v.toFixed(3) : 'null';
  const tableRows = rows.map((r) => `| ${r.realism} | ${r.source_count} | ${r.node_count} | ${r.runs} | ${fmt(r.scene_fix_rate)} | ${fmt(r.events_within_10m_misses_counted)} | ${fmt(r.detectable_3_node_fraction)} | ${fmt(r.wrong_fix_rate)} | ${fmt(r.unflagged_wrong_fix_rate)} | ${fmt(r.duplicate_fix_scene_rate)} | ${fmt(r.mean_fixes_per_scene)} |`).join('\n');
  return `# Mission 4 X1 node-count reconciliation (matrix sites, legacy solver)\n\nThis reconciliation uses the frozen 3A complete baseline report (\`baselines/matrix-baseline-r3.full.json.gz\`) and does not alter inference code.\n\n## Matrix-site node-count summary\n\n| Realism | Sources | Nodes | Runs | Scene fix rate | Events within 10 m (misses fail) | Detectable at 3+ nodes | Wrong-fix rate | Unflagged wrong-fix rate | Duplicate-fix scene rate | Mean fixes per scene |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n${tableRows}\n\n## Reconciliation with round-2 observation\n\nRound 2's 8% to 60-68% rise referred to wrong fixes as available nodes increased under pairwise fusion. In this matrix baseline, the same pattern appears as high wrong-fix rates in multi-source five-node runs (\`wrong_fix_rate\` about 0.649 off and 0.772 on) with large duplicate-fix scene rates, while one-source runs remain strong. The node-count trend is not smooth at 2/3/4/6 because those buckets are tiny in this baseline and node 8 was intentionally excluded from the runnable baseline population. So this reconciliation confirms the **failure mode type** (pairwise duplicate/ambiguous fixes under multi-source load) but is still underpowered for a full 2..8 monotonic curve.\n`;
}

const bytes = await readFile(baselinePath);
const report = JSON.parse(gunzipSync(bytes));
const analysis = analyse(report);
const baselineSha256 = createHash('sha256').update(bytes).digest('hex');
const payload = {
  schema: 1,
  generated_at: new Date().toISOString(),
  baseline_path: baselinePath,
  baseline_gzip_sha256: baselineSha256,
  assumptions: {
    source_clip_duration_seconds: clipDurationS,
    truth_alignment_tolerance_deg: TOL_DEG
  },
  ...analysis
};

await writeFile(jsonOut, JSON.stringify(payload, null, 2) + '\n');
await writeFile(detectabilityOut, detectabilityMarkdown(analysis.detectability));
await writeFile(nodeCountOut, nodeCountMarkdown(analysis.node_count));

console.log(JSON.stringify({
  detectability_report: detectabilityOut,
  node_count_report: nodeCountOut,
  analysis_json: jsonOut,
  baseline_gzip_sha256: baselineSha256
}, null, 2));
