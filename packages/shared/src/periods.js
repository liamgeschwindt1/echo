// Deterministic period detection (section 6.1) and labelling (6.2-6.5).
// No AI here: the 10 Hz level series finds the periods, model readings label them.
import { PRIORITY_RANK, isContextFamily, maxPriority, priorityFor, timeOfDay, UNEXPLAINED_IMPACT } from './catalogue.js';

const FLOOR_WINDOW_MS = 120_000;
const FLOOR_MIN_HISTORY_MS = 2_000;
const END_HOLD_MS = 2_000;
const IMPULSE_RISE_WINDOW_MS = 200;
const IMPULSE_MAX_MS = 1_500;
const IMPULSE_MIN_MS = 100;
const SUSTAINED_DELTA_DB = 6;
const BLOCK_MS = 100;
const DB_FLOOR = -120;

const round = (v, d = 1) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function powerMeanDb(values) {
  if (!values.length) return null;
  let sum = 0;
  for (const v of values) sum += 10 ** (v / 10);
  return 10 * Math.log10(sum / values.length);
}

// Longest stretch at >= threshold, bridging dips shorter than END_HOLD_MS.
function longestRunMs(samples, threshold) {
  let best = 0;
  let runStart = null;
  let lastAbove = null;
  for (const s of samples) {
    if (s.rms >= threshold) {
      if (runStart === null || s.t - lastAbove > END_HOLD_MS) runStart = s.t - BLOCK_MS;
      lastAbove = s.t;
      best = Math.max(best, lastAbove - runStart);
    }
  }
  return best;
}

// Sharp level rises (separate bangs) inside the period, at least 300 ms apart.
function countImpacts(samples, floor, s) {
  let count = 0;
  let lastAt = -Infinity;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i];
    if (x.rms <= floor + s.on_threshold_db || x.t - lastAt < 300) continue;
    let minPrev = x.rms;
    for (let j = i - 1; j >= 0 && x.t - samples[j].t <= IMPULSE_RISE_WINDOW_MS; j--) minPrev = Math.min(minPrev, samples[j].rms);
    if (x.rms - minPrev >= s.impulse_rise_db) {
      count++;
      lastAt = x.t;
    }
  }
  return count;
}

export class PeriodDetector {
  // getSettings() returns the flat settings object; onChange(periods) fires when a period closes.
  constructor(getSettings, onChange, existing = []) {
    this.getSettings = getSettings;
    this.onChange = onChange;
    this.periods = existing;
    this.history = [];
    this.floor = null;
    this.lastFloorAt = 0;
    this.sessionStartT = null;
    this.candStart = null;
    this.active = null;
    this.lastClosedSamples = [];
    this.nextId = existing.length + 1;
  }

  reset() {
    this.history = [];
    this.floor = null;
    this.candStart = null;
    this.active = null;
    this.sessionStartT = null;
  }

  _updateFloor(t) {
    if (t - this.lastFloorAt < 1000 && this.floor !== null) return;
    this.lastFloorAt = t;
    if (t - this.sessionStartT < FLOOR_MIN_HISTORY_MS) return;
    this.floor = percentile(this.history.map((h) => h.rms), 10);
  }

  push(t, rmsIn, peakIn) {
    const rms = Number.isFinite(rmsIn) ? Math.max(rmsIn, DB_FLOOR) : DB_FLOOR;
    const peak = Number.isFinite(peakIn) ? Math.max(peakIn, DB_FLOOR) : DB_FLOOR;
    if (this.sessionStartT === null) this.sessionStartT = t;
    const prev = this.history.filter((h) => h.t >= t - IMPULSE_RISE_WINDOW_MS);
    this.history.push({ t, rms });
    while (this.history.length && this.history[0].t < t - FLOOR_WINDOW_MS) this.history.shift();
    this._updateFloor(t);
    if (this.floor === null) return;

    const s = this.getSettings();
    const sample = { t, rms, peak };

    if (!this.active) {
      const onLevel = this.floor + s.on_threshold_db;
      const minPrev = prev.length ? Math.min(...prev.map((h) => h.rms)) : rms;
      const impulse = prev.length > 0 && rms - minPrev >= s.impulse_rise_db && rms > onLevel;
      if (impulse) {
        this._open((this.candStart ?? t) - BLOCK_MS, true, sample);
      } else if (rms > onLevel) {
        if (this.candStart === null) this.candStart = t;
        if (t - this.candStart + BLOCK_MS >= s.min_duration_s * 1000) this._open(this.candStart - BLOCK_MS, false, sample);
      } else {
        this.candStart = null;
      }
      return;
    }

    const a = this.active;
    a.samples.push(sample);
    if (rms < a.floor + s.off_threshold_db) {
      if (a.belowSince === null) a.belowSince = t;
      if (t - a.belowSince >= END_HOLD_MS) this._close(a.belowSince - BLOCK_MS);
    } else {
      a.belowSince = null;
    }
  }

