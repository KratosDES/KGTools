// Run: node test/custom-time-harness.js [path-to-user.js]
// GA-003: custom "hora exacta" must be wall clock in Game.player_timezone, not the browser zone.
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

const start = source.indexOf('gameWallTimeToMs(hh, mm, ss, nowMs, tz)');
const end = source.indexOf('uid() {');
if (start < 0 || end < 0 || end < start) {
  check('gameWallTimeToMs is in Utils', false, 'markers not found');
  process.exit(1);
}

const slice = source.slice(source.lastIndexOf('formatTime(tsMs, tz)', start), end);
const sandbox = { Intl, Date, Number, String, Math, console };
vm.runInNewContext(`utils = { ${slice} };`, sandbox);
const { formatTime, gameWallTimeToMs } = sandbox.utils;

const GAME_TZ = 'Asia/Bangkok';      // UTC+7
const BROWSER_TZ = 'America/Bogota'; // UTC-5  (12h apart — the reported 02:00 → 14:00 case)
const now = Date.UTC(2026, 10, 16, 15, 0, 0); // 22:00 in Bangkok, 10:00 in Bogota

const ts = gameWallTimeToMs(2, 0, 0, now, GAME_TZ);
check('exact 02:00 in game TZ displays as 02:00', formatTime(ts, GAME_TZ) === '02:00', formatTime(ts, GAME_TZ));

const bogus = new Date(now);
bogus.setHours(2, 0, 0, 0); // browser-local — must NOT be what we store
check('does not use browser setHours (02:00 → 14:00 in game TZ)',
  formatTime(ts, GAME_TZ) !== formatTime(bogus.getTime(), GAME_TZ)
  || Intl.DateTimeFormat().resolvedOptions().timeZone === GAME_TZ);

check('target is in the future', ts > now);

const late = gameWallTimeToMs(23, 0, 0, now, GAME_TZ); // 23:00 Bangkok, now is 22:00 → same day
check('later same day stays today', formatTime(late, GAME_TZ) === '23:00', formatTime(late, GAME_TZ));

const past = gameWallTimeToMs(21, 0, 0, now, GAME_TZ); // 21:00 already passed → next day 21:00
check('past wall clock rolls to next day', past > now && formatTime(past, GAME_TZ) === '21:00');

check('countdown path unchanged: relative ms + formatTime still 24h',
  formatTime(now + 3600 * 1000, GAME_TZ).length === 5);

console.log(failed ? 'RESULT: FAIL' : 'RESULT: ALL PASS');
process.exit(failed ? 1 : 0);
