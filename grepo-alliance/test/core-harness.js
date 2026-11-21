// Run: node test/core-harness.js   (needs only Node, no dependencies)
// Extracts the GAL.core module from grepo-alliance.user.js and exercises it with HTML fixtures that
// copy the structure of the game's message views (docs/evidencia-mensajes.md), using made-up players.
// The capture observer and the panel DOM are NOT covered here; they need an in-game check.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = process.argv[2] || path.join(__dirname, '..', 'grepo-alliance.user.js');
const source = fs.readFileSync(SRC, 'utf8');
const start = source.indexOf('// ═══ MODULE: CORE');
const end = source.indexOf('// ═══ MODULE: STORAGE');
if (start < 0 || end < 0) throw new Error('core module markers not found');

const GAL = {};
vm.runInNewContext(source.slice(start, end), { GAL, atob });
const core = GAL.core;

let failed = false;
const check = (label, ok, detail) => {
  console.log((ok ? 'PASS ' : 'FAIL ') + label + (detail ? ' — ' + detail : ''));
  if (!ok) failed = true;
};

const link = (name, id) =>
  `<a href="#${Buffer.from(JSON.stringify({ name, id })).toString('base64')}" class="gp_player_link">${name}</a>`;

const recipientsView = (subject, list) => `<div id="message_message_list" class="game_inner_box">
    <div class="game_border ">
    <div class="game_header bold" style="height: 18px;">
        ${subject}<br>
    </div>
    <div class="message_post_container">
        <ul class="game_list">
${list.map(([name, id, state], i) => `                            <li class="${i % 2 ? 'odd' : 'even'}">
                    <div id="message_status_${state}" class="message_status ${state}" style="margin: 0px 5px 0px 0px;"></div>
                    ${link(name, id)}                </li>`).join('\n')}
                    </ul>
    </div>
        </div>
    </div>`;

const thread = ([id, subject, massmail, name, playerId]) => `    <li class="message_item odd ui-draggable ui-draggable-handle bottom" unselectable="on" style="background: rgba(0, 153, 255, 0.4)">
        <div class="drag_handle size_24x24"></div>
        <div class="message_subject" unselectable="on">
            <a href="#" onclick="w(this).sendMessage('messageView', ${id}, 'view');" unselectable="on">
                <span class="message_icon status_read">
                    ${massmail ? '<span class="massmail">\n                        </span>' : ''}
                                    </span>
                ${subject}            </a>
        </div>
        <div class="message_date small" unselectable="on">
            <span class="message_icon status_answered" unselectable="on"></span>
            ${link(name, playerId)} el 12/11/26 a la/s 18:32            <input type="checkbox" name="message_ids[]" value="${id}">
        </div>
        <div style="clear:both;"></div>
    </li>`;

const folderView = (folderName, folderId, threads) => `<div id="folder_container">
            <div id="folder_toggle_menu" class="bold">
                <a href="#" class="folder_toggle_link" onclick="Message.toggleMenu()">
                    <span class="folder_icon"></span>
                    <span class="folder_icon_text">
                    ${folderName}                    </span>
                </a>
            </div>
            <input name="message_form_folder_id" id="message_form_folder_id" type="hidden" value="${folderId}">
            <ul class="game_list" id="message_list" unselectable="on">
${threads.map(thread).join('\n')}
                            </ul>
        </div>`;

const SUBJECT = '🏛️ BOLETÍN 1 – PRUEBA';
const KEY = core.normalize(SUBJECT);

// ── Parsers ──
const groupA = core.parseRecipients(recipientsView(SUBJECT, [
  ['Alfa', 101, 'answered'], ['Beta Dos', 102, 'read'], ['Gamma', 103, 'new'], ['Delta', 104, 'answered'],
]));
check('parseRecipients: subject', groupA && groupA.subject === SUBJECT, groupA && groupA.subject);
check('parseRecipients: one row per recipient', groupA && groupA.recipients.length === 4);
check('parseRecipients: id, name and state', groupA && JSON.stringify(groupA.recipients[1]) === JSON.stringify({ id: 102, name: 'Beta Dos', state: 'read' }));
check('parseRecipients: null for another view', core.parseRecipients(folderView('Boletines', 1, [[7, SUBJECT, true, 'Alfa', 101]])) === null);

const folder = core.parseThreadList(folderView('Boletines', 1, [
  [141, SUBJECT, true, 'Alfa', 101],
  [150, SUBJECT, true, 'Beta Dos', 102],
  [186, 'Enlace de invitacion', false, 'Gamma', 103],
  [190, SUBJECT, true, 'Epsilon', 201],
]));
check('parseThreadList: folder name and id', folder.folderName === 'Boletines' && folder.folderId === 1);
check('parseThreadList: one thread per row', folder.threads.length === 4);
check('parseThreadList: thread fields', JSON.stringify(folder.threads[0]) === JSON.stringify({ id: 141, subject: SUBJECT, massmail: true, senderId: 101, senderName: 'Alfa' }));
check('parseThreadList: massmail flag off for a normal thread', folder.threads[2].massmail === false);

