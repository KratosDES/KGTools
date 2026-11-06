// Run: node test/channel-guard-harness.js   (needs only Node, no dependencies)
// Extracts the channel guard (between the GUARD START / GUARD END markers) from grepo-alerts.user.js
// and exercises it with a fake browser: first load, a second script loading on the same page
// (stable + beta installed together), once-per-session notice and blocked sessionStorage.
// Channel-agnostic: it reads the channel the script was built for, so it runs on both branches.
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2] || path.join(__dirname, '..', 'grepo-alerts.user.js');
const source = fs.readFileSync(SRC, 'utf8');
const start = source.indexOf('// GUARD START');
const end = source.indexOf('// GUARD END');
if (start < 0 || end < 0) throw new Error('guard markers not found');
const body = source.slice(start, end);

const declared = /const CHANNEL = '(beta|stable)';/.exec(body);
if (!declared) throw new Error('CHANNEL declaration not found');
const own = declared[1];
const other = own === 'beta' ? 'stable' : 'beta';
const NAME = { beta: 'GrepoAlerts (Beta)', stable: 'GrepoAlerts' };

// Returns 'continued' when the guard lets the script initialise, undefined when it stops it
const run = (win, document, sessionStorage, channel = own) => {
  const code = body.replace(`const CHANNEL = '${own}';`, `const CHANNEL = '${channel}';`);
  return new Function('win', 'document', 'sessionStorage', code + '\nreturn "continued";')(win, document, sessionStorage);
};

const makeEnv = () => {
  const boxes = [];
  const store = {};
  const el = () => ({ style: {}, children: [], setAttribute() {}, appendChild(c) { this.children.push(c); }, remove() {} });
  return {
    boxes,
    document: { createElement: el, body: { appendChild: (b) => boxes.push(b) } },
    sessionStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } },
  };
};

let failed = false;
const check = (label, ok, detail) => {
  console.log((ok ? 'PASS ' : 'FAIL ') + label + (detail ? ' — ' + detail : ''));
  if (!ok) failed = true;
};

console.log(`channel under test: ${own}`);

let env = makeEnv();
let win = {};
check('first load continues and records its channel',
  run(win, env.document, env.sessionStorage) === 'continued' && win.__GrepoAlertsLoaded === own);

env = makeEnv();
win = { __GrepoAlertsLoaded: other };
check('second load (the other channel already loaded) does not continue', run(win, env.document, env.sessionStorage) === undefined);
const text = env.boxes[0]?.textContent || '';
check('shows a notice naming both scripts',
  env.boxes.length === 1 && text.includes(NAME.stable) && text.includes(NAME.beta), text);
check('the notice says which one is running', text.includes(`Ahora funciona ${NAME[other]}.`));
check('does not overwrite the first load marker', win.__GrepoAlertsLoaded === other);
run(win, env.document, env.sessionStorage);
check('the notice is shown once per session', env.boxes.length === 1);

env = makeEnv();
win = { __GrepoAlertsLoaded: own };
check('the same channel loaded twice also stops',
  run(win, env.document, env.sessionStorage) === undefined
  && (env.boxes[0]?.textContent || '').includes(`Ahora funciona ${NAME[own]}.`));

env = makeEnv();
win = { __GrepoAlertsLoaded: own };
check('the other channel arriving second also stops and names the running one',
  run(win, env.document, env.sessionStorage, other) === undefined
  && (env.boxes[0]?.textContent || '').includes(`Ahora funciona ${NAME[own]}.`));

env = makeEnv();
win = { __GrepoAlertsLoaded: other };
const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
let threw = false;
let result;
try { result = run(win, env.document, blocked); } catch { threw = true; }
check('blocked sessionStorage does not throw and still stops', !threw && result === undefined);

process.exit(failed ? 1 : 0);
