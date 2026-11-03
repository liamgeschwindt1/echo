// Labelling in the simulator with the echo app's own stack (P9 of the 0.4 upgrade). Runs after localisation and never
// changes a bearing or a fix. Per node and localised event, following the sound-disaggregation pipeline:
//   1. Stage 1 trigger: level over the rolling floor (the app's PeriodDetector) and the YAMNet watchlist (the group
//      corroboration rules in labels.json: Screaming >= 0.2, Glass/Shatter/Breaking >= 0.4, Gunshot >= 0.2).
//   2. Direction focus: delay-and-sum towards the node's bearing; the omni (mic 1) signal is kept as well.
//   3. Stage 2: the app's YAMNet + CLAP schedule and labelPeriods (group pooling, decoy floor, target share, YAMNet
//      corroboration) on a window with pre-roll cut from the rendered node audio, once per event and input.
//   4. Multi-label: each class's peak CLAP cosine in the period against its own threshold, as well as the winner.
// Nothing derived from audio is returned: labels, scores, confidences and times only (no audio, spectra or embeddings).
// Sim audio is synthetic (clip + modelled propagation and air absorption, no wind, rain, housing scattering or
// coloured noise): accuracy measured here is not a prediction of real-world accuracy.
import { PRIORITY_RANK, priorityFor } from '@echo/shared/catalogue.js';
import { classify, CLAP_MODES } from './label.js';
import { delayAndSum } from './beamform.js';
import { speedOfSound } from './physics.js';

export const LABELLING_NOTE =
  'Sim audio is synthetic: clip plus modelled propagation and air absorption, with no wind, rain, housing scattering or coloured noise. Classifier accuracy measured here is not a prediction of real-world accuracy.';
export const ASSOCIATION_RULE =
  'A labelled period belongs to a source at a node when its start lies within label_assoc_tol_s of the expected arrival (source start + first-path delay from the true position); the closest start wins.';

/** Ground truth of a clip from the editable manifest: { label, group, accept: [labels counted correct] } or null. */
export function truthFor(manifest, cat, clipId) {
  const e = manifest?.clips?.[clipId];
  if (!e || !e.label) return null;
  const cls = cat.classById.get(e.label);
  return { label: e.label, group: e.group ?? cls?.group ?? cls?.family ?? null, accept: [e.label, ...(e.also || [])], cosine_min: e.cosine_min ?? null };
}

const groupOf = (cat, label) => (label ? cat.classById.get(label)?.group ?? cat.classById.get(label)?.family ?? null : null);

// YAMNet watchlist hits in [t0, t1] (segment seconds) from the per-window scores classify() returned.
function watchlistHits(yamnetRows, t0, t1, cat) {
  const hits = [];
  for (const [group, g] of Object.entries(cat.groups)) {
    for (const r of g.corroboration || []) {
      const peak = Math.max(0, ...yamnetRows.filter((y) => y.t >= t0 && y.t - 0.975 <= t1).map((y) => y.scores[r.name] ?? 0));
      if (peak >= r.min) hits.push({ group, name: r.name, peak, min: r.min });
    }
  }
  return hits;
}

// Peak CLAP cosine per class over the windows that overlap [t0, t1]; classes over their threshold, highest first.
function multiLabels(clapRows, t0, t1, windowS, threshold) {
  const peak = new Map();
  for (const row of clapRows) {
    if (row.t < t0 || row.t - windowS > t1) continue;
    for (const [cls, v] of Object.entries(row.scores)) peak.set(cls, Math.max(peak.get(cls) ?? -1, v.cosine));
  }
  return [...peak]
    .filter(([cls, v]) => v >= threshold(cls))
    .sort((a, b) => b[1] - a[1])
    .map(([cls, cosine]) => ({ label: cls, cosine }));
}

/**
 * Labels every heard node of every source. results: analyseScenario output (not modified except `labelling` fields).
 * opts: { cat, runners, manifest, settings, onProgress }. settings.labelling_mode 'model' runs the models, 'oracle'
 * substitutes the true labels (so a failure can be put on the classifier or on the localiser).
 * Returns { events, sources, summary, models, association_rule, notes }.
 */