check('normalize: case, spaces and nbsp', core.normalize('  Boletín 1   X ') === 'boletín 1 x');

// ── Participation rules ──
const state = core.emptyState();
// Un envío masivo cuyo asunto no se creó con «Crear boletín» se ignora y no crea nada.
check('applyRecipients: an uncreated subject is ignored', core.applyRecipients(state, groupA, 900) === null && Object.keys(state.bulletins).length === 0);
core.createBulletin(state, SUBJECT, 1000);
check('applyRecipients: a created subject is completed', core.applyRecipients(state, groupA, 1000) === KEY && Object.keys(state.bulletins).length === 1);
const byName = (list) => Object.fromEntries(list.map((r) => [r.name, r]));

let rows = byName(core.rows(state, KEY));
check('state from the recipients view', rows.Alfa.effective === 'answered' && rows['Beta Dos'].effective === 'read' && rows.Gamma.effective === 'new');
check('labels', rows.Alfa.label === 'Respondido' && rows['Beta Dos'].label === 'Leído' && rows.Gamma.label === 'Sin leer');

// Second send with the same subject (the other group) merges into the same bulletin.
core.applyRecipients(state, core.parseRecipients(recipientsView(SUBJECT, [['Epsilon', 201, 'read'], ['Zeta', 202, 'new']])), 2000);
check('two sends with the same subject are one bulletin', Object.keys(state.bulletins).length === 1 && core.rows(state, KEY).length === 6);

// A thread in the folder validates the reply even though the recipient view says "read".
const added = core.applyThreads(state, folder, 3000);
rows = byName(core.rows(state, KEY));
check('applyThreads counts only new massmail threads', added === 3, 'added ' + added);
check('reply validated by the thread', rows['Beta Dos'].effective === 'answered' && rows['Beta Dos'].replied === true && rows['Beta Dos'].game === 'read');
check('a normal thread is not a reply', rows.Gamma.effective === 'new');
check('applyThreads is idempotent', core.applyThreads(state, folder, 4000) === 0);

// The game shows the last state of the thread: answered can go back to read. The best state is kept.
core.applyRecipients(state, core.parseRecipients(recipientsView(SUBJECT, [['Delta', 104, 'read']])), 5000);
rows = byName(core.rows(state, KEY));
check('best state seen survives a downgrade', rows.Delta.effective === 'answered' && rows.Delta.game === 'read');

// Manual state wins and is not overwritten by a new capture.
core.setManual(state, KEY, 103, 'answered');
core.applyRecipients(state, core.parseRecipients(recipientsView(SUBJECT, [['Gamma', 103, 'new']])), 6000);
rows = byName(core.rows(state, KEY));
check('manual state has priority over the game', rows.Gamma.effective === 'answered' && rows.Gamma.manual === 'answered');
core.setManual(state, KEY, 103, '');
check('clearing the manual state returns to the game state', byName(core.rows(state, KEY)).Gamma.effective === 'new');

// A member known from another bulletin who is not a recipient of this one: "No recibido".
const OTHER = 'Boletín 2';
core.createBulletin(state, OTHER, 7000);
core.applyRecipients(state, core.parseRecipients(recipientsView(OTHER, [['Alfa', 101, 'read'], ['Omega', 301, 'new']])), 7000);
rows = byName(core.rows(state, KEY));
check('member missing from the recipients is "No recibido"', rows.Omega && rows.Omega.effective === 'none' && rows.Omega.label === 'No recibido');
check('replies do not leak between bulletins', byName(core.rows(state, core.normalize(OTHER))).Alfa.effective === 'read');

const s = core.summary(core.rows(state, KEY));
check('summary', s.total === 7 && s.recipients === 6 && s.answered === 4 && s.read === 0 && s.new === 2 && s.none === 1, JSON.stringify(s));

// ── BBCode export: one row per member, one column per bulletin (oldest first) ──
const bb = core.exportBBCode(state).split('\n');
check('exportBBCode: table wrapper', bb[1] === '[table]' && bb.includes('[/table]'));
check('exportBBCode: header with one column per bulletin', bb[2] === '[*][b]Miembro[/b][|][b]B1[/b][|][b]B2[/b][|][b]Respondió[/b][/*]', bb[2]);
check('exportBBCode: member row with both bulletins', bb.includes('[*][player]Alfa[/player][|]✅[|]👁️[|]1/2[/*]'), bb[3]);
check('exportBBCode: member missing from a bulletin', bb.includes('[*][player]Omega[/player][|]➖[|]✉️[|]0/1[/*]'));
check('exportBBCode: one row per member, sorted by name', bb.filter((l) => l.startsWith('[*][player]')).length === 7 && bb[3].includes('Alfa'));
check('exportBBCode: legend of bulletins', bb.includes('B1: ' + SUBJECT) && bb.includes('B2: ' + OTHER));
check('exportBBCode: empty without bulletins', core.exportBBCode(core.emptyState()) === '');

