// Run: node test/telemetry-harness.js   (needs only Node, no dependencies)
// Extracts the GA.telemetry module from grepo-alerts.user.js and exercises it with a fake browser:
// region detection (UT-10), install id (UT-07), daily sending (UT-08), counters (UT-09),
// consent gating (UT-11, UT-13) and the stop toggle (UT-12).
// The consent window DOM is NOT covered here; it needs an in-game check.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = process.argv[2] || path.join(__dirname, '..', 'grepo-alerts.user.js');
const source = fs.readFileSync(SRC, 'utf8');
const startMatch = /GA\.TELEMETRY_URL\s*=\s*'[^']*'/.exec(source);
const start = startMatch ? startMatch.index : -1;
const end = source.indexOf('// MODULE: UI');
if (start < 0 || end < 0) throw new Error('telemetry module markers not found');
const moduleCode = source.slice(start, source.lastIndexOf('// ═', end));

let failed = false;
const check = (label, ok, detail) => {
  console.log((ok ? 'PASS ' : 'FAIL ') + label + (detail ? ' — ' + detail : ''));
  if (!ok) failed = true;
};
const tick = () => new Promise((r) => setTimeout(r, 5));

function makeWorld({ tz = 'America/Bogota', languages = ['es-CO'], world = 'ar105', url = 'https://w.example/telemetry' } = {}) {
  const store = new Map();
  const fetches = [];
  const env = { respond: () => Promise.resolve({ status: 204 }) };
  const sandbox = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
    },
    navigator: { languages, language: languages[0] },
    Intl: { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: env.tz }) }) },
    crypto: { randomUUID: () => require('crypto').randomUUID() },
    fetch: (u, o) => { fetches.push({ url: u, opts: o, body: JSON.parse(o.body) }); return env.respond(); },
    document: {},
    JSON, Date, Math, Object, Array, String, Number, Promise, Set,
  };
  env.tz = tz;
  const GA = {
    VERSION: '0.2.5a',
    _worldId: () => world,
    _playerId: () => 316902,
    ui: {},
  };
  sandbox.GA = GA;
  sandbox.win = sandbox;
  sandbox.log = () => {};
  sandbox.warn = () => {};
  vm.runInNewContext(moduleCode, sandbox);
  GA.TELEMETRY_URL = url;
  return { GA, T: GA.telemetry, fetches, store, env };
}

const DAY1 = Date.UTC(2026, 9, 31, 10);
const DAY2 = Date.UTC(2026, 10, 1, 10);