export async function labelEvents(scenario, rendered, results, { cat, runners, manifest, settings = scenario.settings, clipDurations = new Map(), onProgress, models = null } = {}) {
  const fs = rendered.sample_rate;
  const c = speedOfSound(settings.temperature_c);
  const oracle = settings.labelling_mode === 'oracle';
  const mode = settings.label_clap_mode || 'clap5';
  const clapWindowS = CLAP_MODES[mode].window_s;
  const preRoll = settings.label_pre_roll_s;
  const timeOfDay = 'day'; // label.js stamps periods at 12:00 UTC
  const events = [];
  const jobs = results.reduce((a, r) => a + r.nodes.filter((n) => n.heard).length, 0) * (oracle ? 1 : 2);
  let done = 0;

  for (const r of results) {
    const src = scenario.sources.find((s) => s.id === r.source_id);
    const truth = truthFor(manifest, cat, src.clip);
    const dur = clipDurations.get(src.clip) ?? 1;
    for (const n of r.nodes) {
      if (!n.heard) continue;
      const ni = scenario.nodes.findIndex((x) => x.id === n.node_id);
      const rn = rendered.nodes[ni];
      const tArr = n.first_arrival_s;
      const a = Math.max(0, Math.round((tArr - preRoll) * fs));
      const b = Math.min(rendered.length, Math.max(a + Math.round((clapWindowS + 0.5) * fs), Math.round((tArr + dur + 1) * fs)));
      const segStart = a / fs;
      const inputs = [{ input: 'omni', signal: () => rn.mics[0].slice(a, b) }];
      if (n.bearing) inputs.push({ input: 'beamformed', signal: () => delayAndSum(rn.mics, rn.mic_positions, n.bearing.direction, { c, fs, a, b }) });
      for (const inp of inputs) {
        const base = {
          source_id: r.source_id,
          node_id: n.node_id,
          input: inp.input,
          band_hz: [0, fs / 2],
          band_note: 'full band (classification), not the localisation band',
          true_label: truth?.label ?? null,
          true_group: truth?.group ?? null,
          overlapped: (n.overlapped_with?.length ?? 0) > 0,
          n_overlapping: n.overlapped_with?.length ?? 0,
          node_snr_db: n.snr_detection_db ?? n.snr_db,
          localisation_status: n.localisation_status,
          direct_blocked: n.direct_blocked,
          nearest_reflector_m: n.nearest_reflector_m
        };
        if (oracle) {
          if (inp.input !== 'omni') continue;
          const label = truth?.label ?? null;
          events.push({ ...base, input: 'oracle', detected: !!label, label, group: groupOf(cat, label), confidence: label ? 1 : 0, priority: label ? priorityFor(cat, label, timeOfDay) : null, multi_labels: label ? [{ label, cosine: null }] : [], correct: truth ? true : null, correct_top3: truth ? true : null, first_detection_s: tArr, lag_s: 0 });
          onProgress?.(++done / jobs);
          continue;
        }
        const out = await classify(inp.signal(), fs, mode, { cat, runners, settings: {} });
        onProgress?.(++done / jobs);
        // Association: period start nearest the expected arrival, within the tolerance.
        const expected = tArr - segStart;
        const cand = out.periods.filter((p) => Math.abs(p.start_s - expected) <= settings.label_assoc_tol_s || (p.start_s <= expected && p.end_s >= expected));
        const p = cand.sort((x, y) => Math.abs(x.start_s - expected) - Math.abs(y.start_s - expected))[0];
        const watch = watchlistHits(out.yamnet, expected - 0.5, expected + dur, cat);
        const trigger = { level: !!p, yamnet: watch.length > 0, watchlist: watch, onset: p?.onset ?? null };
        if (!p) {
          events.push({ ...base, detected: false, trigger, label: null, group: null, correct: truth ? false : null, correct_top3: truth ? false : null });
          continue;
        }
        const thr = (cls) => (truth && cls === truth.label && truth.cosine_min != null ? truth.cosine_min : manifest?.clips?.[cls]?.cosine_min ?? settings.label_cosine_min);
        const multi = multiLabels(out.clap, p.start_s, p.end_s, clapWindowS, thr);
        const top3 = [p.label, ...(p.clap?.top || []).map((x) => x.class)].filter(Boolean).slice(0, 3);
        events.push({
          ...base,
          detected: true,
          trigger,
          first_detection_s: segStart + p.start_s,
          lag_s: segStart + p.start_s - tArr,
          period_s: [segStart + p.start_s, segStart + p.end_s],
          label: p.label,
          label_text: p.label_text,
          group: groupOf(cat, p.label),
          confidence: p.confidence,
          agreement: p.agreement,
          priority: p.default_priority,
          target_share: p.target_share,
          group_shares: p.group_shares,
          yamnet_corroboration: p.target_share?.corroborated_by ?? watch.map((w) => w.name),
          rule_flags: p.rule_flags,
          yamnet_top: p.yamnet?.top?.[0]?.raw_label ?? null,
          clap_top: p.clap?.top?.[0]?.class ?? null,
          multi_labels: multi,
          correct: truth ? truth.accept.includes(p.label) : null,
          correct_top3: truth ? top3.some((l) => truth.accept.includes(l)) : null
        });
      }
    }
  }

  const sources = crossNode(scenario, results, events, cat, manifest);
  return {
    mode: oracle ? 'oracle' : 'model',
    clap_mode: mode,
    events,
    sources,
    summary: summarise(events, cat, scenario),
    models: models ?? (oracle ? null : { note: 'runner versions supplied by the caller' }),
    association_rule: ASSOCIATION_RULE,
    notes: [LABELLING_NOTE]
  };
}