core.removeBulletin(state, core.normalize(OTHER));
check('removeBulletin', !state.bulletins[core.normalize(OTHER)] && core.rows(state, core.normalize(OTHER)).length === 0);

const roundTrip = JSON.parse(JSON.stringify(state));
check('state survives a JSON round trip', JSON.stringify(core.rows(roundTrip, KEY)) === JSON.stringify(core.rows(state, KEY)));

// ── Datos públicos del mundo (/data/players.txt y alliances.txt) y próximo boletín ──
const playersTxt = '101,Alfa,1,500,10,3\n102,Beta+Dos,1,400,11,2\n201,Epsilon,2,300,12,1\n301,Fuera%2C+Uno,9,200,13,1\n302,Sin+alianza,,100,14,1\n';
const alliancesTxt = '1,UW+-+Error+Ol%C3%ADmpico,32140,19,16,2\n2,White+Tigers,21982,13,10,4\n9,Otra,1,1,1,3\n';
const dirState = core.emptyState();
const found = core.applyDirectory(dirState, [1, 2], playersTxt, alliancesTxt, 9000);
check('applyDirectory: members of the chosen alliances only', found === 3 && !dirState.directory.members[301] && !dirState.directory.members[302], String(found));
check('applyDirectory: names are URL-decoded', dirState.directory.members[102].name === 'Beta Dos' && dirState.directory.alliances[1] === 'UW - Error Olímpico');
check('decodeName: encoded comma', core.decodeName('Fuera%2C+Uno') === 'Fuera, Uno');

core.addPlayers(dirState, 'extra', 'Pevi Magno; bengatus\nPevi  Magno');
check('addPlayers: several names, no duplicates', Object.keys(dirState.extra).length === 2);
check('addPlayers: ignores an unknown bucket', core.addPlayers(dirState, 'otro', 'X') === 0);
core.addPlayers(dirState, 'enemies', 'Epsilon');
const list = core.recipientNames(dirState, 'alfa');
check('recipientNames: directory + extra, minus enemies and the sender', JSON.stringify(list) === JSON.stringify(['bengatus', 'Beta Dos', 'Pevi Magno']), JSON.stringify(list));
check('recipientNames: joined with ;', list.join(';') === 'bengatus;Beta Dos;Pevi Magno');
core.removePlayer(dirState, 'enemies', 'epsilon');
check('removePlayer: enemy is back in the list', core.recipientNames(dirState, 'alfa').includes('Epsilon'));

check('recipientNames: without directory it uses the captured members', core.recipientNames(state, '').includes('Alfa'));
check('roster includes the directory members', core.roster(dirState)[201] === 'Epsilon');
check('an old saved state gets the new fields', Object.assign(core.emptyState(), { v: 1, bulletins: {} }).next.subject === '');

// ── Historial de miembros: quien sale queda marcado y deja de recibir boletines ──
const histState = core.emptyState();
core.applyDirectory(histState, [1], '101,Alfa,1,5,1,1\n102,Beta+Dos,1,5,1,1\n', alliancesTxt, 1000);
core.createBulletin(histState, SUBJECT, 1500);
core.applyRecipients(histState, core.parseRecipients(recipientsView(SUBJECT, [['Alfa', 101, 'answered'], ['Beta Dos', 102, 'read']])), 1500);
// Beta Dos sale de la alianza y entra Nuevo (campaña ya enviada: Nuevo no la recibió).
core.applyDirectory(histState, [1], '101,Alfa,1,5,1,1\n401,Nuevo,1,5,1,1\n', alliancesTxt, 2000);
check('history: the member who left is kept and marked', histState.directory.members[102].left === 2000 && histState.directory.members[102].since === 1000);
check('history: a returning member is current again', (core.applyDirectory(histState, [1], '101,Alfa,1,5,1,1\n102,Beta+Dos,1,5,1,1\n401,Nuevo,1,5,1,1\n', alliancesTxt, 3000), histState.directory.members[102].left === null));
core.applyDirectory(histState, [1], '101,Alfa,1,5,1,1\n401,Nuevo,1,5,1,1\n', alliancesTxt, 4000);
check('history: who left stops receiving bulletins', JSON.stringify(core.recipientNames(histState, '')) === JSON.stringify(['Alfa', 'Nuevo']));
const histRows = byName(core.rows(histState, KEY));
check('history: who left keeps the state they had in the bulletin', histRows['Beta Dos'].left === true && histRows['Beta Dos'].effective === 'read');
check('pendingNames: current members who did not receive the bulletin', JSON.stringify(core.pendingNames(histState, KEY, '')) === JSON.stringify(['Nuevo']));
check('pendingNames: skips enemies and the sender', (core.addPlayers(histState, 'enemies', 'Nuevo'), core.pendingNames(histState, KEY, '').length === 0));
core.applyDirectory(histState, [1], '101,Alfa,1,5,1,1\n', alliancesTxt, 5000);
core.addPlayers(histState, 'enemies', 'zzz');
check('rows: a member who left without data is not listed', !byName(core.rows(histState, KEY)).Nuevo);