(async () => {
  // UT-10: region detection
  const { T } = makeWorld();
  const cases = [
    ['Europe/Madrid', ['es-CO'], true, 'European time zone wins over a Latin American language'],
    ['America/Bogota', ['es-ES'], false, 'non-European time zone is not exempted nor forced by language'],
    ['Atlantic/Canary', [], true, 'Canary Islands'],
    ['Europe/London', ['en-GB'], true, 'UK'],
    [undefined, ['es-ES'], true, 'unreadable time zone + European region'],
    [undefined, ['es-AR'], false, 'unreadable time zone + Argentine region'],
    [undefined, ['es'], false, 'unreadable time zone + bare language'],
    [undefined, [], false, 'nothing readable => no window'],
    [undefined, ['en-US', 'de-AT'], true, 'any European language region counts'],
    [undefined, ['zh-Hans-CN'], false, 'script subtag is not mistaken for a region'],
    ['', ['fr-FR'], true, 'empty time zone counts as unreadable'],
  ];
  for (const [tz, langs, expected, why] of cases) {
    check(`region: ${tz ?? 'undefined'} + [${langs}] => ${expected}`, T.regionNeedsConsent(tz, langs) === expected, why);
  }

  // UT-07: install id
  const a = makeWorld();
  const id1 = a.T.getInstallId();
  check('install id is a UUID v4', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id1), id1);
  check('install id is stable', a.T.getInstallId() === id1);
  check('store key carries no world nor player id', !a.T.STORE_KEY.includes('ar105') && !a.T.STORE_KEY.includes('316902'), a.T.STORE_KEY);

  // Nothing is sent while TELEMETRY_URL is empty
  const inert = makeWorld({ url: '' });
  inert.T.count('bell_used');
  check('empty URL: nothing counted', (inert.T._read().counters || {}).bell_used === undefined);
  check('empty URL: nothing sent', inert.T.maybeSend(DAY1) === false && inert.fetches.length === 0);

  // UT-08 / UT-09 / UT-12: non-European sends without a window
  const n = makeWorld();
  n.T.count('bell_used'); n.T.count('bell_used'); n.T.count('alert_notified'); n.T.count('player_id');
  check('unknown feature is ignored', (n.T._read().counters || {}).player_id === undefined);
  check('maybeSend fires', n.T.maybeSend(DAY1) === true);
  await tick();
  const body = n.fetches[0].body;
  check('payload has exactly the agreed keys', Object.keys(body).sort().join() === 'features,install_id,tool,version,world', Object.keys(body).join());
  check('payload values', body.world === 'ar105' && body.tool === 'grepo-alerts' && body.version === '0.2.5a'
    && body.features.bell_used === 2 && body.features.alert_notified === 1);
  check('player id is not in the request', !JSON.stringify(n.fetches[0]).includes('316902'));
  check('request: POST json, no credentials', n.fetches[0].opts.method === 'POST'
    && n.fetches[0].opts.headers['Content-Type'] === 'application/json' && n.fetches[0].opts.credentials === 'omit');
  check('counters cleared after a 204', Object.keys(n.T._read().counters || {}).length === 0);
  check('second call the same UTC day sends nothing', n.T.maybeSend(DAY1 + 3600e3) === false && n.fetches.length === 1);
  n.T.count('bell_used');
  check('next UTC day sends again', n.T.maybeSend(DAY2) === true);
  await tick();
  check('...with only the new counts', n.fetches[1].body.features.bell_used === 1 && Object.keys(n.fetches[1].body.features).length === 1);

  // UT-08: failure is silent and retried next time
  const f = makeWorld();
  f.env.respond = () => Promise.reject(new TypeError('Failed to fetch'));
  f.T.count('bell_used');
  f.T.maybeSend(DAY1);
  await tick();
  check('failed send keeps the counters', f.T._read().counters.bell_used === 1);
  check('failed send does not mark the day as sent', f.T._read().lastDay === undefined);
  f.env.respond = () => Promise.resolve({ status: 500 });
  check('retry on next load', f.T.maybeSend(DAY1) === true);
  await tick();
  check('a non-204 answer is not treated as sent', f.T._read().lastDay === undefined && f.T._read().counters.bell_used === 1);

  // counts made while the request is in flight are kept
  const inflight = makeWorld();
  let release;
  inflight.env.respond = () => new Promise((r) => { release = () => r({ status: 204 }); });
  inflight.T.count('bell_used');
  inflight.T.maybeSend(DAY1);
  inflight.T.count('bell_used');
  release(); await tick();
  check('counts during the request survive', inflight.T._read().counters.bell_used === 1);

  // UT-12 stop toggle
  const off = makeWorld();
  off.T.setEnabled(false);
  off.T.count('bell_used');
  check('stop toggle: nothing counted nor sent', off.T.maybeSend(DAY1) === false && off.fetches.length === 0
    && (off.T._read().counters || {}).bell_used === undefined);

  // Invalid world is never sent
  const w = makeWorld({ world: 'unknown' });
  check('invalid world: nothing sent', w.T.maybeSend(DAY1) === false);

  // UT-11 / UT-13: European consent gating
  const eu = makeWorld({ tz: 'Europe/Madrid' });
  eu.T.count('bell_used');
  check('EU: nothing counted before consent', (eu.T._read().counters || {}).bell_used === undefined);
  check('EU: nothing sent before consent', eu.T.maybeSend(DAY1) === false && eu.fetches.length === 0);
  check('EU: no consent recorded yet', eu.T.consentRecorded() === false);
  eu.T.setConsent('accepted');
  check('EU accepted: recorded for the current policy version', eu.T.consentRecorded() && eu.T.consentAccepted());
  eu.T.count('bell_used');
  check('EU accepted: counts and sends', eu.T.maybeSend(DAY1) === true);
  await tick();
  check('EU accepted: payload carries the count', eu.fetches[0].body.features.bell_used === 1);

  const dec = makeWorld({ tz: 'Europe/Berlin' });
  dec.T.setConsent('declined');
  dec.T.count('bell_used');
  check('EU declined: no sending, no counting, toggle off',
    dec.T.maybeSend(DAY1) === false && dec.fetches.length === 0 && dec.T.isEnabled() === false
    && (dec.T._read().counters || {}).bell_used === undefined);
  check('EU declined: window is not shown again for this policy version', dec.T.consentRecorded() === true);

  eu.GA.POLICY_VERSION = '2027-01-01';
  check('new policy version asks again', eu.T.consentRecorded() === false && eu.T.consentAccepted() === false);

  console.log(failed ? 'RESULT: FAIL' : 'RESULT: ALL PASS');
  process.exit(failed ? 1 : 0);
})();
