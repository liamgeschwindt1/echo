import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultScenario, newNode, newSource } from '../src/sim/core/scenario.js';
import { renderScenario } from '../src/sim/core/render.js';
import { createMicView } from '../src/sim/ui/micview.js';

class Element {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.children = [];
    this.style = {};
    this.events = {};
    this.value = '0';
    this.textContent = '';
    this.htmlWrites = 0;
    this.classList = { toggle() {} };
  }
  get options() { return this.children.filter((child) => child.tagName === 'option'); }
  get firstChild() { return this.children[0]; }
  set innerHTML(value) { this.htmlWrites++; this.children = []; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(name, handler) { this.events[name] = handler; }
  getContext() { return {}; }
  querySelectorAll() { return []; }
}

const descendants = (element) => [element, ...element.children.flatMap(descendants)];

test('Audit mode shows all mics, explicit errors and filter JSON through textContent; existing modes still work', (t) => {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: (tag) => new Element(tag) };
  t.after(() => {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  });
  const elements = new Map();
  const $ = (id) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  for (const value of ['total', 'by_source', 'by_path', 'noise']) {
    const option = new Element('option');
    option.value = value;
    $('mvMode').append(option);
  }
  const scenario = defaultScenario();
  Object.assign(scenario.settings, { render_sample_rate: 8000, noise_off: true, air_absorption: false, ground_reflectivity: 0 });
  scenario.nodes = [newNode('n', 8, 0)];
  scenario.sources = [{ ...newSource('<img src=x onerror=bad()>', 'tone', 0, 0, 90), start_s: 0.1 }];
  const rendered = renderScenario(scenario, new Map([['tone', Float32Array.from({ length: 64 }, (_, i) => Math.sin(i))]]), { lengthS: 0.5 });
  rendered.applied_paths[0][0][0].delay_samples += 0.051;
  const requests = [];
  const view = createMicView({
    $, getRendered: () => rendered, getScenario: () => scenario, getResults: () => [],
    requestComponents: (...args) => requests.push(args), getStatus: () => 'ready'
  });
  view.open('n');
  assert.equal($('mvMode').options.filter((option) => option.value === 'audit').length, 1);
  const changeMode = (value) => $('mvMode').events.change({ target: { value } });
  changeMode('audit');
  const panel = $('micView').children.find((child) => child.id === 'mvAudit');
  assert.equal(panel.hidden, false);
  assert.equal($('mvBody').style.display, 'none');
  assert.equal(requests.length, 0);
  view.draw();
  const nodes = descendants(panel);
  const text = nodes.map((node) => node.textContent).join('\n');
  for (const label of ['delay_error_samples', 'gain_error_db', 'filter_error_db', 'expected filter model', 'applied filter', 'ground_disabled', 'endpoint_note', 'fft_size', '<img src=x onerror=bad()>']) assert.ok(text.includes(label), label);
  const table = panel.children.find((child) => child.tagName === 'table');
  for (const mic of ['1', '2', '3', '4']) assert.ok(table.children.some((row) => row.children[0].textContent === mic));
  assert.ok(table.children.some((row) => row.style.color === '#ff5252'));
  assert.ok(nodes.every((node) => node.htmlWrites === 0));
  for (const mode of ['by_source', 'by_path', 'noise']) changeMode(mode);
  assert.equal(requests.length, 3);
  changeMode('total');
  assert.equal(panel.hidden, true);
  assert.equal($('mvBody').style.display, '');
  assert.equal(requests.length, 3);
});
