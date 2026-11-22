// Run: node test/movement-icon-harness.js [path-to-user.js]
// Toolbar movement rows carry icon classes like "attack_type32x32 attack_sea outgoing" / "attack_spy",
// and no id="movement_<n>" / data-timestamp. The type must come from those classes, never default to "Transporte".
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

const helper = cut('_fromIconClasses(icon) {', 'fromCommand(model, source');
const movRow = cut('fromMovementRow(wrap) {', 'fromCommandRow(li) {');
const rowFb  = cut('fromRow(row) {', 'GA.tracker = {');
if (!helper || !movRow || !rowFb) {
  check('Parser has _fromIconClasses, fromMovementRow and fromRow', false, 'markers not found');
  console.log('RESULT: FAIL');
  process.exit(1);
}

const NOW = 1795300000000;
const sandbox = { Date: { now: () => NOW }, Number, Boolean, String, console };
vm.runInNewContext(`
  GA = {
    utils: { parseTimer: el => (el && el.remainingMs ? Date.now() + el.remainingMs : null), uid: () => 'RND' },
    game:  { getCurrentTownId: () => 50 },
  };
  parser = {
    TYPES: { attack: { label: 'Ataque' }, support: { label: 'Apoyo' }, colonization: { label: 'Colonización' },
             attack_takeover: { label: 'Conquista' },
             spy: { label: 'Espionaje' }, transport: { label: 'Transporte' } },
    _meta(type) { return this.TYPES[type] || { label: type || 'Movimiento' }; },
    _base: (id, type, tsMs, townId, extra) => ({ id, type, tsMs, townId, label: extra?.label, ...extra }),
    ${helper},
    ${movRow},
    ${rowFb.slice(0, rowFb.lastIndexOf('}'))}
  };
`, sandbox);
const { parser } = sandbox;

const classList = arr => Object.assign([...arr], { contains: t => arr.includes(t) });
const makeRow = ({ icon, town = 'Ciudad de ValhallaAwaits', remainingMs = 1664000, text = '', id, ts, commandtype } = {}) => ({
  id, dataset: { timestamp: ts, commandtype },
  textContent: text || `00:27:44 ${town}`,
  querySelector(sel) {
    if (sel === '.icon') return icon ? { classList: classList(icon.split(' ')) } : null;
    if (sel.startsWith('[data-end-at]')) return { remainingMs };
    if (sel === '.town_link a') return town ? { textContent: ` ${town} ` } : null;
    return null;
  },
});

// Real rows pasted from the game (no id, no data-timestamp).
const attack = parser.fromRow(makeRow({ icon: 'icon attack_type32x32 attack_sea outgoing' }));
check('outgoing attack row is an attack, not Transporte', attack && attack.type === 'attack', attack && attack.type);
check('attack label names the target town', attack && attack.label === 'Ataque: Ciudad de ValhallaAwaits', attack && attack.label);
check('attack_type32x32 (size class) is not mistaken for a type',
  parser.fromRow(makeRow({ icon: 'icon attack_type32x32 outgoing' })).type === 'transport');

const spy = parser.fromRow(makeRow({ icon: 'icon attack_type32x32 attack_spy ', town: 'Ciudad de MANUELGALLEGO' }));
check('spy row is espionage', spy && spy.type === 'spy' && spy.label === 'Espionaje: Ciudad de MANUELGALLEGO', spy && spy.label);

const ret = parser.fromRow(makeRow({ icon: 'icon attack_type32x32 attack_land returning' }));
check('returning attack troops are labeled (retorno)', ret && ret.type === 'attack' && ret.label === 'Ataque (retorno): Ciudad de ValhallaAwaits', ret && ret.label);

const takeover = parser.fromRow(makeRow({ icon: 'icon attack_type32x32 attack_takeover outgoing', town: 'Puerto Ayora' }));
check('settler takeover row is Conquista, not Transporte',
  takeover && takeover.type === 'attack_takeover' && takeover.label === 'Conquista: Puerto Ayora', takeover && takeover.label);
check('toolbar row keeps its town for cross-view matching',
  takeover && JSON.stringify(takeover.towns) === JSON.stringify(['Puerto Ayora']), takeover && JSON.stringify(takeover.towns));

const sup = parser.fromRow(makeRow({ icon: 'icon support outgoing' }));
check('support row is support', sup && sup.type === 'support', sup && sup.type);

check('legacy: row text keyword still decides when the icon says nothing',
  parser.fromRow(makeRow({ icon: null, text: 'Ataque 00:10:00' })).type === 'attack');
check('legacy: unknown row still defaults to transport',
  parser.fromRow(makeRow({ icon: null })).type === 'transport');

// fromMovementRow with an id must also recognize attack_sea / attack_spy (it only knew the bare "attack" token).
const withId = parser.fromMovementRow(makeRow({
  icon: 'icon attack_type32x32 attack_sea outgoing', id: 'movement_2104282057', ts: '1795301664', commandtype: 'unit_movements',
}));
check('fromMovementRow: attack_sea row with id -> mov_<id>', withId && withId.id === 'mov_2104282057' && withId.type === 'attack', withId && withId.id);
check('fromMovementRow: old bare "attack" token still works',
  parser.fromMovementRow(makeRow({ icon: 'icon attack', id: 'movement_7', ts: '1795301664', commandtype: 'unit_movements' })).id === 'mov_7');
check('fromMovementRow: support (retorno) keeps its label',
  parser.fromMovementRow(makeRow({ icon: 'icon support returning', id: 'movement_8', ts: '1795301664', commandtype: 'unit_movements', town: 'Argentina 01' })).label === 'Apoyo (retorno): Argentina 01');
check('fromMovementRow: still null without id', parser.fromMovementRow(makeRow({ icon: 'icon attack_sea' })) === null);

console.log(failed ? 'RESULT: FAIL' : 'RESULT: ALL PASS');
process.exit(failed ? 1 : 0);