  _open(start, impulseStart, sample) {
    this.candStart = null;
    this.active = { start, impulseStart, floor: this.floor, samples: [sample], belowSince: null };
  }

  // Ends the open period (e.g. on Stop).
  flush(t) {
    if (this.active) this._close(this.active.belowSince ? this.active.belowSince - BLOCK_MS : t);
    this.candStart = null;
  }

  _close(end) {
    const a = this.active;
    this.active = null;
    const s = this.getSettings();
    end = Math.max(end, a.start + IMPULSE_MIN_MS);
    const samples = a.samples.filter((x) => x.t > a.start && x.t <= end + 1);
    const duration = end - a.start;
    const impulse = a.impulseStart && duration <= IMPULSE_MAX_MS;
    if (!impulse && duration < s.min_duration_s * 1000) return;

    const last = this.periods[this.periods.length - 1];
    if (last && a.start - Date.parse(last.end) < s.merge_gap_s * 1000) {
      const merged = [...this.lastClosedSamples, ...samples];
      Object.assign(last, this._stats(Date.parse(last.start), end, merged, last.floor_dbfs, false, s));
      this.lastClosedSamples = merged;
    } else {
      const p = { id: `p${String(this.nextId++).padStart(3, '0')}`, ...this._stats(a.start, end, samples, a.floor, impulse, s) };
      this.periods.push(p);
      this.lastClosedSamples = samples;
    }
    this.onChange?.(this.periods);
  }

  _stats(start, end, samples, floor, impulse, s) {
    const avg = powerMeanDb(samples.map((x) => x.rms)) ?? floor;
    const peak = samples.length ? Math.max(...samples.map((x) => x.peak)) : avg;
    const duration_s = (end - start) / 1000;
    const sustained = longestRunMs(samples, floor + SUSTAINED_DELTA_DB) >= s.sustained_min * 60_000;
    return {
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      duration_s: round(duration_s, 2),
      onset: impulse && duration_s <= IMPULSE_MAX_MS / 1000 ? 'impulse' : 'gradual',
      time_of_day: timeOfDay(start, s),
      level_avg_dbfs: round(avg),
      level_peak_dbfs: round(peak),
      floor_dbfs: round(floor),
      delta_over_floor_db: round(avg - floor),
      sustained,
      impacts: countImpacts(samples, floor, s)
    };
  }

  // Live view of the open period for the graph.
  current(now) {
    return this.active ? { start: this.active.start, end: now, open: true } : null;
  }
}

// ---------- labelling ----------

const rowTimes = new WeakMap();
function rowTime(row) {
  let t = rowTimes.get(row);
  if (t === undefined) rowTimes.set(row, (t = Date.parse(row.timestamp)));
  return t;
}

