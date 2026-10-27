// Saved simulations: API client and the File menu / dialogs that use it.

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || body?.error || `request failed (HTTP ${status})`);
    this.status = status;
    this.code = body?.error;
    this.latest_version = body?.latest_version;
  }
}

export function createSimulationApi(fetchImpl = (...args) => fetch(...args)) {
  async function call(method, path, body) {
    let res;
    try {
      res = await fetchImpl(`/api/simulations${path}`, {
        method,
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch {
      throw new ApiError(0, { message: 'Cannot reach the server. Check your connection and try again.' });
    }
    if (res.status === 204) return null;
    const data = res.headers.get('content-type')?.includes('application/json') ? await res.json() : null;
    if (res.status === 502 && data?.error === 'backend_unavailable') throw new ApiError(502, { message: 'The backend is unavailable, so simulations cannot be saved or opened right now.' });
    if (!res.ok || !data) throw new ApiError(res.status, data);
    return data;
  }
  return {
    list: (q = '') => call('GET', q ? `?q=${encodeURIComponent(q)}` : '').then((d) => d.simulations),
    create: (body) => call('POST', '', body),
    get: (id, version) => call('GET', version ? `/${id}/versions/${version}` : `/${id}`),
    versions: (id) => call('GET', `/${id}/versions`).then((d) => d.versions),
    addVersion: (id, body) => call('POST', `/${id}/versions`, body),
    update: (id, body) => call('PATCH', `/${id}`, body),
    remove: (id) => call('DELETE', `/${id}`)
  };
}

export function describeSummary(s = {}) {
  const parts = [`${s.nodes ?? 0} node${s.nodes === 1 ? '' : 's'}`, `${s.sources ?? 0} source${s.sources === 1 ? '' : 's'}`, `${s.buildings ?? 0} building${s.buildings === 1 ? '' : 's'}`];
  if (s.environment) parts.push(s.environment.name || 'map area');
  return parts.join(' · ');
}

export function describeResults(s = {}) {
  if (!s.has_results) return 'No results';
  return `Results: located ${s.located ?? 0} of ${s.sources ?? 0}`;
}

export function relativeTime(when, now = Date.now()) {
  const s = Math.round((now - new Date(when).getTime()) / 1000);
  if (s < 45) return 'just now';
  const units = [['minute', 60], ['hour', 3600], ['day', 86400], ['week', 604800]];
  let label = '';
  for (const [name, size] of units) if (s >= size * 0.75) label = `${Math.max(1, Math.round(s / size))} ${name}`;
  if (s >= 2_419_200) return new Date(when).toLocaleDateString();
  return `${label}${label.startsWith('1 ') ? '' : 's'} ago`;
}

export const formatBytes = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} kB`);

/** Reads ?sim=<id>&v=<version> from a URL search string. */
export function simFromUrl(search) {
  const p = new URLSearchParams(search);
  const id = p.get('sim');
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const v = Number(p.get('v'));
  return { id, version: Number.isInteger(v) && v > 0 ? v : undefined };
}

export function urlForSim(href, current) {
  const url = new URL(href);
  url.searchParams.delete('sim');
  url.searchParams.delete('v');
  if (current) {
    url.searchParams.set('sim', current.id);
    if (current.version !== current.latest_version) url.searchParams.set('v', String(current.version));
  }
  return url.pathname + url.search + url.hash;
}

/**
 * Wires the saved-simulation controls.
 * getState() -> { scenario, results }; apply({ scenario, results, label }) loads a saved version and
 * returns the scenario actually in use (after validation), so the "unsaved changes" check has a baseline.
 */
export function bindSimulationLibrary({ $, api = createSimulationApi(), getState, apply, reset, notify }) {
  let current = null; // { id, name, description, version, latest_version }
  let baseline = null;
  let busy = false;

  const snapshot = () => JSON.stringify(getState().scenario);
  const isDirty = () => baseline !== snapshot();

  function refreshTitle() {
    const dirty = isDirty();
    const title = $('simTitle');
    title.textContent = current ? `${current.name} · v${current.version}${current.version !== current.latest_version ? ` (latest v${current.latest_version})` : ''}` : 'Unsaved simulation';
    title.classList.toggle('dirty', dirty);
    title.title = dirty ? 'Unsaved changes' : current ? 'Saved' : 'Not saved yet';
    $('simSave').textContent = current ? `Save v${current.latest_version + 1}` : 'Save…';
    document.title = `${dirty ? '• ' : ''}${current ? `${current.name} – ` : ''}Estate Acoustics Simulator`;
  }

  function setCurrent(next, scenarioInUse) {
    current = next;
    baseline = scenarioInUse === undefined ? snapshot() : JSON.stringify(scenarioInUse);
    history.replaceState(null, '', urlForSim(location.href, current));
    refreshTitle();
  }

  const confirmDiscard = () => !isDirty() || confirm('You have unsaved changes. Discard them?');

  function fromResponse(r) {
    return { id: r.id, name: r.name, description: r.description, version: r.version.version, latest_version: r.latest_version };
  }

  async function guarded(fn) {
    if (busy) return;
    busy = true;
    try {
      await fn();
    } catch (err) {
      notify(err.message, true);
    } finally {
      busy = false;
    }
  }

  async function open(id, version) {
    const r = await api.get(id, version);
    const inUse = apply({ scenario: r.version.scenario, results: r.version.results, label: `${r.name} v${r.version.version}` });
    setCurrent(fromResponse(r), inUse);
    notify(`Opened ${r.name} v${r.version.version}${r.version.results ? ' with its saved results. Press Create to re-render audio.' : '.'}`);
  }

  function payload(includeResults, note) {
    const { scenario, results } = getState();
    return { scenario, results: includeResults ? results : null, note };
  }

  async function saveVersion({ note = '', includeResults = true, force = false } = {}) {
    const body = { ...payload(includeResults, note), base_version: force ? undefined : current.latest_version };
    try {
      const r = await api.addVersion(current.id, body);
      setCurrent(fromResponse(r), body.scenario);
      notify(`Saved ${r.name} v${r.version.version}.`);
    } catch (err) {
      if (err.code === 'version_conflict' && confirm(`Someone saved this simulation elsewhere (latest is v${err.latest_version}). Save your version on top as v${err.latest_version + 1}?`)) {
        return saveVersion({ note, includeResults, force: true });
      }
      if (err.status === 404) {
        notify('This simulation was deleted. Use "Save as new" to keep your work.', true);
        current = null;
        refreshTitle();
        return;
      }
      throw err;
    }
  }

  // ----- save dialog -----
  let saveMode = 'new';
  function openSaveDialog(mode) {
    saveMode = mode;
    const { results } = getState();
    $('simSaveTitle').textContent = mode === 'version' ? `Save ${current.name} as v${current.latest_version + 1}` : 'Save simulation';
    $('simSaveNameRow').hidden = mode === 'version';
    $('simSaveDescRow').hidden = mode === 'version';
    $('simSaveName').value = mode === 'copy' && current ? `${current.name} (copy)` : mode === 'new' ? '' : current?.name ?? '';
    $('simSaveDesc').value = mode === 'copy' && current ? current.description || '' : '';
    $('simSaveNote').value = '';
    $('simSaveResults').checked = !!results;
    $('simSaveResults').disabled = !results;
    $('simSaveError').textContent = '';
    $('simSaveDlg').showModal();
    (mode === 'version' ? $('simSaveNote') : $('simSaveName')).focus();
  }

  $('simSaveForm').addEventListener('submit', (e) => {
    e.preventDefault();
    guarded(async () => {
      const includeResults = $('simSaveResults').checked;
      const note = $('simSaveNote').value;
      $('simSaveError').textContent = '';
      try {
        if (saveMode === 'version') await saveVersion({ note, includeResults });
        else {
          const body = { name: $('simSaveName').value, description: $('simSaveDesc').value, ...payload(includeResults, note) };
          const r = await api.create(body);
          setCurrent(fromResponse(r), body.scenario);
          notify(`Saved ${r.name}.`);
        }
        $('simSaveDlg').close();
      } catch (err) {
        $('simSaveError').textContent = err.message;
      }
    });
  });
  $('simSaveCancel').addEventListener('click', () => $('simSaveDlg').close());

  function save() {
    closeMenu();
    if (!current) return openSaveDialog('new');
    guarded(() => saveVersion({ includeResults: !!getState().results }));
  }

  // ----- open dialog -----
  let searchTimer = null;
  async function renderList() {
    const body = $('simList');
    $('simListError').textContent = '';
    let sims;
    try {
      sims = await api.list($('simSearch').value.trim());
    } catch (err) {
      $('simListError').textContent = err.message;
      body.replaceChildren();
      return;
    }
    body.replaceChildren();
    if (!sims.length) {
      const row = body.insertRow();
      const cell = row.insertCell();
      cell.colSpan = 4;
      cell.className = 'empty';
      cell.textContent = $('simSearch').value.trim() ? 'No simulations match.' : 'No saved simulations yet. Use File → Save to keep one.';
      return;
    }
    for (const s of sims) {
      const row = body.insertRow();
      if (current?.id === s.id) row.classList.add('current');
      const name = row.insertCell();
      name.append(Object.assign(document.createElement('strong'), { textContent: s.name }));
      if (s.description) name.append(Object.assign(document.createElement('div'), { className: 'note', textContent: s.description }));
      const what = row.insertCell();
      what.append(describeSummary(s.summary), Object.assign(document.createElement('div'), { className: 'note', textContent: describeResults(s.summary) }));
      const when = row.insertCell();
      when.textContent = `v${s.latest_version} · ${relativeTime(s.updated_at)}`;
      when.title = new Date(s.updated_at).toLocaleString();
      const actions = row.insertCell();
      actions.className = 'actions';
      const button = (label, fn, cls) => {
        const b = Object.assign(document.createElement('button'), { textContent: label, type: 'button' });
        if (cls) b.className = cls;
        b.addEventListener('click', () => guarded(fn));
        actions.append(b);
      };
      button('Open', async () => {
        if (!confirmDiscard()) return;
        await open(s.id);
        $('simOpenDlg').close();
      }, 'primary');
      button('History', () => showVersions(s));
      button('Rename', async () => {
        const name = prompt('New name', s.name);
        if (name == null || !name.trim()) return;
        const r = await api.update(s.id, { name });
        if (current?.id === s.id) {
          current.name = r.name;
          refreshTitle();
        }
        await renderList();
      });
      button('Delete', async () => {
        if (!confirm(`Delete "${s.name}" and all ${s.latest_version} version(s)? This cannot be undone.`)) return;
        await api.remove(s.id);
        if (current?.id === s.id) setCurrent(null, null);
        await renderList();
      });
    }
  }

  async function showVersions(sim) {
    $('simListView').hidden = true;
    $('simVersionsView').hidden = false;
    $('simVersionsTitle').textContent = `${sim.name}: version history`;
    const body = $('simVersions');
    body.replaceChildren();
    const versions = await api.versions(sim.id);
    body.replaceChildren();
    for (const v of versions) {
      const row = body.insertRow();
      if (current?.id === sim.id && current.version === v.version) row.classList.add('current');
      row.insertCell().textContent = `v${v.version}${v.version === sim.latest_version ? ' (latest)' : ''}`;
      const what = row.insertCell();
      what.append(describeSummary(v.summary), Object.assign(document.createElement('div'), { className: 'note', textContent: `${describeResults(v.summary)} · ${formatBytes(v.size_bytes)}` }));
      const note = row.insertCell();
      note.textContent = v.note || '—';
      const when = row.insertCell();
      when.textContent = relativeTime(v.created_at);
      when.title = new Date(v.created_at).toLocaleString();
      const actions = row.insertCell();
      actions.className = 'actions';
      const b = Object.assign(document.createElement('button'), { textContent: 'Open', type: 'button' });
      b.addEventListener('click', () => guarded(async () => {
        if (!confirmDiscard()) return;
        await open(sim.id, v.version);
        $('simOpenDlg').close();
      }));
      actions.append(b);
    }
  }

  function showList() {
    $('simVersionsView').hidden = true;
    $('simListView').hidden = false;
    return renderList();
  }

  $('simSearch').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderList, 250);
  });
  $('simVersionsBack').addEventListener('click', () => showList().catch((err) => notify(err.message, true)));
  $('simOpenClose').addEventListener('click', () => $('simOpenDlg').close());

  // ----- menu -----
  const closeMenu = () => ($('fileMenu').open = false);
  $('simNew').addEventListener('click', () => {
    closeMenu();
    if (!confirmDiscard()) return;
    reset();
    setCurrent(null);
  });
  $('simOpen').addEventListener('click', () => {
    closeMenu();
    $('simSearch').value = '';
    const loading = $('simList');
    loading.replaceChildren();
    const cell = loading.insertRow().insertCell();
    cell.colSpan = 4;
    cell.className = 'empty';
    cell.textContent = 'Loading…';
    $('simOpenDlg').showModal();
    showList().catch((err) => notify(err.message, true));
  });
  $('simSave').addEventListener('click', save);
  $('simSaveAs').addEventListener('click', () => {
    closeMenu();
    openSaveDialog(current ? 'copy' : 'new');
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (!$('simSaveDlg').open) save();
    }
  });
  window.addEventListener('beforeunload', (e) => {
    if (isDirty()) e.preventDefault();
  });

  return {
    refresh: refreshTitle,
    /** Call after the initial scenario is in place: opens ?sim= from the URL or marks the scene as the clean baseline. */
    async start() {
      const fromUrl = simFromUrl(location.search);
      if (fromUrl) {
        try {
          await open(fromUrl.id, fromUrl.version);
          return true;
        } catch (err) {
          notify(`Could not open the saved simulation: ${err.message}`, true);
        }
      }
      setCurrent(null);
      return false;
    },
    /** A scenario file was loaded from disk: it is a new, unsaved simulation. */
    detach() {
      current = null;
      baseline = null;
      history.replaceState(null, '', urlForSim(location.href, null));
      refreshTitle();
    },
    isDirty,
    current: () => current
  };
}
