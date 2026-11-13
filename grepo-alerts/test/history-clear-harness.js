// Run: node test/history-clear-harness.js [path-to-user.js]   (needs only Node, no dependencies)
// Extracts _clearHistory() and _renderList() from GA.ui and runs them against a fake DOM and a fake
// alert store. Covers: the "Limpiar historial" button lives inside the history tab (not in the panel
// header), it only shows when there is history, and clearing removes notified alerts only.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = process.argv[2] || path.join(__dirname, '..', 'grepo-alerts.user.js');
const source = fs.readFileSync(SRC, 'utf8');

let failed = false;
const check = (label, ok, detail) => {
  console.log((ok ? 'PASS ' : 'FAIL ') + label + (detail ? ' — ' + detail : ''));
  if (!ok) failed = true;
};

// 1) The panel header must no longer contain the button.
const headerStart = source.indexOf('<div class="ga_ph_actions">');
const headerEnd = source.indexOf('</div>', headerStart);
const header = headerStart >= 0 ? source.slice(headerStart, headerEnd) : '';
check('panel header has no clear button', headerStart >= 0 && !header.includes('ga_clear'));

// 2) Extract the two UI methods.
const start = source.indexOf('_clearHistory() {');
const end = source.indexOf('_buildSettings() {');
if (start < 0 || end < 0 || end < start) {
  check('_clearHistory() exists next to _renderList()', false, 'markers not found');
  process.exit(1);
}
const methods = source.slice(start, end).replace(/,\s*$/, '');

function makeWorld(alerts) {
  const store = alerts.map((a) => ({ ...a }));
  const el = { style: { display: 'block' }, innerHTML: '', children: [], appendChild(c) { this.children.push(c); } };
  el.querySelector = (sel) => {
    if (sel === '#ga_open_custom') return {};
    return sel === '#ga_clear' && el.innerHTML.includes('id="ga_clear"') ? el._clearBtn || (el._clearBtn = {}) : null;
  };
  el.querySelectorAll = () => [];
  const sandbox = {
    document: { getElementById: () => el, createElement: () => ({ style: {}, set innerHTML(v) {}, querySelector: () => ({}) }) },
    Date, Math, JSON, Array, String, Number,
    GA: {
      storage: {
        getAlerts: () => store.slice(),
        removeAlert: (id) => { const i = store.findIndex((a) => a.id === id); if (i >= 0) store.splice(i, 1); },
      },
      tracker: { untrack: () => {} },
      utils: {
        esc: (s) => String(s),
        formatTime: () => '00:00:00',
        formatRelative: () => '1m',
      },
    },
  };
  sandbox.ui = null;
  // _render() sits just before the extracted slice; it is a two-line wrapper, mirrored here.
  vm.runInNewContext(`ui = { ${methods}, _activeTab: 'history', updateBadge() {}, _toggleCustomForm() {},
    _render() { this._renderList(this._activeTab); this.updateBadge(); } };`, sandbox);
  return { ui: sandbox.ui, el, store };
}

const done = (id) => ({ id, status: 'notified', tsMs: Date.now() - 1000, label: 'x' + id, icon: '!' });
const pending = (id) => ({ id, status: 'pending', tsMs: Date.now() + 60000, label: 'p' + id, icon: '!' });

// UT-01: history with items renders the button inside the tab content.
{
  const { ui, el } = makeWorld([done('a'), pending('b')]);
  ui._renderList('history');
  check('history tab shows the clear button', el.innerHTML.includes('id="ga_clear"'));
  check('button is labelled Limpiar historial', el.innerHTML.includes('Limpiar historial'));
}
// UT-02: empty history shows no button.
{
  const { ui, el } = makeWorld([pending('b')]);
  ui._renderList('history');
  check('empty history shows no clear button', !el.innerHTML.includes('ga_clear'));
}
// UT-03: the active tab never shows it.
{
  const { ui, el } = makeWorld([done('a'), pending('b')]);
  ui._renderList('active');
  check('active tab shows no clear button', !el.innerHTML.includes('ga_clear'));
}
// UT-04: clicking removes notified alerts only and leaves pending ones.
{
  const { ui, el, store } = makeWorld([done('a'), done('c'), pending('b')]);
  ui._renderList('history');
  const btn = el.querySelector('#ga_clear');
  check('clear button is wired', btn && typeof btn.onclick === 'function');
  btn.onclick();
  check('clearing removes every notified alert', !store.some((a) => a.status === 'notified'));
  check('clearing keeps pending alerts', store.length === 1 && store[0].id === 'b');
  check('list re-renders without the button after clearing', !el.innerHTML.includes('ga_clear'));
}

console.log(failed ? 'RESULT: FAILURES' : 'RESULT: ALL PASS');
process.exit(failed ? 1 : 0);
