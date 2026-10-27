// Shared (browser + server): the trimmed request sent to /api/report,
// the deterministic fallback report, and validation of Gemini's output.
import { PRIORITY_RANK, isKnownLabel, labelFamily, maxPriority, priorityFor } from './catalogue.js';

const AGREEMENTS = ['agree', 'partial', 'disagree', 'none'];

// Labels, levels, timestamps and notes only. Never rows, scores per window, audio or embeddings.
export function buildReportRequest(session, cat) {
  const { device, ...meta } = session.meta;
  const s = session.settings;
  return {
    schema_version: '2.2',
    meta,
    settings: {
      yamnet_enabled: s.yamnet_enabled,
      clap_enabled: s.clap_enabled,
      clap_window_s: s.clap_window_s,
      clap_hop_s: s.clap_hop_s,
      yamnet_min: s.yamnet_min,
      clap_min: s.clap_min,
      clap_logit_scale: s.clap_logit_scale,
      on_threshold_db: s.on_threshold_db,
      off_threshold_db: s.off_threshold_db,
      min_duration_s: s.min_duration_s,
      merge_gap_s: s.merge_gap_s,
      impulse_rise_db: s.impulse_rise_db,
      sustained_min: s.sustained_min,
      day_start: s.day_start,
      evening_start: s.evening_start,
      night_start: s.night_start
    },
    periods: session.periods,
    level_series: session.level_series,
    notes: session.notes,
    catalogue: {
      version: cat.version,
      families: Object.fromEntries(Object.entries(cat.families).map(([id, f]) => [id, f.name])),
      classes: cat.classes.map((c) => ({ id: c.id, family: c.family, group: c.group ?? null, role: c.role })),
      extra_labels: [{ id: 'unexplained_impact', family: 'impacts_breakage', role: 'rule' }],
      priorities: cat.priorities.table,
      sustained_labels: cat.priorities.sustained_labels
    }
  };
}

function countByPriority(events) {
  const counts = { alert: 0, flag: 0, log: 0 };
  for (const e of events) if (e.priority in counts) counts[e.priority]++;
  return counts;
}

function defaultPriorityFor(cat, label, periods) {
  return maxPriority(...periods.map((p) => maxPriority(p.default_priority, priorityFor(cat, label, p.time_of_day, p.sustained))));
}

export function fallbackReport(request, reason) {
  const events = [];
  const data_quality = [];
  for (const p of request.periods) {
    if (!p.label) {
      data_quality.push({ period_ids: [p.id], issue: 'No model reached a label for this period.' });
      continue;
    }
    if (p.default_priority === 'ignore') continue;
    const flags = [...(p.rule_flags || [])];
    if (p.clap?.clap_unreliable) flags.push('clap_unreliable');
    if (p.clap?.short_event && !flags.includes('short_event')) flags.push('short_event');
    events.push({
      period_ids: [p.id],
      final_label: p.label,
      family: p.family,
      priority: p.default_priority,
      priority_raised: false,
      priority_reason: null,
      confidence: p.confidence ?? 0,
      agreement: p.agreement,
      matches_note: null,
      explanation: p.label_text || '',
      flags
    });
  }
  const counts = countByPriority(events);
  const night = events.filter((e) => request.periods.find((p) => p.id === e.period_ids[0])?.time_of_day === 'night');
  return {
    source: 'fallback',
    fallback_reason: reason,
    model: null,
    generated_at: new Date().toISOString(),
    summary: {
      headline: `${events.length} events: ${counts.alert} alert, ${counts.flag} flagged, ${counts.log} logged.`,
      counts_by_priority: counts,
      quiet_hours_summary: night.length ? `${night.length} events in night hours.` : 'No events in night hours.',
      overall_notes: []
    },
    events,
    merges: [],
    data_quality
  };
}

// Section 10.5. `out` is Gemini's parsed JSON, `request` what the client sent.
export function validateReport(out, request, cat) {
  const byId = new Map(request.periods.map((p) => [p.id, p]));
  const dropped = [];
  const priority_reset = [];
  const events = [];

  for (const e of Array.isArray(out?.events) ? out.events : []) {
    const ids = Array.isArray(e?.period_ids) ? e.period_ids : [];
    if (!ids.length || !ids.every((id) => byId.has(id))) {
      dropped.push({ event: e, reason: 'period_ids missing or not in request' });
      continue;
    }
    if (!isKnownLabel(cat, e.final_label)) {
      dropped.push({ event: e, reason: 'final_label not in catalogue' });
      continue;
    }
    if (typeof e.confidence !== 'number' || !(e.confidence >= 0 && e.confidence <= 1)) {
      dropped.push({ event: e, reason: 'confidence outside 0 to 1' });
      continue;
    }
    const periods = ids.map((id) => byId.get(id));
    const def = defaultPriorityFor(cat, e.final_label, periods);
    let priority = e.priority;
    if (!(priority in PRIORITY_RANK) || PRIORITY_RANK[priority] < PRIORITY_RANK[def]) {
      priority_reset.push({ period_ids: ids, from: priority ?? null, to: def });
      priority = def;
    }
    const raised = PRIORITY_RANK[priority] > PRIORITY_RANK[def];
    events.push({
      period_ids: ids,
      final_label: e.final_label,
      family: labelFamily(cat, e.final_label),
      priority,
      priority_raised: raised,
      priority_reason: raised ? String(e.priority_reason || 'No reason given.') : null,
      confidence: e.confidence,
      agreement: AGREEMENTS.includes(e.agreement) ? e.agreement : periods[0].agreement,
      matches_note: typeof e.matches_note === 'boolean' ? e.matches_note : null,
      explanation: String(e.explanation || ''),
      flags: Array.isArray(e.flags) ? e.flags.map(String) : []
    });
  }

  const validIds = (x) => Array.isArray(x?.period_ids) && x.period_ids.length > 0 && x.period_ids.every((id) => byId.has(id));
  const merges = (Array.isArray(out?.merges) ? out.merges : []).filter(validIds).map((m) => ({ period_ids: m.period_ids, reason: String(m.reason || '') }));
  const data_quality = (Array.isArray(out?.data_quality) ? out.data_quality : [])
    .filter((d) => !d.period_ids?.length || validIds(d))
    .map((d) => ({ period_ids: d.period_ids || [], issue: String(d.issue || '') }));

  const covered = new Set(events.flatMap((e) => e.period_ids));
  const uncovered = request.periods.filter((p) => !covered.has(p.id) && p.label && p.default_priority !== 'ignore').map((p) => p.id);
  const needsEvents = request.periods.some((p) => p.label && p.default_priority !== 'ignore');
  const validation = { dropped, priority_reset, uncovered_period_ids: uncovered };

  if (!events.length && needsEvents) return { ok: false, validation };

  const summary = out?.summary || {};
  return {
    ok: true,
    validation,
    report: {
      source: 'gemini',
      summary: {
        headline: String(summary.headline || ''),
        counts_by_priority: countByPriority(events),
        quiet_hours_summary: String(summary.quiet_hours_summary || ''),
        overall_notes: Array.isArray(summary.overall_notes) ? summary.overall_notes.map(String) : []
      },
      events,
      merges,
      data_quality
    }
  };
}