function overlapMs(a0, a1, b0, b1) {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

function scoresOf(row) {
  const s = row.scores_json;
  return typeof s === 'string' ? JSON.parse(s) : s || {};
}

function poolYamnet(rows, a, b, cat) {
  const dur = b - a;
  const hits = rows.filter((r) => {
    const t = rowTime(r);
    const w = r.window_s * 1000;
    return overlapMs(a, b, t - w, t) >= 0.5 * Math.min(w, dur);
  });
  const labelSum = new Map();
  const labelMax = new Map();
  const famSum = new Map();
  const famMax = new Map();
  for (const r of hits) {
    const scores = scoresOf(r);
    const famWin = new Map();
    for (const [name, score] of Object.entries(scores)) {
      labelSum.set(name, (labelSum.get(name) || 0) + score);
      labelMax.set(name, Math.max(labelMax.get(name) || 0, score));
      const m = cat.yamnetByName.get(name);
      const fam = cat.yamnetPool.get(name);
      if (fam) famWin.set(fam, Math.max(famWin.get(fam) || 0, score * (m?.weight ?? 1)));
    }
    for (const [fam, v] of famWin) {
      famSum.set(fam, (famSum.get(fam) || 0) + v);
      famMax.set(fam, Math.max(famMax.get(fam) || 0, v));
    }
  }
  const n = hits.length;
  const labels = [...labelSum.entries()]
    .map(([name, sum]) => {
      const m = cat.yamnetByName.get(name);
      return { raw_label: name, label: m?.label ?? null, family: m?.family ?? 'other', pool: cat.yamnetPool.get(name) ?? 'other', weight: m?.weight ?? 1, mean: round(sum / n, 4), max: round(labelMax.get(name), 4) };
    })
    .sort((x, y) => y.mean - x.mean);
  const family_scores = {};
  const family_max = {};
  for (const [fam, sum] of famSum) {
    family_scores[fam] = round(sum / n, 4);
    family_max[fam] = round(famMax.get(fam), 4);
  }
  return { n, labels, family_scores, family_max };
}

function poolClap(rows, a, b, cat) {
  const dur = b - a;
  const hits = rows.filter((r) => {
    const t = rowTime(r);
    const w = r.window_s * 1000;
    const ov = overlapMs(a, b, t - w, t);
    return ov >= 0.6 * dur || ov >= 0.6 * w;
  });
  const sum = new Map();
  const max = new Map();
  for (const r of hits) {
    for (const [cls, v] of Object.entries(scoresOf(r))) {
      const p = typeof v === 'number' ? v : v.softmax;
      sum.set(cls, (sum.get(cls) || 0) + p);
      max.set(cls, Math.max(max.get(cls) || 0, p));
    }
  }
  const n = hits.length;
  const classes = [...sum.entries()]
    .map(([cls, s]) => ({ class: cls, family: cat.classById.get(cls)?.family ?? 'other', pool: cat.classPool.get(cls) ?? 'other', mean: round(s / n, 4), max: round(max.get(cls), 4) }))
    .sort((x, y) => y.mean - x.mean);
  const family_scores = {};
  for (const c of classes) family_scores[c.pool] = round((family_scores[c.pool] || 0) + c.mean, 4);
  const windows = [...new Set(hits.map((r) => r.window_s))];
  return { n, classes, family_scores, window_s: windows.length === 1 ? windows[0] : windows.length ? windows : null };
}

function topFamily(familyScores, includeContext = false) {
  let best = null;
  for (const [fam, v] of Object.entries(familyScores)) {
    if (!includeContext && isContextFamily(fam)) continue;
    if (!best || v > best.score) best = { family: fam, score: v };
  }
  return best;
}

function pickLabel(family, y, c, clapOk, s, cat) {
  const yInFam = y.labels.filter((l) => l.pool === family && l.label).sort((a, b) => b.mean * b.weight - a.mean * a.weight);
  if (yInFam[0] && yInFam[0].mean * yInFam[0].weight >= s.yamnet_min) return { label: yInFam[0].label, source: 'yamnet' };
  const cInFam = c.classes.filter((x) => x.pool === family);
  if (cInFam[0] && (clapOk || !yInFam[0])) return { label: cInFam[0].class, source: 'clap' };
  if (yInFam[0]) return { label: yInFam[0].label, source: 'yamnet' };
  return { label: cat.pools[family]?.default_label ?? null, source: 'family_default' };
}

function confidenceFor(agreement, yScore, cScore, s) {
  const yn = Math.min(1, (yScore || 0) / Math.max(s.yamnet_min * 3, 1e-6));
  const cn = Math.min(1, (cScore || 0) / Math.max(s.clap_min * 2.5, 1e-6));
  let c;
  if (agreement === 'agree') c = 0.55 + 0.45 * ((yn + cn) / 2);
  else if (agreement === 'partial') c = 0.3 + 0.4 * Math.max(yn, cn);
  else if (agreement === 'disagree') c = 0.25 + 0.25 * Math.max(yn, cn);
  else c = 0.1 + 0.2 * Math.max(yn, cn);
  return round(Math.min(1, Math.max(0, c)), 2);
}

function labelInterval(a, b, yRows, cRows, s, cat) {
  const y = poolYamnet(yRows, a, b, cat);
  const durS = (b - a) / 1000;
  let c = poolClap(cRows, a, b, cat);
  // Short periods use only 5 s readings when any exist for them.
  let shortEvent = false;
  if (durS < SHORT_EVENT_S) {
    const c5 = poolClap(cRows.filter((r) => r.window_s === 5), a, b, cat);
    if (c5.n > 0) {
      c = c5;
      shortEvent = true;
    }
  }
  const clapUnreliable = shortEvent ? false : durS < 3 || c.n === 0;
  const yTop = y.n ? topFamily(y.family_scores) : null;
  const cTop = !clapUnreliable ? topFamily(c.family_scores) : null;
  const yAbove = !!yTop && yTop.score >= s.yamnet_min;
  const cAbove = !!cTop && cTop.score >= s.clap_min;
  let agreement;
  if (yAbove && cAbove) agreement = yTop.family === cTop.family ? 'agree' : 'disagree';
  else if (yAbove || cAbove) agreement = 'partial';
  else agreement = 'none';

  let family = null;
  if (agreement === 'agree' || (agreement === 'partial' && yAbove)) family = yTop.family;
  else if (agreement === 'partial') family = cTop.family;
  else if (agreement === 'disagree') family = yTop.score / s.yamnet_min >= cTop.score / s.clap_min ? yTop.family : cTop.family;
  else {
    // Weak evidence only: take the stronger model if it reaches at least half its minimum.
    const yr = yTop ? yTop.score / s.yamnet_min : 0;
    const cr = cTop ? cTop.score / s.clap_min : 0;
    if (Math.max(yr, cr) >= 0.5) family = yr >= cr ? yTop.family : cTop.family;
  }

  // Context-only: every model that produced readings has a context/other family on top.
  const yAny = y.n ? topFamily(y.family_scores, true) : null;
  const cAny = c.n ? topFamily(c.family_scores, true) : null;
  const contextOnly = [yAny, cAny].filter(Boolean).every((t) => isContextFamily(t.family));

  const picked = family ? pickLabel(family, y, c, !clapUnreliable, s, cat) : { label: null, source: null };
  // Context labels (e.g. crowd_chatter) are only candidates when no target family won.
  let contextLabel = null;
  if (!family) {
    const yc = y.labels.find((l) => l.label && l.pool === 'context' && l.mean * l.weight >= s.yamnet_min);
    const cc = !clapUnreliable ? c.classes.find((x) => x.pool === 'context' && x.mean >= s.clap_min) : null;
    contextLabel = cc?.class ?? yc?.label ?? null;
  }
  return { y, c, clapUnreliable, shortEvent, yTop, cTop, agreement, family, picked, contextOnly, contextLabel };
}

const SHORT_EVENT_S = 4;

// Target members' share of the pooled CLAP score inside one group. Null when CLAP is not usable.
function targetShare(L, members) {
  const mean = new Map(L.c.classes.map((x) => [x.class, x.mean]));
  let total = 0;
  let target = 0;
  let topTarget = null;
  let topDecoy = null;
  for (const m of members) {
    const v = mean.get(m.id) || 0;
    total += v;
    if (m.role === 'target') {
      target += v;
      if (!topTarget || v > topTarget.v) topTarget = { id: m.id, v };
    } else if (!topDecoy || v > topDecoy.v) topDecoy = { id: m.id, v };
  }
  const usable = !L.clapUnreliable && L.c.n > 0 && total > 0;
  return { value: usable ? round(target / total, 4) : null, target_sum: round(target, 4), group_total: round(total, 4), top_target: topTarget?.id ?? null, top_decoy: topDecoy?.id ?? null };
}

// YAMNet labels that corroborate a group (peak score in the period), from labels.json groups.
function corroboratedBy(y, group, cat) {
  const rules = cat.groups[group]?.corroboration || [];
  return rules.filter((r) => (y.labels.find((l) => l.raw_label === r.name)?.max ?? 0) >= r.min).map((r) => r.name);
}

// Builds the full period objects (section 9) from raw detector periods and model rows.
export function labelPeriods(rawPeriods, rows, notes, s, cat) {
  const yRows = rows.filter((r) => r.model === 'yamnet');
  const cRows = rows.filter((r) => r.model === 'clap');
  return rawPeriods.map((p) => {
    const a = Date.parse(p.start);
    const b = Date.parse(p.end);
    const L = labelInterval(a, b, yRows, cRows, s, cat);
    const group_shares = {};
    for (const g of Object.keys(cat.groups)) {
      const members = cat.classes.filter((k) => k.group === g);
      if (members.some((k) => k.role === 'target') && members.some((k) => k.role === 'confuser')) group_shares[g] = targetShare(L, members);
    }
    const rule_flags = [];
    let label = L.picked.label;
    let family = label ? cat.classById.get(label)?.family ?? L.family : null;
    let source = L.picked.source ? `${L.agreement}:${L.picked.source}` : null;

    if (p.onset === 'impulse' && p.delta_over_floor_db >= 15 && (L.agreement === 'none' || L.contextOnly)) {
      label = UNEXPLAINED_IMPACT;
      family = 'impacts_breakage';
      source = 'rule';
      rule_flags.push('unexplained_impact');
    }
    if (p.sustained) rule_flags.push('sustained');

    if (!label && L.contextLabel && priorityFor(cat, L.contextLabel, p.time_of_day, p.sustained) !== 'ignore') {
      label = L.contextLabel;
      family = cat.classById.get(label)?.family ?? null;
      source = `${L.agreement}:context`;
    }

    let default_priority;
    let label_text = null;
    let target_share = null;
    const decoyCls = label ? cat.classById.get(label) : null;
    const isDecoy = decoyCls?.role === 'confuser' && decoyCls.group && group_shares[decoyCls.group];
    if (isDecoy) {
      const gs = group_shares[decoyCls.group];
      const hit = corroboratedBy(L.y, decoyCls.group, cat);
      const base = s.target_share_min ?? 0.25;
      const drop = hit.length ? s.target_share_corroboration_drop ?? 0.1 : 0;
      const threshold = Math.max(0, base - drop);
      const promoted = gs.value != null && gs.value >= threshold && !!gs.top_target;
      target_share = { group: decoyCls.group, value: gs.value, threshold: round(threshold, 4), corroborated_by: hit, decoy: label, promoted };
      rule_flags.push(`target_share:${gs.value ?? 'n/a'}`);
      if (promoted) {
        label_text = `possible ${gs.top_target}, decoy ${label} close`;
        label = gs.top_target;
        family = cat.classById.get(label)?.family ?? family;
        source = 'target_share';
      }
    }

    default_priority = label
      ? priorityFor(cat, label, p.time_of_day, p.sustained)
      : p.sustained
        ? cat.priorities.sustained_min_priority || 'flag'
        : 'ignore';

    // A decoy that still leads a group containing targets never drops below flag.
    if (isDecoy && !target_share.promoted) {
      const raised = maxPriority(default_priority, 'flag');
      if (raised !== default_priority) {
        default_priority = raised;
        rule_flags.push('decoy_floor');
      }
    }
    if (L.shortEvent) rule_flags.push('short_event');

    // A long or repeated glass event is more likely a bottle bank than a window.
    if (label === 'glass_break' && PRIORITY_RANK[default_priority] > PRIORITY_RANK.flag) {
      const maxS = s.glass_max_alert_s ?? 6;
      const maxImpacts = s.glass_max_alert_impacts ?? 3;
      if (p.duration_s > maxS || (p.impacts ?? 0) >= maxImpacts) {
        default_priority = 'flag';
        rule_flags.push('glass_duration_cap');
      }
    }

    const segments = [];
    if (p.duration_s > 60) {
      for (let t = a; t < b; t += 30_000) {
        const e = Math.min(b, t + 30_000);
        const S = labelInterval(t, e, yRows, cRows, s, cat);
        segments.push({
          start: new Date(t).toISOString(),
          end: new Date(e).toISOString(),
          label: S.picked.label,
          family: S.picked.label ? cat.classById.get(S.picked.label)?.family ?? S.family : null,
          agreement: S.agreement,
          yamnet_top: S.y.labels[0]?.raw_label ?? null,
          clap_top: S.c.classes[0]?.class ?? null
        });
      }
    }

    return {
      ...p,
      yamnet: {
        n: L.y.n,
        top: L.y.labels.slice(0, 3),
        family_scores: L.y.family_scores,
        family_max: L.y.family_max
      },
      clap: {
        n: L.c.n,
        window_s: L.c.window_s ?? s.clap_window_s,
        clap_unreliable: L.clapUnreliable,
        short_event: L.shortEvent,
        top: L.c.classes.slice(0, 3).map((x) => ({ class: x.class, raw_label: x.class, label: x.class, family: x.family, mean: x.mean, max: x.max })),
        family_scores: L.c.family_scores
      },
      agreement: L.agreement,
      label,
      label_text,
      group_scores: { yamnet: L.y.family_scores, clap: L.c.family_scores },
      group_shares,
      target_share,
      family,
      label_source: source,
      confidence: label ? confidenceFor(L.agreement, L.yTop?.score, L.cTop?.score, s) : 0,
      rule_flags,
      default_priority,
      notes_in_period: notes.filter((n) => {
        const t = Date.parse(n.timestamp);
        return t >= a - 5000 && t <= b + 2000;
      }),
      segments
    };
  });
}
