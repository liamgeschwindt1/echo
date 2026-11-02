// Mic array library workspace: list, 3D preview, and a builder with generators, a coordinate table and derived figures.
import { BUILTIN_ARRAYS, GENERATORS, arrayImportTemplate, arrayMetrics, parseArrayImport, validateArrayModel } from '@echo/sim-core/arrays.js';
import { createObjectView } from './objectview.js';
import { slug } from './modelapi.js';

const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};
const field = (label, input) => el('label', {}, label, input);
const toRows = (mics) => Object.entries(mics).map(([name, [x, y, z]]) => ({ name, x, y, z }));
const toMics = (rows) => Object.fromEntries(rows.map((r) => [r.name, [Number(r.x), Number(r.y), Number(r.z)]]));
const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : 'not observable');

export function createArrayLibrary({ $, fit, api, useOnNode }) {
  const models = new Map(BUILTIN_ARRAYS.map((m) => [m.id, { ...m, builtin: true }]));
  let draft = null; // { ...model, rows, isNew, builtin, sessionOnly }
  let metricsBox = null;
  let gen = { type: 'ring', params: {} };
  const view = createObjectView($('arrCanvas'));
  let framed = null;
  const status = (text, bad = false) => {
    $('arrStatus').textContent = text;
    $('arrStatus').style.color = bad ? '#ff6b6b' : '';
  };

  const open = (m, isNew = false) => {
    draft = { ...structuredClone({ ...m, mics: undefined }), rows: toRows(m.mics), isNew, builtin: !!m.builtin, sessionOnly: !!m.sessionOnly };
    framed = null;
    renderList();
    renderDetail();
  };

  function renderList() {
    const box = $('arrList');
    box.replaceChildren();
    for (const m of models.values()) {
      const b = el('button', { className: `card${draft && !draft.isNew && draft.id === m.id ? ' active' : ''}` }, m.name);
      b.append(el('span', { className: 'tag', textContent: m.builtin ? 'built-in' : m.sessionOnly ? 'unsaved' : '' }), el('span', { className: 'sub', textContent: `${Object.keys(m.mics).length} mics${m.assumed ? ' · layout assumed' : ''}` }));
      b.addEventListener('click', () => open(m));
      box.append(b);
    }
    if (draft?.isNew) box.prepend(el('button', { className: 'card active' }, draft.name || 'New array'));
  }

  const currentModel = () => ({ id: draft.id, name: draft.name, status: draft.status, source: draft.source, notes: draft.notes, assumed: draft.assumed, mics: toMics(draft.rows) });

  function updateMetrics() {
    if (!metricsBox) return;
    metricsBox.replaceChildren();
    const mics = draft.rows.map((r) => [Number(r.x), Number(r.y), Number(r.z)]);
    if (mics.length < 2 || mics.some((p) => p.some((v) => !Number.isFinite(v)))) return void metricsBox.append(el('p', { className: 'note', textContent: 'Needs at least two mics with numeric coordinates.' }));
    const m = arrayMetrics(mics);
    const rows = [
      ['Mics', m.count],
      ['Nearest / longest spacing', `${fmt(m.nearest_mm)} / ${fmt(m.longest_mm)} mm`],
      ['Vertical baseline', `${fmt(m.vertical_baseline_mm)} mm`],
      ['Aliasing limit (phase methods)', `${fmt(m.aliasing_hz / 1000, 2)} kHz`],
      ...m.bearing.map((b) => [`Bearing error, source at ${b.at_el_deg}° elevation`, `az ${fmt(b.az_deg)}°, el ${fmt(b.el_deg)}°`])
    ];
    const table = el('table');
    for (const [k, v] of rows) table.append(el('tr', {}, el('td', { textContent: k }), el('td', { className: 'mono', textContent: String(v) })));
    metricsBox.append(table, el('p', { className: 'note', textContent: 'Timing noise only (one sample at 96 kHz). Ignores reflections, shell diffraction, mic mismatch and clock drift. A layout with no vertical baseline cannot tell above from below.' }));
  }

  function renderDetail() {
    const box = $('arrDetail');
    box.replaceChildren();
    if (!draft) return void box.append(el('p', { className: 'note', textContent: 'Pick an array or press New.' }));
    const ro = draft.builtin;
    const name = el('input', { className: 'wide', value: draft.name, disabled: ro, maxLength: 120 });
    name.addEventListener('input', () => (draft.name = name.value));
    const stat = el('input', { className: 'wide', value: draft.status || '', disabled: ro, maxLength: 200 });
    stat.addEventListener('input', () => (draft.status = stat.value));
    const assumed = el('input', { type: 'checkbox', checked: draft.assumed, disabled: ro });
    assumed.addEventListener('change', () => (draft.assumed = assumed.checked));
    const notes = el('textarea', { rows: 3, value: draft.notes || '', disabled: ro, maxLength: 2000 });
    notes.addEventListener('input', () => (draft.notes = notes.value));
    box.append(el('h3', {}, draft.builtin ? `${draft.name} (read only)` : draft.isNew ? 'New array' : 'Edit array'), el('label', {}, 'Name'), name, el('label', {}, 'Status'), stat, el('label', { className: 'check' }, assumed, ' Layout assumed, not confirmed'), notes);

    if (!ro) {
      box.append(el('h4', { textContent: 'Generate layout' }));
      const sel = el('select');
      for (const [k, g] of Object.entries(GENERATORS)) sel.append(el('option', { value: k, textContent: g.label }));
      sel.value = gen.type in GENERATORS ? gen.type : 'ring';
      const params = el('div');
      const drawParams = () => {
        params.replaceChildren();
        for (const [key, label, def] of GENERATORS[sel.value].params) {
          const i = el('input', { type: 'number', step: 'any', value: gen.params[`${sel.value}.${key}`] ?? def });
          i.addEventListener('input', () => (gen.params[`${sel.value}.${key}`] = Number(i.value)));
          params.append(field(label, i));
        }
      };
      sel.addEventListener('change', () => { gen.type = sel.value; drawParams(); });
      drawParams();
      const go = el('button', { textContent: 'Replace mics with this layout' });
      go.addEventListener('click', () => {
        const g = GENERATORS[sel.value];
        const p = Object.fromEntries(g.params.map(([key,, def]) => [key, gen.params[`${sel.value}.${key}`] ?? def]));
        draft.rows = toRows(g.build(p));
        framed = null;
        renderDetail();
      });
      box.append(field('Generator', sel), params, go);
    }

    box.append(el('h4', { textContent: 'Mic coordinates (mm, origin at array centre, z up)' }));
    const table = el('table', {}, el('tr', {}, ...['Mic', 'x', 'y', 'z', ''].map((h) => el('th', { textContent: h }))));
    draft.rows.forEach((r, idx) => {
      const tr = el('tr');
      const nm = el('input', { className: 'name', value: r.name, disabled: ro, maxLength: 12 });
      nm.addEventListener('input', () => (r.name = nm.value));
      tr.append(el('td', {}, nm));
      for (const k of ['x', 'y', 'z']) {
        const i = el('input', { type: 'number', step: 'any', value: r[k], disabled: ro });
        i.addEventListener('input', () => { r[k] = i.value; updateMetrics(); });
        tr.append(el('td', {}, i));
      }
      const del = el('button', { textContent: '×', title: 'Remove mic', disabled: ro });
      del.addEventListener('click', () => { draft.rows.splice(idx, 1); renderDetail(); });
      tr.append(el('td', {}, del));
      table.append(tr);
    });
    box.append(table);
    if (!ro) {
      const add = el('button', { textContent: 'Add mic' });
      add.addEventListener('click', () => { draft.rows.push({ name: `M${draft.rows.length + 1}`, x: 0, y: 0, z: 0 }); renderDetail(); });
      box.append(el('div', { className: 'row' }, add));
    }

    box.append(el('h4', { textContent: 'Derived figures' }));
    metricsBox = el('div');
    box.append(metricsBox);
    updateMetrics();

    const err = el('p', { className: 'error', role: 'alert' });
    const row = el('div', { className: 'row' });
    const btn = (text, fn, primary = false) => {
      const b = el('button', { textContent: text, className: primary ? 'primary' : '' });
      b.addEventListener('click', () => fn(err));
      row.append(b);
    };
    if (!ro) btn('Save to library', save, true);
    btn('Duplicate', () => open({ ...currentModel(), id: '', name: `${draft.name} copy`, assumed: draft.assumed }, true));
    btn('Export JSON', exportJson);
    btn('Use on selected node', (e) => (e.textContent = useOnNode(validateOrThrow()) || ''));
    if (!ro && !draft.isNew) btn('Delete', remove);
    box.append(row, err);
  }

  function validateOrThrow() {
    return validateArrayModel({ ...currentModel(), id: draft.id || slug(draft.name || 'array') });
  }

  async function save(errBox) {
    errBox.textContent = '';
    let model;
    try {
      const base = draft.isNew ? slug(draft.name || 'array') : draft.id;
      let id = base;
      for (let n = 2; draft.isNew && models.has(id); n++) id = `${base}-${n}`;
      model = validateArrayModel({ ...currentModel(), id });
    } catch (e) {
      errBox.textContent = e.message;
      return;
    }
    let sessionOnly = false;
    try {
      await api.put('arrays', model);
      status('Saved.');
    } catch (e) {
      sessionOnly = true;
      status(`${e.message} Kept for this session only.`, true);
    }
    models.set(model.id, { ...model, sessionOnly });
    open(models.get(model.id));
  }

  async function remove(errBox) {
    if (!confirm(`Delete array "${draft.name}"? Nodes already using it keep their own copy of the layout.`)) return;
    try {
      if (!draft.sessionOnly) await api.remove('arrays', draft.id);
    } catch (e) {
      errBox.textContent = e.message;
      return;
    }
    models.delete(draft.id);
    draft = null;
    renderList();
    renderDetail();
  }

  function exportJson() {
    const m = validateOrThrow();
    const out = { [m.id]: { name: m.name, units: 'mm', assumed: m.assumed, status: m.status, source: m.source, notes: m.notes, mics: m.mics } };
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' })), download: `${m.id}.json` });
    a.click();
    URL.revokeObjectURL(a.href);
  }

  $('arrNew').addEventListener('click', () => open({ id: '', name: 'New array', status: '', source: '', notes: '', assumed: true, mics: GENERATORS.ring.build({ count: 6, radius_mm: 60 }) }, true));

  $('arrImport').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const models_ = parseArrayImport(JSON.parse(await file.text()), file.name.replace(/\.[^.]+$/, ''));
      let last = null;
      for (const model of models_) {
        let sessionOnly = false;
        try {
          await api.put('arrays', model);
        } catch {
          sessionOnly = true;
        }
        models.set(model.id, { ...model, sessionOnly });
        last = model.id;
      }
      status(`Imported ${models_.length} array${models_.length === 1 ? '' : 's'}.`);
      if (last) open(models.get(last));
    } catch (err) {
      status(`Could not import: ${err.message}`, true);
    }
  });

  $('arrTemplate').addEventListener('click', () => {
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([JSON.stringify(arrayImportTemplate(), null, 2)], { type: 'application/json' })), download: 'mic-array-import-template.json' });
    a.click();
    URL.revokeObjectURL(a.href);
  });

  const showLabels = () => $('arrLabels').checked;
  const showSpans = () => $('arrSpans').checked;

  function scene(dpr) {
    if (!draft) return { dpr };
    const mics = draft.rows.map((r) => ({ name: r.name, p: [Number(r.x), Number(r.y), Number(r.z)] })).filter((m) => m.p.every(Number.isFinite));
    const radius = Math.max(40, ...mics.map((m) => Math.hypot(...m.p)));
    const key = `${draft.id}|${draft.isNew}|${draft.rows.length}`;
    if (framed !== key) {
      framed = key;
      view.frame(radius);
    }
    const lines = [];
    if (showSpans() && mics.length > 1) {
      const pairs = [];
      for (let i = 0; i < mics.length; i++) for (let j = i + 1; j < mics.length; j++) pairs.push([Math.hypot(...mics[i].p.map((v, k) => v - mics[j].p[k])), i, j]);
      const min = Math.min(...pairs.map((p) => p[0]));
      for (const [d, i, j] of pairs) if (d < min * 1.01) lines.push({ a: mics[i].p, b: mics[j].p, color: '#4cc9f0' });
    }
    const step = radius > 400 ? 100 : radius > 150 ? 50 : 20;
    return {
      dpr,
      points: mics.map((m) => ({ p: m.p, label: showLabels() ? m.name : '', color: m.p[2] < 0 ? '#c77dff' : '#ffb000', size: 5 })),
      lines,
      grid: { step, extent: Math.ceil((radius * 1.6) / step) * step, z: Math.min(0, ...mics.map((m) => m.p[2])) - 10 },
      axes: radius * 0.5
    };
  }

  return {
    list: () => [...models.values()],
    get: (id) => models.get(id),
    async start() {
      try {
        for (const m of await api.list('arrays')) models.set(m.id, validateArrayModel(m));
      } catch (e) {
        status(e.message, true);
      }
      renderList();
      if (!draft) open(models.get('ball12_d180'));
    },
    show() {
      renderList();
      renderDetail();
    },
    draw: () => view.draw(scene(fit($('arrCanvas')))),
    resetFrame: () => (framed = null)
  };
}
