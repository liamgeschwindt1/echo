// Scenes workspace: saved simulations as cards, and a plus card that starts a new one.
import { describeResults, describeSummary, relativeTime } from './library.js';

const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};

export function createScenesPanel({ $, scenes, onOpen }) {
  let loadSeq = 0;

  async function render() {
    const seq = ++loadSeq;
    const box = $('sceneCards');
    const status = $('sceneStatus');
    status.textContent = '';
    let sims = [];
    try {
      sims = await scenes.list($('sceneSearch').value.trim());
    } catch (err) {
      status.textContent = err.message;
    }
    if (seq !== loadSeq) return;
    box.replaceChildren();

    const plus = el('button', { className: 'scene-card plus', title: 'New scene', ariaLabel: 'New scene' }, el('span', { className: 'plus-sign', textContent: '+' }), el('span', { className: 'sub', textContent: 'New scene' }));
    plus.addEventListener('click', () => scenes.newScene() && onOpen());
    box.append(plus);

    const current = scenes.current();
    if (!current) {
      const card = el('div', { className: 'scene-card current' }, el('strong', { textContent: 'Unsaved scene' }), el('span', { className: 'sub', textContent: 'Open in the editor. Save it to keep it here.' }));
      card.addEventListener('click', onOpen);
      box.append(card);
    }
    for (const s of sims) {
      const card = el('div', { className: `scene-card${current?.id === s.id ? ' current' : ''}`, tabIndex: 0 });
      card.append(el('strong', { textContent: s.name }));
      if (s.description) card.append(el('span', { className: 'sub', textContent: s.description }));
      card.append(el('span', { className: 'sub', textContent: describeSummary(s.summary) }), el('span', { className: 'sub', textContent: `${describeResults(s.summary)} · v${s.latest_version} · ${relativeTime(s.updated_at)}` }));
      const del = el('button', { className: 'scene-del', textContent: 'Delete', title: `Delete ${s.name}` });
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (await scenes.removeScene(s.id, s.name, s.latest_version)) render();
      });
      card.append(del);
      const go = async () => {
        if (current?.id === s.id || (await scenes.openScene(s.id))) onOpen();
      };
      card.addEventListener('click', go);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') go();
      });
      box.append(card);
    }
    if (!sims.length && !status.textContent) status.textContent = $('sceneSearch').value.trim() ? 'No scenes match.' : 'No saved scenes yet. Use + to make one.';
  }

  let timer = null;
  $('sceneSearch').addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(render, 250);
  });

  return { show: render };
}
