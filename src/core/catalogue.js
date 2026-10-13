// Shared (browser + server) helpers around labels.json and priorities.json.
export const PRIORITY_RANK = { ignore: 0, log: 1, flag: 2, alert: 3 };
export const UNEXPLAINED_IMPACT = 'unexplained_impact';

export function buildCatalogue(labels, priorities) {
  return {
    version: labels.version,
    template: labels.clap_template,
    families: labels.families,
    classes: labels.classes,
    yamnet: labels.yamnet,
    classById: new Map(labels.classes.map((c) => [c.id, c])),
    yamnetByName: new Map(labels.yamnet.map((y) => [y.name, y])),
    priorities,
    sustainedSet: new Set(priorities.sustained_labels || [])
  };
}

// FNV-1a over the CLAP template and prompts, so stale precomputed text embeddings are detected.
export function promptsHash(labels) {
  const text = JSON.stringify([labels.clap_template, labels.classes.map((c) => [c.id, c.prompts])]);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function isContextFamily(family) {
  return family === 'context' || family === 'other' || !family;
}

export function labelFamily(cat, label) {
  if (label === UNEXPLAINED_IMPACT) return 'impacts_breakage';
  return cat.classById.get(label)?.family || null;
}

export function isKnownLabel(cat, label) {
  return label === UNEXPLAINED_IMPACT || cat.classById.has(label);
}

export function maxPriority(...levels) {
  let best = 'ignore';
  for (const l of levels) if (l && PRIORITY_RANK[l] > PRIORITY_RANK[best]) best = l;
  return best;
}

export function priorityFor(cat, label, timeOfDay, sustained = false) {
  if (!label) return sustained ? cat.priorities.sustained_min_priority || 'flag' : 'log';
  const row = cat.priorities.table[label];
  let p = row ? row[timeOfDay] || 'log' : 'log';
  if (sustained && p !== 'ignore') p = maxPriority(p, cat.priorities.sustained_min_priority || 'flag');
  return p;
}

function hhmmToMin(s, fallback) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : fallback;
}

// Local-time bucket. Night wraps past midnight.
export function timeOfDay(ms, settings) {
  const d = new Date(ms);
  const m = d.getHours() * 60 + d.getMinutes();
  const day = hhmmToMin(settings.day_start, 7 * 60);
  const evening = hhmmToMin(settings.evening_start, 19 * 60);
  const night = hhmmToMin(settings.night_start, 23 * 60);
  if (m >= day && m < evening) return 'day';
  if (m >= evening && m < night) return 'evening';
  return 'night';
}
