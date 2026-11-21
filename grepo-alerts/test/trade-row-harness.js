// Run: node test/trade-row-harness.js [path-to-user.js]
// GA-001: a bell on a toolbar trade row (#toolbar_activity_trades_list .item.trade[data-id]) must get a
// stable id, so clicking it again reports "Ya registrado" instead of creating a random dom_<uid> alert.
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

const start = source.indexOf('fromTradeRow(row) {');
const end = source.indexOf('fromRow(row) {');
if (start < 0 || end < 0 || end < start) {
  check('fromTradeRow exists in Parser', false, 'markers not found');
  console.log('RESULT: FAIL');
  process.exit(1);
}

const NOW = 1795210000000;
const sandbox = { Date: { now: () => NOW }, Number, Boolean, console };
vm.runInNewContext(`
  GA = {
    utils: { parseTimer: el => (el && el.remainingMs ? Date.now() + el.remainingMs : null) },
    game:  { getCurrentTownId: () => 50 },
  };
  parser = {
    _meta: () => ({ label: 'Transporte', icon: 'T' }),
    _base: (id, type, tsMs, townId, extra) => ({ id, type, tsMs, townId, ...extra }),
    ${source.slice(start, end).replace(/,\s*$/, '')}
  };
`, sandbox);
const { parser } = sandbox;

// Minimal stand-in for the real row captured in game (data-id="8395", returning leg, 00:14:26 left).
const makeRow = ({ id = '8395', returning = true, remainingMs = 866000, town = '07A0-Qarkash', isTrade = true } = {}) => ({
  dataset: id === null ? {} : { id },
  classList: { contains: c => isTrade && c === 'trade' },
  querySelector(sel) {
    if (sel === '.time') return { remainingMs };
    if (sel === '.icon.returning') return returning ? {} : null;
    if (sel === '.town_link a') return town ? { textContent: ` ${town} ` } : null;
    return null;
  },
});

const a = parser.fromTradeRow(makeRow());
check('returns an alert for a trade row', !!a);
check('id is stable, from data-id (no random uid)', a && a.id === 'dom_trade_8395_ret', a && a.id);
check('same row twice -> same id (dedup works)', parser.fromTradeRow(makeRow()).id === a.id);
check('same row later in time -> same id', parser.fromTradeRow(makeRow({ remainingMs: 500000 })).id === a.id);

const outbound = parser.fromTradeRow(makeRow({ returning: false }));
check('outbound leg id differs from return leg', outbound && outbound.id === 'dom_trade_8395' && outbound.id !== a.id, outbound && outbound.id);
check('different trade -> different id', parser.fromTradeRow(makeRow({ id: '9000' })).id !== a.id);

check('type is transport, source DOM', a && a.type === 'transport' && a.source === 'DOM');
check('modelId is the numeric data-id', a && a.modelId === 8395);
check('tsMs = now + remaining', a && a.tsMs === NOW + 866000, a && a.tsMs);
check('label names the return leg and town', a && a.label === 'Transporte (retorno): 07A0-Qarkash', a && a.label);
check('label without town degrades cleanly', parser.fromTradeRow(makeRow({ town: null })).label === 'Transporte (retorno)');

check('row without data-id -> null', parser.fromTradeRow(makeRow({ id: null })) === null);
check('non-trade row -> null', parser.fromTradeRow(makeRow({ isTrade: false })) === null);
check('no countdown -> null', parser.fromTradeRow(makeRow({ remainingMs: 0 })) === null);

// Wiring: the bell handler must try the trade row before the random-id generic fallback.
const handler = source.slice(source.indexOf('_onBellClick(bell, row) {'));
const iTrade = handler.indexOf('fromTradeRow(');
const iFallback = handler.indexOf('GA.parser.fromRow(row)');
check('_onBellClick calls fromTradeRow before the generic fromRow fallback',
  iTrade > 0 && iFallback > 0 && iTrade < iFallback);

console.log(failed ? 'RESULT: FAIL' : 'RESULT: ALL PASS');
process.exit(failed ? 1 : 0);
