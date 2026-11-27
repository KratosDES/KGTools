// Run: node test/trade-resources-harness.js [path-to-user.js]
// In Grepolis the `iron` resource is shown as "Plata" (silver coins), never "Hierro".
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

const s = source.indexOf('fromCommand(model, source');
const e = source.indexOf('fromMovement(model) {', s);
if (s < 0 || e < 0) {
  check('fromCommand is in Parser', false, 'markers not found');
  console.log('RESULT: FAIL');
  process.exit(1);
}
const body = source.slice(s, e).replace(/\/\*\*[\s\S]*$/, '').replace(/,\s*$/, '');

const sandbox = { Number, console };
vm.runInNewContext(`
  parser = {
    _meta: () => ({ label: 'Transporte' }),
    _base: (id, type, tsMs, townId, extra) => ({ id, type, tsMs, townId, ...extra }),
    ${body}
  };
`, sandbox);

const trade = sandbox.parser.fromCommand({
  id: 2837,
  attributes: { arrival_at: 1794845354, origin_town_id: 50, destination_town_name: '07A0-Desembarco',
                wood: 3243, stone: 100, iron: 3257, gold: 0 },
}, 'Trade');

check('iron is labeled Plata', trade && trade.resources.includes('plata:3257'), trade && trade.resources);
check('Hierro never appears', trade && !/hierro/i.test(trade.label + trade.resources), trade && trade.label);
check('wood and stone unchanged', trade && trade.resources.includes('madera:3243') && trade.resources.includes('piedra:100'));
check('zero amounts are skipped', trade && !trade.resources.includes('oro'));
check('full label', trade && trade.label === 'Transporte → 07A0-Desembarco [madera:3243 piedra:100 plata:3257]', trade && trade.label);

console.log(failed ? 'RESULT: FAIL' : 'RESULT: ALL PASS');
process.exit(failed ? 1 : 0);