// Cross-node association: per source, the confidence-weighted vote of its detected nodes (beamformed input when it
// exists). Same-class sources overlapping in time cannot be told apart by label: they are reported, not separated.
function crossNode(scenario, results, events, cat, manifest) {
  return results.map((r) => {
    const src = scenario.sources.find((s) => s.id === r.source_id);
    const mine = events.filter((e) => e.source_id === r.source_id && e.detected);
    const pref = mine.some((e) => e.input === 'beamformed') ? 'beamformed' : mine.some((e) => e.input === 'oracle') ? 'oracle' : 'omni';
    const votes = new Map();
    for (const e of mine.filter((x) => x.input === pref)) votes.set(e.label, (votes.get(e.label) ?? 0) + (e.confidence ?? 0));
    const best = [...votes].sort((a, b) => b[1] - a[1])[0];
    const truth = truthFor(manifest, cat, src.clip);
    const span = [Math.min(...r.nodes.map((n) => n.arrival_span_s?.[0] ?? Infinity)), Math.max(...r.nodes.map((n) => n.arrival_span_s?.[1] ?? -Infinity))];
    const sameClass = truth
      ? results.filter((o) => {
          if (o.source_id === r.source_id) return false;
          const os = scenario.sources.find((s) => s.id === o.source_id);
          const ot = truthFor(manifest, cat, os.clip);
          const ospan = [Math.min(...o.nodes.map((n) => n.arrival_span_s?.[0] ?? Infinity)), Math.max(...o.nodes.map((n) => n.arrival_span_s?.[1] ?? -Infinity))];
          return ot?.label === truth.label && Math.min(span[1], ospan[1]) > Math.max(span[0], ospan[0]);
        }).map((o) => o.source_id)
      : [];
    const labels = new Set(mine.filter((x) => x.input === pref).map((e) => e.label));
    return {
      source_id: r.source_id,
      input: pref,
      label: best?.[0] ?? null,
      group: groupOf(cat, best?.[0] ?? null),
      nodes_detected: new Set(mine.map((e) => e.node_id)).size,
      true_label: truth?.label ?? null,
      correct: truth && best ? truth.accept.includes(best[0]) : truth ? false : null,
      node_labels_disagree: labels.size > 1,
      same_class_sources: sameClass,
      association: sameClass.length ? 'bearing_and_track (same class: label cannot separate)' : 'label_and_onset',
      same_class_ambiguous: sameClass.length > 0 && (r.usable_nodes ?? 0) < 2
    };
  });
}

