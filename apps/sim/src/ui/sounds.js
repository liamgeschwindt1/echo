// Sound library workspace: list, 3D level-contour preview, and a builder with upload or synthesis and 1 m level calibration.
import { decodeToMono } from '@echo/sim-core/clips.js';
import { spectrogram } from '@echo/sim-core/spectro.js';
import { MAX_AUDIO_BYTES, level1mFromMeasurement, synthesizeModel, validateSoundModel } from '@echo/sim-core/sounds.js';
import { clipGainPa } from '@echo/sim-core/render.js';
import { createObjectView } from './objectview.js';
import { turbo } from './heatmap.js';
import { slug } from './modelapi.js';

const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};
const field = (label, input) => el('label', {}, label, input);

function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const b64ToBuffer = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;

export async function modelSamples(model, rate) {
  if (model.kind === 'upload') return decodeToMono(b64ToBuffer(model.audio_b64), rate);
  if (model.kind === 'generated') return synthesizeModel(model.synth, rate);
  throw new Error('this sound has no audio of its own');
}

// Contours where the free-field level has fallen to a given dB SPL.
export function levelContours(level1m, levels = [90, 80, 70, 60, 50, 40]) {
  return levels.filter((l) => l < level1m).map((l) => ({ level: l, radius: 10 ** ((level1m - l) / 20) }));
}