// ── Alianza por nombre ──
const byAlly = (q) => core.findAlliance(alliancesTxt, q);
check('findAlliance: exact name', byAlly('White Tigers').match && byAlly('White Tigers').match.id === 2);
check('findAlliance: ignores case and accents in the BBCode tag', byAlly('[ally]uw - error olímpico[/ally]').match.id === 1);
check('findAlliance: partial name with a single match', byAlly('tigers').match.id === 2);
check('findAlliance: several matches give no single match', byAlly('i').match === null && byAlly('i').matches.length > 1);
check('findAlliance: unknown name', byAlly('Inexistente').match === null && byAlly('Inexistente').matches.length === 0);

// ── Crear boletín antes de enviarlo ──
const created = core.emptyState();
core.applyDirectory(created, [1, 2], playersTxt, alliancesTxt, 100);
const createdKey = core.createBulletin(created, '  Boletín   2  ', 200);
check('createBulletin: key and cleaned subject', createdKey === 'boletín 2' && created.bulletins[createdKey].subject === 'Boletín 2');
check('createBulletin: empty subject is refused', core.createBulletin(created, '   ', 300) === null);
check('createBulletin: all current members are pending', JSON.stringify(core.pendingNames(created, createdKey, '')) === JSON.stringify(['Alfa', 'Beta Dos', 'Epsilon']));
core.createBulletin(created, 'boletín 2', 999);
check('createBulletin: an existing bulletin is not touched', created.bulletins[createdKey].firstSeen === 200);
core.applyRecipients(created, core.parseRecipients(recipientsView('Boletín 2', [['Alfa', 101, 'new'], ['Beta Dos', 102, 'new']])), 400);
check('the real send completes the created bulletin', JSON.stringify(core.pendingNames(created, createdKey, '')) === JSON.stringify(['Epsilon']) && created.bulletins[createdKey].firstSeen === 200);

// Copia de destinatarios: solo el último boletín creado, una sola vez, y sobrevive a guardar y recargar el estado.
const copyState = { bulletins: {}, enemies: {}, extra: {}, members: {}, allianceIds: [], next: {} };
const ka = core.createBulletin(copyState, 'Boletín A', 10);
const kb = core.createBulletin(copyState, 'Boletín B', 20);
check('copy: no boletín tiene copia antes de guardarla', !core.copyAvailable(copyState, ka) && !core.copyAvailable(copyState, kb) && core.latestCopyKey(copyState) === null);
core.setCopy(copyState, ka, ['Alfa', 'Beta'], 100);
core.setCopy(copyState, kb, ['Gamma'], 200);
check('copy: solo el último boletín creado puede copiar', core.latestCopyKey(copyState) === kb && core.copyAvailable(copyState, kb) && !core.copyAvailable(copyState, ka));
const reloaded = JSON.parse(JSON.stringify(copyState));
check('copy: sigue disponible tras guardar y recargar el estado', core.copyAvailable(reloaded, kb) && JSON.stringify(core.takeCopy(reloaded, kb)) === JSON.stringify(['Gamma']));
check('copy: tomar la lista no la desactiva todavía (se marca al copiar)', core.copyAvailable(reloaded, kb));
core.markCopyUsed(reloaded, kb);
check('copy: después de copiar se desactiva', !core.copyAvailable(reloaded, kb) && core.takeCopy(reloaded, kb) === null);
core.setCopy(reloaded, kb, ['Gamma', 'Delta'], 300);
check('copy: crear de nuevo el mismo boletín renueva la lista y la habilita', core.copyAvailable(reloaded, kb) && core.takeCopy(reloaded, kb).length === 2);
core.setCopy(reloaded, ka, ['Nuevo'], 400);
check('copy: un boletín creado después pasa a ser el único habilitado', core.copyAvailable(reloaded, ka) && !core.copyAvailable(reloaded, kb));
check('copy: boletín inexistente no se puede', core.setCopy(copyState, 'no existe', [], 1) === false);

console.log(failed ? '\nFAILED' : '\nALL PASS');
process.exit(failed ? 1 : 0);