const snrBin = (v) => (v === null || v === undefined ? 'unknown' : v < 10 ? '<10 dB' : v < 20 ? '10-20 dB' : '>=20 dB');
const overlapBin = (k) => (k === 0 ? '0' : k === 1 ? '1' : '2+');

function metrics(list, cat) {
  const scored = list.filter((e) => e.true_label);
  const alertTruth = scored.filter((e) => priorityFor(cat, e.true_label, 'day') === 'alert');
  const lags = list.filter((e) => e.detected && Number.isFinite(e.lag_s)).map((e) => e.lag_s);
  return {
    n: list.length,
    scored: scored.length,
    detected: list.filter((e) => e.detected).length,
    top1: scored.length ? scored.filter((e) => e.correct).length / scored.length : null,
    top3: scored.length ? scored.filter((e) => e.correct_top3).length / scored.length : null,
    alert_recall: alertTruth.length ? alertTruth.filter((e) => e.priority === 'alert').length / alertTruth.length : null,
    false_alerts: list.filter((e) => e.priority === 'alert' && !(e.true_label && priorityFor(cat, e.true_label, 'day') === 'alert')).length,
    mean_time_to_detection_s: lags.length ? lags.reduce((a, b) => a + b, 0) / lags.length : null
  };
}

function groupBy(list, key) {
  const m = {};
  for (const e of list) (m[key(e)] ??= []).push(e);
  return m;
}

/** Per input type and per true group, with breakdowns by number of overlapping sources and by node SNR. */
export function summarise(events, cat) {
  const out = {};
  for (const [input, list] of Object.entries(groupBy(events, (e) => e.input))) {
    out[input] = {
      all: metrics(list, cat),
      by_group: Object.fromEntries(Object.entries(groupBy(list, (e) => e.true_group ?? 'unscored')).map(([k, v]) => [k, metrics(v, cat)])),
      by_overlap: Object.fromEntries(Object.entries(groupBy(list, (e) => overlapBin(e.n_overlapping))).map(([k, v]) => [k, metrics(v, cat)])),
      by_snr: Object.fromEntries(Object.entries(groupBy(list, (e) => snrBin(e.node_snr_db))).map(([k, v]) => [k, metrics(v, cat)]))
    };
  }
  return out;
}

/**
 * Wiring check: the app path (classify on the clean clip with pre-roll) against the sim path (the same clip rendered at
 * a short, high-SNR distance and labelled through labelEvents, omni). Returns both labels and whether they agree; when
 * they do not, the stack is not wired the same way and labelling results should not be used.
 */
export async function labellingSanityCheck({ clip, clipId, fs, cat, runners, renderOne }) {
  const pre = new Float32Array(Math.round(3 * fs));
  const app = await classify(Float32Array.from([...pre, ...clip, ...new Float32Array(Math.round(2 * fs))]), fs, 'clap5', { cat, runners });
  const appPeriod = app.periods.find((p) => p.start_s >= 2.5) ?? app.periods[0] ?? null;
  const { scenario, rendered, results } = await renderOne(clipId);
  const sim = await labelEvents(scenario, rendered, results, { cat, runners, manifest: null, settings: { ...scenario.settings, labelling_mode: 'model' }, clipDurations: new Map([[clipId, clip.length / fs]]) });
  const simEvent = sim.events.find((e) => e.input === 'omni');
  const appLabel = appPeriod?.label ?? null;
  const simLabel = simEvent?.label ?? null;
  return { app_label: appLabel, sim_label: simLabel, agree: appLabel === simLabel, app_priority: appPeriod?.default_priority ?? null, sim_priority: simEvent?.priority ?? null, priority_rank_gap: appPeriod && simEvent?.priority ? PRIORITY_RANK[appPeriod.default_priority] - PRIORITY_RANK[simEvent.priority] : null };
}