export function createSoundLibrary({ $, fit, api, getBuiltin, getSamples, onChange }) {
  const models = new Map();
  let draft = null; // { entry fields..., isNew, builtin, sessionOnly, samples }
  let drawn = null;
  const view = createObjectView($('sndCanvas'), { dist: 20, minDist: 1, maxDist: 5000 });
  let framed = null;
  const status = (text, bad = false) => {
    $('sndStatus').textContent = text;
    $('sndStatus').style.color = bad ? '#ff6b6b' : '';
  };

  const userEntry = (m) => ({
    id: m.id,
    name: m.name,
    user: true,
    available: true,
    level_1m_db: m.level_1m_db,
    confirmed: m.confirmed,
    labels: m.labels,
    load: (rate) => modelSamples(m, rate)
  });
  const publish = () => onChange([...models.values()].filter((m) => m.kind !== 'library').map(userEntry));

  const rows = () => [
    ...getBuiltin().map((e) => ({ ...e, builtin: true, kind: 'library' })),
    ...models.values()
  ];

  function open(m, isNew = false) {
    draft = { ...structuredClone({ ...m, samples: undefined }), isNew, builtin: !!m.builtin, sessionOnly: !!m.sessionOnly, samples: null };
    draft.labels = [...(m.labels || [])];
    framed = null;
    drawn = null;
    renderList();
    renderDetail();
    loadSamples();
  }

  async function loadSamples() {
    const d = draft;
    try {
      d.samples = d.builtin ? await getSamples(d) : await modelSamples(d, 48000);
    } catch {
      d.samples = null;
    }
    if (draft === d && drawn) drawn.done = false;
  }

  function renderList() {
    const box = $('sndList');
    box.replaceChildren();
    if (draft?.isNew) box.append(el('button', { className: 'card active' }, draft.name || 'New sound'));
    for (const m of rows()) {
      const b = el('button', { className: `card${draft && !draft.isNew && draft.id === m.id ? ' active' : ''}` }, m.name);
      const tag = m.builtin ? 'built-in' : m.sessionOnly ? 'unsaved' : m.kind === 'upload' ? 'upload' : 'generated';
      b.append(el('span', { className: 'tag', textContent: tag }), el('span', { className: 'sub', textContent: `${m.level_1m_db} dB at 1 m${m.confirmed ? '' : ' · placeholder'}` }));
      b.addEventListener('click', () => open(m));
      box.append(b);
    }
  }

  const currentModel = () => {
    const m = { id: draft.id, name: draft.name, kind: draft.kind, level_1m_db: Number(draft.level_1m_db), confirmed: draft.confirmed, labels: draft.labels, notes: draft.notes, calibration: draft.calibration };
    if (draft.kind === 'generated') m.synth = draft.synth;
    if (draft.kind === 'upload') m.audio_b64 = draft.audio_b64;
    return m;
  };

  function renderDetail() {
    const box = $('sndDetail');
    box.replaceChildren();
    drawn = null;
    if (!draft) return void box.append(el('p', { className: 'note', textContent: 'Pick a sound or press New.' }));
    const ro = draft.builtin;
    const bind = (input, key, parse = (v) => v) => {
      input.addEventListener('input', () => {
        draft[key] = parse(input.value);
        framed = null;
      });
      return input;
    };
    box.append(el('h3', {}, ro ? `${draft.name} (read only)` : draft.isNew ? 'New sound' : 'Edit sound'));
    box.append(field('Name', bind(el('input', { className: 'wide', value: draft.name || '', disabled: ro, maxLength: 120 }), 'name')));

    if (draft.isNew && !draft.kind) {
      box.append(el('h4', { textContent: 'Create from' }));
      const up = el('input', { type: 'file', accept: 'audio/wav,audio/*', hidden: true });
      up.addEventListener('change', async () => {
        const file = up.files[0];
        if (!file) return;
        if (file.size > MAX_AUDIO_BYTES) return status('That file is over 8 MB.', true);
        try {
          const buf = await file.arrayBuffer();
          await decodeToMono(buf.slice(0), 48000);
          draft.kind = 'upload';
          draft.audio_b64 = bytesToB64(new Uint8Array(buf));
          draft.name = draft.name === 'New sound' ? file.name.replace(/\.[^.]+$/, '') : draft.name;
          draft.sourceFile = file.name;
          status('');
          await loadSamples();
          renderDetail();
        } catch (e) {
          status(`Could not read that file: ${e.message}`, true);
        }
      });
      const label = el('label', { className: 'upload' }, 'Upload a WAV…', up);
      const gen = el('select');
      for (const [v, t] of [['', 'Generate…'], ['tone', 'Tone'], ['impulse', 'Impulse (200-1600 Hz flat)'], ['noise', 'Noise burst (50-12000 Hz flat)']]) gen.append(el('option', { value: v, textContent: t }));
      gen.addEventListener('change', async () => {
        if (!gen.value) return;
        draft.kind = 'generated';
        draft.synth = gen.value === 'tone' ? { type: 'tone', freq_hz: 1000, duration_s: 1 } : { type: gen.value };
        await loadSamples();
        renderDetail();
      });
      box.append(el('div', { className: 'row' }, label, gen), el('p', { className: 'note', textContent: 'Audio stays on the server only as part of the saved model. Speech should not be uploaded.' }));
      return;
    }

    if (draft.kind === 'generated' && draft.synth.type === 'tone' && !ro) {
      const f = el('input', { type: 'number', value: draft.synth.freq_hz, min: 20, max: 20000 });
      const d = el('input', { type: 'number', value: draft.synth.duration_s, min: 0.1, max: 30, step: 0.1 });
      const refresh = async () => {
        draft.synth = { type: 'tone', freq_hz: Number(f.value), duration_s: Number(d.value) };
        await loadSamples();
      };
      f.addEventListener('change', refresh);
      d.addEventListener('change', refresh);
      box.append(field('Frequency (Hz)', f), field('Duration (s)', d));
    }

    box.append(el('h4', { textContent: 'Level at 1 m' }));
    const level = el('input', { type: 'number', step: 1, value: draft.level_1m_db, disabled: ro });
    level.addEventListener('input', () => { draft.level_1m_db = Number(level.value); framed = null; renderStatus(); });
    const conf = el('input', { type: 'checkbox', checked: !!draft.confirmed, disabled: ro });
    conf.addEventListener('change', () => { draft.confirmed = conf.checked; renderStatus(); });
    const state = el('p', { className: 'note' });
    const renderStatus = () => (state.textContent = draft.confirmed ? 'Level is calibrated.' : 'Level is a placeholder until calibrated.');
    box.append(field('Level (dB SPL)', level), el('label', { className: 'check' }, conf, ' Confirmed by measurement'), state);
    renderStatus();

    if (!ro) {
      box.append(el('h4', { textContent: 'Calibrate from a measurement' }));
      const cal = draft.calibration || {};
      const meas = el('input', { type: 'number', step: 0.1, value: cal.measured_db ?? '' });
      const dist = el('input', { type: 'number', step: 0.1, min: 0.1, value: cal.distance_m ?? 1 });
      const method = el('input', { className: 'wide', value: cal.method || '', placeholder: 'e.g. class 1 meter, loudest 125 ms', maxLength: 200 });
      const err = el('p', { className: 'error', role: 'alert' });
      const apply = el('button', { textContent: 'Calculate level at 1 m' });
      apply.addEventListener('click', () => {
        try {
          const l1 = level1mFromMeasurement(Number(meas.value), Number(dist.value));
          draft.level_1m_db = Math.round(l1 * 10) / 10;
          draft.confirmed = true;
          draft.calibration = { measured_db: Number(meas.value), distance_m: Number(dist.value), method: method.value, date: new Date().toISOString().slice(0, 10) };
          framed = null;
          renderDetail();
        } catch (e) {
          err.textContent = e.message;
        }
      });
      box.append(field('Measured (dB SPL)', meas), field('Distance (m)', dist), method, el('div', { className: 'row' }, apply), err, el('p', { className: 'note', textContent: 'Free field: 6 dB less per doubling of distance. Measure the loudest part of the sound.' }));
    }

    box.append(el('h4', { textContent: 'Labels' }));
    const labels = el('input', { className: 'wide', value: draft.labels.join(', '), disabled: ro, placeholder: 'traffic, siren', maxLength: 200 });
    labels.addEventListener('input', () => (draft.labels = labels.value.split(',').map((s) => s.trim()).filter(Boolean)));
    box.append(labels);
    if (!ro) {
      const notes = el('textarea', { rows: 3, value: draft.notes || '', maxLength: 2000, placeholder: 'Notes' });
      notes.addEventListener('input', () => (draft.notes = notes.value));
      box.append(notes);
    }

    box.append(el('h4', { textContent: 'Signal' }));
    const wave = el('canvas', { width: 340, height: 70 });
    const spec = el('canvas', { width: 340, height: 110 });
    box.append(wave, spec, el('p', { className: 'note mono', id: 'sndStats' }));
    drawn = { wave, spec, done: false };

    const err = el('p', { className: 'error', role: 'alert' });
    const row = el('div', { className: 'row' });
    const btn = (text, fn, primary = false) => {
      const b = el('button', { textContent: text, className: primary ? 'primary' : '' });
      b.addEventListener('click', () => fn(err));
      row.append(b);
    };
    btn('Play', play);
    if (!ro) btn('Save to library', save, true);
    if (!ro && !draft.isNew) btn('Delete', remove);
    box.append(row, err);
  }

  let audio = null;
  function play(errBox) {
    if (!draft.samples) return void (errBox.textContent = 'No audio to play.');
    audio ??= new AudioContext();
    const peak = draft.samples.reduce((p, v) => Math.max(p, Math.abs(v)), 0) || 1;
    const buf = audio.createBuffer(1, draft.samples.length, 48000);
    buf.getChannelData(0).set(draft.samples.map((v) => (v / peak) * 0.5));
    const src = audio.createBufferSource();
    src.buffer = buf;
    src.connect(audio.destination);
    src.start();
  }

  function paintSignal() {
    if (!drawn || drawn.done || !draft?.samples) return;
    drawn.done = true;
    const s = draft.samples;
    const { wave, spec } = drawn;
    const w = wave.getContext('2d');
    w.fillStyle = '#000';
    w.fillRect(0, 0, wave.width, wave.height);
    w.strokeStyle = '#ffb000';
    const per = s.length / wave.width;
    let peak = 0;
    for (const v of s) peak = Math.max(peak, Math.abs(v));
    peak = peak || 1;
    w.beginPath();
    for (let x = 0; x < wave.width; x++) {
      let lo = 0;
      let hi = 0;
      for (let i = Math.floor(x * per); i < Math.min(s.length, Math.floor((x + 1) * per)); i++) {
        lo = Math.min(lo, s[i]);
        hi = Math.max(hi, s[i]);
      }
      w.moveTo(x + 0.5, wave.height / 2 - (hi / peak) * (wave.height / 2 - 2));
      w.lineTo(x + 0.5, wave.height / 2 - (lo / peak) * (wave.height / 2 - 2));
    }
    w.stroke();
    const sp = spectrogram(s, 48000, { frames: spec.width, size: 512, maxHz: 8000 });
    const c = spec.getContext('2d');
    const img = c.createImageData(spec.width, spec.height);
    const top = Math.max(...sp.frames.map((f) => Math.max(...f)));
    sp.frames.forEach((col, x) => {
      for (let y = 0; y < spec.height; y++) {
        const [r, g, b] = turbo((col[Math.min(sp.bins - 1, Math.floor(((spec.height - 1 - y) / spec.height) * sp.bins))] - (top - 70)) / 70);
        const o = (y * spec.width + x) * 4;
        img.data.set([r, g, b, 255], o);
      }
    });
    c.putImageData(img, 0, 0);
    const stats = document.getElementById('sndStats');
    if (stats) stats.textContent = `${(s.length / 48000).toFixed(2)} s · loudest-window gain ${clipGainPa(s, 48000, Number(draft.level_1m_db) || 0).toExponential(2)} Pa · spectrogram 0-8 kHz`;
  }

  async function save(errBox) {
    errBox.textContent = '';
    let model;
    try {
      const base = draft.isNew ? slug(draft.name || 'sound') : draft.id;
      let id = base;
      for (let n = 2; draft.isNew && (models.has(id) || getBuiltin().some((e) => e.id === id)); n++) id = `${base}-${n}`;
      model = validateSoundModel({ ...currentModel(), id });
    } catch (e) {
      errBox.textContent = e.message;
      return;
    }
    let sessionOnly = false;
    try {
      await api.put('sounds', model);
      status('Saved.');
    } catch (e) {
      sessionOnly = true;
      status(`${e.message} Kept for this session only.`, true);
    }
    models.set(model.id, { ...model, sessionOnly });
    publish();
    open(models.get(model.id));
  }

  async function remove(errBox) {
    if (!confirm(`Delete sound "${draft.name}"? Sources in the scene that use it will fail to render.`)) return;
    try {
      if (!draft.sessionOnly) await api.remove('sounds', draft.id);
    } catch (e) {
      errBox.textContent = e.message;
      return;
    }
    models.delete(draft.id);
    publish();
    draft = null;
    renderList();
    renderDetail();
  }

  $('sndNew').addEventListener('click', () => open({ id: '', name: 'New sound', kind: '', level_1m_db: 90, confirmed: false, labels: [], notes: '' }, true));

  function scene(dpr) {
    if (!draft) return { dpr };
    const L = Number(draft.level_1m_db) || 0;
    const contours = levelContours(L);
    const outer = Math.min(2000, Math.max(2, ...contours.map((c) => c.radius)));
    if (framed !== `${draft.id}|${draft.isNew}|${L}`) {
      framed = `${draft.id}|${draft.isNew}|${L}`;
      view.frame(outer);
    }
    const colour = (level) => `rgb(${turbo((level - 35) / 60).join(',')})`;
    const step = outer > 400 ? 100 : outer > 80 ? 20 : outer > 20 ? 5 : 1;
    return {
      dpr,
      points: [{ p: [0, 0, 1.5], label: draft.name || '', color: '#ffb000', size: 6 }],
      lines: [{ a: [0, 0, 0], b: [0, 0, 1.5], color: '#666', dash: [3, 3] }],
      circles: [
        { radius: 1, z: 0, color: '#888', label: `1 m ${Math.round(L)} dB`, dash: [4, 3] },
        ...($('sndRings').checked ? contours.map((c) => ({ radius: c.radius, z: 0, color: colour(c.level), label: `${c.level} dB at ${c.radius < 10 ? c.radius.toFixed(1) : Math.round(c.radius)} m` })) : [])
      ],
      grid: { step, extent: Math.ceil((outer * 1.3) / step) * step, z: 0 },
      axes: Math.max(1, outer * 0.15)
    };
  }

  return {
    entries: () => [...models.values()].filter((m) => m.kind !== 'library').map(userEntry),
    async start() {
      try {
        for (const m of await api.list('sounds')) models.set(m.id, validateSoundModel(m));
        publish();
      } catch (e) {
        status(e.message, true);
      }
      renderList();
    },
    show() {
      renderList();
      renderDetail();
      if (draft) loadSamples();
    },
    draw() {
      paintSignal();
      view.draw(scene(fit($('sndCanvas'))));
    }
  };
}
