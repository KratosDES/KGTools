// Run: node test/cross-view-dedup-harness.js [path-to-user.js]
// The same movement can be bell-registered from the normal toolbar row and from the premium orders viewer.
// Each view builds a different id, and its time comes from a countdown read at click time (~1s apart),
// so storage must recognise "same moment + a city in common" as already registered.
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

const cut = (startMarker, endMarker) => {
  const s = source.indexOf(startMarker);
  const e = source.indexOf(endMarker, s + 1);
  if (s < 0 || e < 0) return null;
  return source.slice(s, e).replace(/\/\*\*[\s\S]*$/, '').replace(/,\s*$/, '');
};

const finder = cut('findEquivalent(alert', 'removeAlert(id) {');
const cmdRow = cut('fromCommandRow(li) {', 'fromBuildingOrder(model) {');
if (!finder || !cmdRow) {
  check('storage.findEquivalent and parser.fromCommandRow exist', false, 'markers not found');
  console.log('RESULT: FAIL');
  process.exit(1);
}

const NOW = 1795328000000;
const sandbox = { Date: { now: () => NOW }, Math, Number, Boolean, console, stored: [] };
vm.runInNewContext(`
  GA = {
    utils: { parseTimer: el => (el && el.remainingMs ? Date.now() + el.remainingMs : null) },
    game:  { getCurrentTownId: () => 50 },
  };
  storage = { _read: () => ({ alerts: stored }), ${finder} };
  parser = {
    TYPES: { attack_takeover: { label: 'Conquista' }, attack: { label: 'Ataque' } },
    _meta(type) { return this.TYPES[type] || { label: type || 'Movimiento' }; },
    _base: (id, type, tsMs, townId, extra) => ({ id, type, tsMs, townId, status: 'pending', label: extra?.label, ...extra }),
    ${cmdRow}
  };
`, sandbox);
const { storage, parser } = sandbox;

// Premium viewer row for the settler attack (real data: cmdrow_23923, 07A-Desembarco -> Puerto Ayora).
const li = {
  id: 'command_23923',
  dataset: { command_type: 'attack_takeover' },
  querySelector: sel => (sel === '.countdown' ? { remainingMs: 602869 } : null),
  querySelectorAll: sel => (sel === '.cmd_span .gp_town_link'
    ? [{ textContent: ' 07A-Desembarco ' }, { textContent: 'Puerto Ayora' }] : []),
};
const premium = parser.fromCommandRow(li);
check('premium row: type attack_takeover has a readable label',
  premium && premium.label === 'Conquista: 07A-Desembarco → Puerto Ayora', premium && premium.label);
check('premium row keeps its towns for cross-view matching',
  premium && JSON.stringify(premium.towns) === JSON.stringify(['07A-Desembarco', 'Puerto Ayora']), premium && JSON.stringify(premium.towns));

// Normal toolbar alert for the same movement, registered ~1.2s apart (real data).
const normal = { id: 'dom_mwremhq69gb8', status: 'pending', source: 'DOM', type: 'attack_takeover',
  tsMs: premium.tsMs - 1223, towns: ['Puerto Ayora'] };

sandbox.stored = [premium];
check('normal row is equivalent to the premium one (1.2s apart, shared city)', !!storage.findEquivalent(normal));
check('works the other way round', (sandbox.stored = [normal], !!storage.findEquivalent(premium)));

sandbox.stored = [premium];
check('beyond the tolerance -> not equivalent', !storage.findEquivalent({ ...normal, tsMs: premium.tsMs - 10000 }));
check('no city in common -> not equivalent', !storage.findEquivalent({ ...normal, towns: ['Otra ciudad'] }));
check('already notified alert is not a match', (sandbox.stored = [{ ...premium, status: 'notified' }], !storage.findEquivalent(normal)));
check('stored alert without towns is not a match', (sandbox.stored = [{ ...premium, towns: undefined }], !storage.findEquivalent(normal)));
check('alert without towns never matches (auto-tracked, bldg, custom)', (sandbox.stored = [premium], !storage.findEquivalent({ ...normal, towns: undefined })));
check('same id is not its own duplicate', (sandbox.stored = [premium], !storage.findEquivalent(premium)));

// Real case reported after 0.3.3f: the normal view registered mov_1829609890 through fromMovementRow
// (stable id, exact seconds). It must carry its towns too, or the premium click never finds it.
const viaMovementRow = {
  id: 'mov_1829609890', status: 'pending', source: 'MovementsUnits', type: 'attack_takeover',
  tsMs: 1795328601000, towns: ['Puerto Ayora'],
};
sandbox.stored = [viaMovementRow];
check('premium click finds the normal-view alert that has a stable mov_ id (1.15s apart)', !!storage.findEquivalent(premium));
sandbox.stored = [premium];
check('normal-view mov_ click finds the premium alert', !!storage.findEquivalent(viaMovementRow));

const movRowSrc = cut('fromMovementRow(wrap) {', 'fromCommandRow(li) {');
const movSrc = cut('fromMovement(model) {', 'fromMovementRow(wrap) {');
vm.runInNewContext(`
  GA.game.isOwnTown = () => false;
  parser2 = Object.assign({}, parser, {
    _fromIconClasses: icon => ({ type: icon.type, returning: false }),
    ${movRowSrc},
    ${movSrc}
  });
`, sandbox);
const row = {
  id: 'movement_1829609890', dataset: { timestamp: '1795328601', commandtype: 'unit_movements' },
  querySelector: sel => (sel === '.icon' ? { type: 'attack_takeover' } : sel === '.town_link a' ? { textContent: ' Puerto Ayora ' } : null),
};
const fromRow = sandbox.parser2.fromMovementRow(row);
check('fromMovementRow keeps the row town in towns',
  fromRow && JSON.stringify(fromRow.towns) === JSON.stringify(['Puerto Ayora']), fromRow && JSON.stringify(fromRow.towns));

const auto = sandbox.parser2.fromMovement({ id: 5, attributes: {
  type: 'attack', arrival_at: 1795328601, town_name_origin: '07A-Desembarco', town_name_destination: 'Puerto Ayora', target_town_id: 106,
} });
check('fromMovement (auto-track) keeps origin and destination names',
  auto && JSON.stringify(auto.towns) === JSON.stringify(['07A-Desembarco', 'Puerto Ayora']), auto && JSON.stringify(auto.towns));
const autoIds = sandbox.parser2.fromMovement({ id: 6, attributes: { type: 'attack', arrival_at: 1795328601, home_town_id: 1, target_town_id: 106 } });
check('fromMovement does not store numeric id fallbacks as city names', autoIds && (!autoIds.towns || autoIds.towns.length === 0), autoIds && JSON.stringify(autoIds.towns));

// Wiring: the bell must ask storage for an equivalent alert before tracking.
const handler = source.slice(source.indexOf('_onBellClick(bell, row) {'));
const iFind = handler.indexOf('findEquivalent(');
const iTrack = handler.indexOf('GA.tracker.track(alert)');
check('_onBellClick checks findEquivalent before tracker.track', iFind > 0 && iTrack > 0 && iFind < iTrack);

console.log(failed ? 'RESULT: FAIL' : 'RESULT: ALL PASS');
process.exit(failed ? 1 : 0);
