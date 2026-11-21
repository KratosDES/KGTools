// ==UserScript==
// @name         GrepoAlliance — Gestión de alianzas para Grepolis
// @namespace    grepo-alliance
// @version      0.1.1a
// @description  Seguimiento de miembros y participación de una alianza. Sin automatización.
// @author       KratosDES
// @icon         data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20viewBox%3D%270%200%2064%2064%27%3E%3Crect%20width%3D%2764%27%20height%3D%2764%27%20rx%3D%2714%27%20fill%3D%27%232b1d10%27%2F%3E%3Cpath%20d%3D%27M32%209L9%2024h46z%27%20fill%3D%27%23f0b429%27%2F%3E%3Crect%20x%3D%2714%27%20y%3D%2728%27%20width%3D%277%27%20height%3D%2718%27%20fill%3D%27%23f0b429%27%2F%3E%3Crect%20x%3D%2728.5%27%20y%3D%2728%27%20width%3D%277%27%20height%3D%2718%27%20fill%3D%27%23f0b429%27%2F%3E%3Crect%20x%3D%2743%27%20y%3D%2728%27%20width%3D%277%27%20height%3D%2718%27%20fill%3D%27%23f0b429%27%2F%3E%3Crect%20x%3D%279%27%20y%3D%2749%27%20width%3D%2746%27%20height%3D%276%27%20rx%3D%271.5%27%20fill%3D%27%23f0b429%27%2F%3E%3C%2Fsvg%3E
// @match        *://*.grepolis.com/game/*
// @exclude      *://forum.*.grepolis.com/*
// @exclude      *://wiki.*.grepolis.com/*
// @grant        unsafeWindow
// @run-at       document-end
// @noframes
// ==/UserScript==

/**
 * GrepoAlliance v0.1.1a — participación en boletines por captura pasiva.
 *
 * No envía ninguna petición al juego ni simula clics. Solo lee el HTML de las vistas del módulo
 * de mensajes cuando el jugador las abre:
 *   - Correo masivo → Destinatario: quién recibió, leyó o respondió un boletín.
 *   - Lista de mensajes (bandeja de entrada o carpeta Boletines): un hilo de correo masivo con el
 *     asunto del boletín prueba que su remitente respondió.
 *
 * Fuente de los selectores y reglas: docs/evidencia-mensajes.md y docs/participacion.md.
 * Persistencia: localStorage, key grepo_alliance_{mundo}_{jugador}. Los datos no salen del navegador.
 * Versionado: @version y GAL.VERSION deben estar siempre sincronizados.
 */
(function () {
  'use strict';

  const uw = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const GAL = {};
  GAL.VERSION = '0.1.1a';

  // ═══ MODULE: CORE ═══ (puro: sin DOM ni almacenamiento; lo ejercita test/core-harness.js)
  GAL.core = (function () {
    const RANK = { none: 0, new: 1, read: 2, answered: 3 };
    const LABEL = { answered: 'Respondido', read: 'Leído', new: 'Sin leer', none: 'No recibido' };

    function normalize(value) {
      return String(value == null ? '' : value)
        .normalize('NFC')
        .replace(/ /g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
    }

    function decodeEntities(text) {
      return String(text)
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&');
    }

    function textOf(html) {
      return decodeEntities(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
    }

    // El href de a.gp_player_link es "#" + base64 de un JSON {name, id}.
    function decodePlayerId(hash) {
      try {
        const id = Number(JSON.parse(atob(hash)).id);
        return Number.isFinite(id) && id > 0 ? id : null;
      } catch (e) {
        return null;
      }
    }

    const PLAYER_LINK = '<a href="#([^"]+)" class="gp_player_link">([^<]*)<\\/a>';

    // Vista "Destinatario" de un correo masivo. Devuelve null si el HTML no es esa vista.
    function parseRecipients(html) {
      const header = /<div class="game_header[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(html);
      const subject = header ? textOf(header[1]) : '';
      const rowRe = new RegExp('class="message_status (new|read|answered)"[^>]*>\\s*<\\/div>\\s*' + PLAYER_LINK, 'g');
      const recipients = [];
      let m;
      while ((m = rowRe.exec(html))) {
        const id = decodePlayerId(m[2]);
        if (id) recipients.push({ id, name: textOf(m[3]), state: m[1] });
      }
      return subject && recipients.length ? { subject, recipients } : null;
    }

    // Lista de hilos de una carpeta (bandeja de entrada, Boletines...).
    function parseThreadList(html) {
      const folder = /class="folder_toggle_link"[\s\S]*?class="folder_icon_text">([^<]*)</.exec(html);
      const folderInput = /<input[^>]*id="message_form_folder_id"[^>]*>/.exec(html);
      const folderValue = folderInput ? /value="(\d+)"/.exec(folderInput[0]) : null;
      const linkRe = new RegExp(PLAYER_LINK);
      const threads = [];
      html.split('<li class="message_item').slice(1).forEach((chunk) => {
        const id = /sendMessage\('messageView',\s*(\d+),\s*'view'\)/.exec(chunk);
        const subject = /<div class="message_subject"[^>]*>\s*<a [^>]*>([\s\S]*?)<\/a>/.exec(chunk);
        const sender = linkRe.exec(chunk);
        const senderId = sender ? decodePlayerId(sender[1]) : null;
        if (!id || !subject || !senderId) return;
        threads.push({
          id: Number(id[1]),
          subject: textOf(subject[1]),
          massmail: /class="massmail"/.test(chunk),
          senderId,
          senderName: textOf(sender[2]),
        });
      });
      return {
        folderName: folder ? textOf(folder[1]) : '',
        folderId: folderValue ? Number(folderValue[1]) : null,
        threads,
      };
    }

    function emptyState() {
      // enemies y extra: jugadores añadidos a mano (clave = nombre normalizado). next: boletín por enviar.
      // allianceIds y directory: miembros de las alianzas según los datos públicos del mundo (/data/*.txt).
      return { v: 1, bulletins: {}, replies: {}, manual: {}, enemies: {}, extra: {}, next: { subject: '' }, allianceIds: [], directory: null };
    }

    // Los volcados públicos de Grepolis (https://{mundo}.grepolis.com/data/) son CSV sin cabecera; los nombres
    // vienen en URL-encoding con + por espacio. players.txt: id,nombre,alianza,puntos,ranking,ciudades.
    // alliances.txt: id,nombre,puntos,ciudades,miembros,ranking.
    function decodeName(raw) {
      try { return decodeURIComponent(String(raw).replace(/\+/g, ' ')); } catch (e) { return String(raw); }
    }

    function parseDump(text) {
      return String(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => line.split(','));
    }

    // Busca una alianza por nombre en alliances.txt (acepta el BBCode [ally]Nombre[/ally]). Nombre exacto primero;
    // si no, el que lo contenga. match es null cuando no hay una única coincidencia; matches lista las candidatas.
    function findAlliance(alliancesText, query) {
      const q = normalize(String(query).replace(/\[\/?ally[^\]]*\]/gi, ''));
      if (!q) return { match: null, matches: [] };
      const all = parseDump(alliancesText).map((c) => ({ id: Number(c[0]), name: decodeName(c[1]) })).filter((a) => a.id);
      const exact = all.filter((a) => normalize(a.name) === q);
      const pool = exact.length ? exact : all.filter((a) => normalize(a.name).includes(q));
      return { match: pool.length === 1 ? pool[0] : null, matches: pool };
    }

    // Guarda en state.directory los jugadores de las alianzas indicadas. Devuelve cuántos miembros encontró.
    function applyDirectory(state, ids, playersText, alliancesText, now) {
      const wanted = {};
      ids.forEach((id) => { wanted[id] = true; });
      const alliances = {};
      parseDump(alliancesText).forEach((c) => { if (wanted[Number(c[0])]) alliances[Number(c[0])] = decodeName(c[1]); });
      const previous = state.directory ? state.directory.members : {};
      const members = {};
      let current = 0;
      parseDump(playersText).forEach((c) => {
        const aid = Number(c[2]);
        const id = Number(c[0]);
        if (!wanted[aid] || !id) return;
        members[id] = { name: decodeName(c[1]), aid, since: (previous[id] && previous[id].since) || now, left: null };
        current++;
      });
      // Historial: quien ya estaba y ya no aparece en estas alianzas se conserva marcado como «salió».
      Object.keys(previous).forEach((id) => {
        if (!members[id]) members[id] = Object.assign({}, previous[id], { left: previous[id].left || now });
      });
      state.allianceIds = ids.slice();
      state.directory = { at: now, ids: ids.slice(), alliances, members };
      return current;
    }

    // Añade jugadores a mano a state.enemies o state.extra. Acepta varios nombres separados por ; o saltos de línea.
    function addPlayers(state, bucket, text) {
      if (bucket !== 'enemies' && bucket !== 'extra') return 0;
      let added = 0;
      String(text).split(/[;\n]/).forEach((raw) => {
        const name = raw.replace(/\s+/g, ' ').trim();
        const key = normalize(name);
        if (!key || state[bucket][key]) return;
        state[bucket][key] = { name };
        added++;
      });
      return added;
    }

    function removePlayer(state, bucket, key) {
      if (bucket === 'enemies' || bucket === 'extra') delete state[bucket][key];
    }

    // Crea el registro de un boletín antes de enviarlo (sin destinatarios todavía). Si ya existe, no lo toca.
    // Cuando se capture su envío real, applyRecipients lo completa por el mismo asunto.
    function createBulletin(state, subject, now) {
      const clean = String(subject).replace(/\s+/g, ' ').trim();
      const key = normalize(clean);
      if (!key) return null;
      if (!state.bulletins[key]) state.bulletins[key] = { subject: clean, firstSeen: now, lastSeen: now, recipients: {} };
      return key;
    }

    // Guarda la lista de destinatarios con la que se creó el boletín, para poder copiarla después aunque se cierre la
    // ventana. Crear de nuevo el mismo boletín la renueva y vuelve a habilitar la copia.
    function setCopy(state, key, names, now) {
      const bulletin = state.bulletins[key];
      if (!bulletin) return false;
      bulletin.copy = { names: names.slice(), at: now, used: false };
      return true;
    }

    // Solo el último boletín creado puede copiar sus destinatarios.
    function latestCopyKey(state) {
      let best = null;
      Object.keys(state.bulletins).forEach((key) => {
        const copy = state.bulletins[key].copy;
        if (copy && (!best || copy.at > state.bulletins[best].copy.at)) best = key;
      });
      return best;
    }

    // La copia está disponible una sola vez: si es el último boletín y todavía no se usó.
    function copyAvailable(state, key) {
      const bulletin = state.bulletins[key];
      return !!(bulletin && bulletin.copy && !bulletin.copy.used && latestCopyKey(state) === key);
    }

    // Devuelve la lista guardada y desactiva la copia. null si no está disponible.
    function takeCopy(state, key) {
      if (!copyAvailable(state, key)) return null;
      return state.bulletins[key].copy.names.slice();
    }

    function markCopyUsed(state, key) {
      if (state.bulletins[key] && state.bulletins[key].copy) state.bulletins[key].copy.used = true;
    }

    // Un boletín es como una campaña: su lista de destinatarios cambia con el tiempo. «Pendientes» son los miembros
    // actuales que todavía no figuran como destinatarios de ese boletín (por ejemplo, los que entraron después).
    function pendingNames(state, key, selfName) {
      const self = normalize(selfName);
      const enemies = state.enemies;
      return rows(state, key)
        .filter((row) => row.effective === 'none' && !row.left && normalize(row.name) !== self && !enemies[normalize(row.name)])
        .map((row) => row.name)
        .sort((a, b) => a.localeCompare(b));
    }

    // Destinatarios del próximo boletín: miembros capturados + añadidos a mano, sin enemigos ni el propio remitente.
    function recipientNames(state, selfName) {
      const skip = {};
      skip[normalize(selfName)] = true;
      Object.keys(state.enemies).forEach((key) => { skip[key] = true; });
      const names = {};
      const add = (name) => {
        const key = normalize(name);
        if (key && !skip[key] && !names[key]) names[key] = name;
      };
      // Con los datos públicos de las alianzas, ellos son la fuente (así no entran los que ya salieron).
      let members = roster(state);
      if (state.directory) {
        members = {};
        Object.keys(state.directory.members).forEach((id) => {
          if (!state.directory.members[id].left) members[id] = state.directory.members[id].name;
        });
      }
      Object.keys(members).forEach((id) => add(members[id]));
      Object.keys(state.extra).forEach((key) => add(state.extra[key].name));
      return Object.keys(names).map((key) => names[key]).sort((a, b) => a.localeCompare(b));
    }

    // Guarda los destinatarios de un envío. Varios envíos con el mismo asunto forman un solo boletín.
    // Solo completa boletines ya registrados (creados con «Crear boletín» o guardados antes): un correo masivo
    // con otro asunto se ignora y devuelve null.
    function applyRecipients(state, parsed, now) {
      const key = normalize(parsed.subject);
      const bulletin = state.bulletins[key];
      if (!bulletin) return null;
      bulletin.lastSeen = now;
      parsed.recipients.forEach((r) => {
        const prev = bulletin.recipients[r.id];
        const best = prev && RANK[prev.best] > RANK[r.state] ? prev.best : r.state;
        bulletin.recipients[r.id] = { name: r.name, state: r.state, best };
      });
      return key;
    }

    // Registra como respuesta cada hilo de correo masivo. Devuelve cuántas respuestas son nuevas.
    function applyThreads(state, parsed, now) {
      let added = 0;
      parsed.threads.forEach((t) => {
        if (!t.massmail) return;
        const key = normalize(t.subject);
        const bucket = state.replies[key] || (state.replies[key] = {});
        if (!bucket[t.senderId]) {
          bucket[t.senderId] = { name: t.senderName, at: now };
          added++;
        }
      });
      return added;
    }

    function setManual(state, key, playerId, value) {
      const bucket = state.manual[key] || (state.manual[key] = {});
      if (value && LABEL[value]) bucket[playerId] = value;
      else delete bucket[playerId];
    }

    function removeBulletin(state, key) {
      delete state.bulletins[key];
      delete state.manual[key];
    }

    // Miembros conocidos: todo jugador que figure en algún boletín, como destinatario o por su respuesta.
    function roster(state) {
      const members = {};
      Object.keys(state.bulletins).forEach((key) => {
        const recipients = state.bulletins[key].recipients;
        Object.keys(recipients).forEach((id) => { members[id] = recipients[id].name; });
        const replies = state.replies[key] || {};
        Object.keys(replies).forEach((id) => { if (!members[id]) members[id] = replies[id].name; });
      });
      if (state.directory) {
        Object.keys(state.directory.members).forEach((id) => { members[id] = state.directory.members[id].name; });
      }
      return members;
    }

    // Una fila por miembro. Prioridad: manual > respuesta validada o vista > mejor estado visto > no recibido.
    function rows(state, key) {
      const bulletin = state.bulletins[key];
      if (!bulletin) return [];
      const replies = state.replies[key] || {};
      const manual = state.manual[key] || {};
      const members = roster(state);
      const listed = state.directory ? state.directory.members : {};
      return Object.keys(members).map((id) => {
        const recipient = bulletin.recipients[id] || null;
        const replied = !!replies[id];
        const auto = replied || (recipient && recipient.best === 'answered') ? 'answered' : recipient ? recipient.best : 'none';
        const effective = manual[id] || auto;
        return {
          id: Number(id),
          name: members[id],
          game: recipient ? recipient.state : null,
          replied,
          manual: manual[id] || null,
          effective,
          label: LABEL[effective],
          left: !!(listed[id] && listed[id].left),
        };
      }).filter((row) => !(row.left && row.effective === 'none')).sort((a, b) => RANK[b.effective] - RANK[a.effective] || a.name.localeCompare(b.name));
    }

    function summary(list) {
      const out = { total: list.length, recipients: 0, answered: 0, read: 0, new: 0, none: 0 };
      list.forEach((row) => {
        out[row.effective]++;
        if (row.effective !== 'none') out.recipients++;
      });
      return out;
    }

    const ICON = { answered: '✅', read: '👁️', new: '✉️', none: '➖' };

    // Tabla de control en BBCode de Grepolis: una fila por miembro y una columna por boletín (B1 es el
    // más antiguo). Las etiquetas van en inglés y las filas usan [*]celda[|]celda[/*].
    function exportBBCode(state) {
      const keys = Object.keys(state.bulletins).sort((a, b) => state.bulletins[a].firstSeen - state.bulletins[b].firstSeen);
      if (!keys.length) return '';
      const members = {};
      keys.forEach((key, column) => {
        rows(state, key).forEach((row) => {
          const member = members[row.id] || (members[row.id] = { name: row.name, cells: [] });
          member.cells[column] = row.effective;
        });
      });
      const lines = ['[b]Control de participación[/b]', '[table]'];
      lines.push('[*][b]Miembro[/b][|]' + keys.map((key, i) => '[b]B' + (i + 1) + '[/b]').join('[|]') + '[|][b]Respondió[/b][/*]');
      Object.keys(members).map((id) => members[id]).sort((a, b) => a.name.localeCompare(b.name)).forEach((member) => {
        const received = member.cells.filter((cell) => cell !== 'none').length;
        const answered = member.cells.filter((cell) => cell === 'answered').length;
        lines.push('[*][player]' + member.name + '[/player][|]' + member.cells.map((cell) => ICON[cell]).join('[|]')
          + '[|]' + answered + '/' + received + '[/*]');
      });
      lines.push('[/table]');
      lines.push(['answered', 'read', 'new', 'none'].map((s) => ICON[s] + ' ' + LABEL[s]).join(' · '));
      keys.forEach((key, i) => lines.push('B' + (i + 1) + ': ' + state.bulletins[key].subject));
      return lines.join('\n');
    }

    return {
      RANK, LABEL, normalize, textOf, decodePlayerId, parseRecipients, parseThreadList,
      emptyState, applyRecipients, applyThreads, setManual, removeBulletin, roster, rows, summary, exportBBCode,
      addPlayers, removePlayer, recipientNames, pendingNames, createBulletin, setCopy, latestCopyKey, copyAvailable, takeCopy, markCopyUsed, decodeName, applyDirectory, findAlliance,
    };
  })();

  // ═══ MODULE: STORAGE ═══
  GAL.storage = {
    _key() {
      const world = location.hostname.split('.')[0];
      const player = uw.Game.player_id;
      return 'grepo_alliance_' + world + '_' + player;
    },
    load() {
      try {
        const data = JSON.parse(localStorage.getItem(this._key()) || 'null');
        if (data && data.v === 1) return Object.assign(GAL.core.emptyState(), data);
      } catch (e) { /* datos ilegibles: se empieza de cero */ }
      return GAL.core.emptyState();
    },
    save(state) {
      try { localStorage.setItem(this._key(), JSON.stringify(state)); }
      catch (e) { console.warn('[GrepoAlliance] no se pudo guardar', e); }
    },
  };

  // ═══ MODULE: CAPTURE ═══ (lee lo que el jugador ya tiene en pantalla; no pide nada al juego)
  GAL.capture = {
    _last: { recipients: '', threads: '' },
    _timer: null,

    start() {
      new MutationObserver(() => {
        clearTimeout(this._timer);
        this._timer = setTimeout(() => this.scan(), 400);
      }).observe(document.body, { childList: true, subtree: true });
      this.scan();
    },

    scan() {
      const core = GAL.core;
      let changed = false;

      const recipientsEl = document.getElementById('message_message_list');
      const recipientsHtml = recipientsEl ? recipientsEl.outerHTML : '';
      if (recipientsHtml && recipientsHtml !== this._last.recipients) {
        const parsed = core.parseRecipients(recipientsHtml);
        if (parsed) {
          const key = core.applyRecipients(GAL.state, parsed, Date.now());
          if (key) {
            GAL.ui.selected = key;
            GAL.ui.notify(parsed.recipients.length + ' destinatarios capturados');
            changed = true;
          }
        }
      }
      this._last.recipients = recipientsHtml;

      const threadsEl = document.getElementById('folder_container');
      const threadsHtml = threadsEl ? threadsEl.outerHTML : '';
      if (threadsHtml && threadsHtml !== this._last.threads) {
        const added = core.applyThreads(GAL.state, core.parseThreadList(threadsHtml), Date.now());
        if (added) {
          GAL.ui.notify(added + ' respuestas nuevas registradas');
          changed = true;
        }
      }
      this._last.threads = threadsHtml;

      if (changed) {
        GAL.storage.save(GAL.state);
        GAL.ui.render();
      }
    },
  };

  // ═══ MODULE: UI ═══
  GAL.ui = {
    selected: null,
    _panel: null,
    _fab: null,
    _note: '',

    esc(text) {
      return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },

    init() {
      const style = document.createElement('style');
      style.textContent = `
        #gal_fab { position: fixed; left: 16px; bottom: 120px; z-index: 99999; width: 40px; height: 40px;
          border-radius: 50%; background: #2b1d10; border: 2px solid #f0b429; color: #f0b429; font-size: 20px;
          display: flex; align-items: center; justify-content: center; cursor: pointer; user-select: none; }
        /* Acoplado: dentro de #icons_container_left fluye como un icono más de la barra del juego,
           igual que el botón de grepo-alerts. */
        #gal_fab.gal_fab_docked { position: relative; left: auto; bottom: auto; margin: 4px auto 0; }
        #gal_fab.gal_flash { border-color: #6fd36f; }
        #gal_panel { position: fixed; left: 70px; bottom: 60px; z-index: 99999; width: 460px; max-height: 85vh; overflow-y: auto;
          display: none; flex-direction: column; background: #fff4d6; border: 2px solid #2b1d10; border-radius: 8px;
          color: #2b1d10; font: 12px/1.4 Verdana, Arial, sans-serif; box-shadow: 0 6px 24px rgba(0,0,0,.5); }
        #gal_panel.gal_open { display: flex; }
        #gal_panel .gal_head { display: flex; justify-content: space-between; align-items: center; padding: 8px 10px;
          background: #2b1d10; color: #f0b429; font-weight: bold; border-radius: 5px 5px 0 0;
          cursor: move; user-select: none; }
        #gal_panel .gal_close { cursor: pointer; padding: 0 4px; }
        #gal_panel .gal_bar { display: flex; gap: 6px; padding: 8px 10px; }
        #gal_panel .gal_bar select { flex: 1; min-width: 0; }
        #gal_detail { position: fixed; z-index: 100000; box-sizing: border-box; overflow: hidden; display: flex; flex-direction: column;
          background: #fff4d6; border-radius: 0 0 6px 6px; color: #2b1d10; font: 12px/1.4 Verdana, Arial, sans-serif;
          visibility: hidden; opacity: 0; transform: translateX(32px);
          transition: transform .18s ease, opacity .18s ease, visibility .18s; }
        #gal_detail.gal_open { visibility: visible; opacity: 1; transform: translateX(0); }
        #gal_detail .gal_head { display: flex; justify-content: space-between; align-items: center; padding: 8px 10px;
          background: #2b1d10; color: #f0b429; font-weight: bold; gap: 8px; }
        #gal_detail .gal_close { cursor: pointer; padding: 0 4px; }
        #gal_detail .gal_bar { display: flex; gap: 6px; padding: 8px 10px; }
        #gal_detail .gal_summary { padding: 0 10px 8px; }
        #gal_detail .gal_body { overflow-y: auto; padding: 0 10px 8px; flex: 1 1 auto; }
        #gal_detail table { width: 100%; border-collapse: collapse; }
        #gal_detail th, #gal_detail td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #d9c48f; }
        #gal_detail .gal_answered { color: #1d6b1d; font-weight: bold; }
        #gal_detail .gal_read { color: #8a5a00; }
        #gal_detail .gal_new { color: #a02020; }
        #gal_detail .gal_none { color: #777; }
        #gal_detail .gal_hint { font-size: 10px; color: #6b5a3a; }
        #gal_panel .gal_grid { padding: 8px 10px 0; flex: 0 0 auto; }
        #gal_panel .gal_grid table { table-layout: fixed; }
        #gal_panel .gal_grid th, #gal_panel .gal_grid td { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; height: 26px; box-sizing: border-box; }
        #gal_panel .gal_pager { display: flex; justify-content: center; align-items: center; gap: 10px; padding: 4px 10px 0; }
        #gal_panel .gal_row td[data-act="pick"] { cursor: pointer; }
        #gal_panel .gal_sel { background: #ecd9a0; }
        #gal_panel .gal_icon { padding: 0 4px; cursor: pointer; }
        #gal_panel .gal_icon:disabled { opacity: .35; cursor: not-allowed; }
        #gal_panel .gal_summary { padding: 0 10px 8px; }
        #gal_panel .gal_body { overflow-y: auto; padding: 0 10px; max-height: 30vh; flex: 0 1 auto; }
        #gal_panel table { width: 100%; border-collapse: collapse; }
        #gal_panel th, #gal_panel td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #d9c48f; }
        #gal_panel .gal_answered { color: #1d6b1d; font-weight: bold; }
        #gal_panel .gal_read { color: #8a5a00; }
        #gal_panel .gal_new { color: #a02020; }
        #gal_panel .gal_none { color: #777; }
        #gal_panel .gal_hint { font-size: 10px; color: #6b5a3a; }
        #gal_panel .gal_next { padding: 6px 10px 8px; border-top: 1px solid #d9c48f; flex: 0 0 auto; }
        #gal_panel .gal_next .gal_bar { padding: 4px 0; }
        #gal_panel .gal_next input { flex: 1; min-width: 0; }
        #gal_panel .gal_chip { display: inline-block; margin: 0 4px 2px 0; padding: 0 4px; background: #ecd9a0; border-radius: 3px; }
        #gal_panel .gal_chip [data-act="rm"] { cursor: pointer; color: #a02020; }
        #gal_panel .gal_foot { padding: 8px 10px; font-size: 11px; color: #6b5a3a; }
      `;
      document.head.appendChild(style);

      const fab = document.createElement('div');
      fab.id = 'gal_fab';
      fab.title = 'GrepoAlliance';
      fab.textContent = '🏛️';
      fab.onclick = () => this.toggle();
      this._fab = fab;
      this._dockFab();

      const panel = document.createElement('div');
      panel.id = 'gal_panel';
      panel.addEventListener('click', (e) => this._onClick(e));
      panel.addEventListener('change', (e) => this._onChange(e));
      panel.addEventListener('mousedown', (e) => this._onDragStart(e));
      document.body.appendChild(panel);
      this._panel = panel;
      const detail = document.createElement('div');
      detail.id = 'gal_detail';
      detail.addEventListener('click', (e) => this._onClick(e));
      detail.addEventListener('change', (e) => this._onChange(e));
      document.body.appendChild(detail);
      this._detail = detail;
      try { this._placePanel(JSON.parse(localStorage.getItem(this.POS_KEY) || 'null')); }
      catch (e) { /* posición guardada ilegible: se usa la inicial */ }
    },

    POS_KEY: 'grepo_alliance_panel_pos',

    // Coloca la ventana en {left, top}, sin dejar que la cabecera salga de la pantalla.
    _placePanel(pos) {
      if (!pos || !Number.isFinite(pos.left) || !Number.isFinite(pos.top)) return null;
      const left = Math.max(0, Math.min(pos.left, window.innerWidth - 80));
      const top = Math.max(0, Math.min(pos.top, window.innerHeight - 40));
      this._panel.style.left = left + 'px';
      this._panel.style.top = top + 'px';
      this._panel.style.bottom = 'auto';
      return { left, top };
    },

    // Arrastre de la ventana desde su cabecera. La posición se recuerda entre sesiones.
    _onDragStart(e) {
      if (e.button !== 0 || !e.target.closest('.gal_head') || e.target.closest('.gal_close')) return;
      e.preventDefault();
      const box = this._panel.getBoundingClientRect();
      const dx = e.clientX - box.left;
      const dy = e.clientY - box.top;
      let last = null;
      const move = (ev) => { last = this._placePanel({ left: ev.clientX - dx, top: ev.clientY - dy }); this._placeDetail(); };
      const stop = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', stop);
        if (!last) return;
        try { localStorage.setItem(this.POS_KEY, JSON.stringify(last)); } catch (err) { /* sin espacio: no se recuerda */ }
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', stop);
    },

    // Misma lógica que grepo-alerts: el botón va como último icono de #icons_container_left (la columna
    // de iconos bajo las misiones). Si el contenedor aún no existe, queda flotante y se reubica cuando aparezca.
    _dockFab() {
      const fab = this._fab;
      const host = document.getElementById('icons_container_left');
      if (host) {
        if (fab.parentNode !== host) host.appendChild(fab);
        fab.classList.add('gal_fab_docked');
        if (this._fabObserver) this._fabObserver.disconnect();
        this._fabObserver = null;
        return;
      }
      if (!fab.parentNode) document.body.appendChild(fab);
      if (!this._fabObserver) {
        this._fabObserver = new MutationObserver(() => this._dockFab());
        this._fabObserver.observe(document.body, { childList: true, subtree: true });
      }
    },

    toggle() {
      this._panel.classList.toggle('gal_open');
      this.render();
      this._renderDetail();
    },

    notify(text) {
      this._note = text;
      console.info('[GrepoAlliance] ' + text);
      if (!this._fab) return;
      this._fab.classList.add('gal_flash');
      setTimeout(() => this._fab.classList.remove('gal_flash'), 2000);
    },

    render() {
      if (!this._panel || !this._panel.classList.contains('gal_open')) return;
      const core = GAL.core;
      const keys = Object.keys(GAL.state.bulletins).sort((a, b) => GAL.state.bulletins[b].firstSeen - GAL.state.bulletins[a].firstSeen);
      if (!keys.includes(this.selected)) { this.selected = null; this._detailOpen = false; }

      let html = '<div class="gal_head"><span>GrepoAlliance v' + GAL.VERSION + (this._config ? ' — Configuración' : ' — Boletines') + '</span>'
        + '<span><span class="gal_close" data-act="config" title="Configuración">' + (this._config ? '◀ Volver' : '⚙') + '</span>'
        + ' <span class="gal_close" data-act="close">✕</span></span></div>';

      if (this._config) {
        this._panel.innerHTML = html + this._configHtml();
        this._renderDetail();
        return;
      }

      if (!keys.length) {
        html += '<div class="gal_foot">Todavía no hay boletines. Abre Mensajes → Correo masivo y pulsa '
          + '«Destinatario» en un envío para capturarlo.</div>' + this._nextHtml();
        this._panel.innerHTML = html;
        this._renderDetail();
        return;
      }

      html += this._gridHtml(keys);
      html += '<div class="gal_bar"><button data-act="bbcode" title="Copia la tabla de control de todos los boletines">BBCode</button></div>';
      html += '<div class="gal_foot">' + (this._note ? this.esc(this._note) + '. ' : '')
        + 'Toca un boletín para ver su detalle. Para actualizar, abre «Destinatario» del envío y la carpeta Boletines.</div>' + this._nextHtml();
      this._panel.innerHTML = html;
      this._renderDetail();
    },

    // Detalle del boletín: se desliza sobre la ventana principal al elegir un fila. Se recoge al tocar de nuevo la fila,
    // con ✕, al cerrar la ventana principal o al borrar el boletín.
    _renderDetail() {
      const box = this._detail;
      if (!box) return;
      const open = this._detailOpen && !this._config && this._panel.classList.contains('gal_open')
        && this.selected && GAL.state.bulletins[this.selected];
      if (!open) { box.classList.remove('gal_open'); return; }
      const core = GAL.core;
      const list = core.rows(GAL.state, this.selected);
      const s = core.summary(list);
      let html = '<div class="gal_head"><span>' + this.esc(GAL.state.bulletins[this.selected].subject) + '</span>'
        + '<span class="gal_close" data-act="closedetail" title="Cerrar el detalle">✕</span></div>';
      html += '<div class="gal_bar"><button data-act="copypending" title="Miembros actuales que aún no recibieron este boletín">Sin recibir ('
        + core.pendingNames(GAL.state, this.selected, this._selfName()).length + ')</button>'
        + '<button data-act="remove">Borrar</button></div>';
      html += '<div class="gal_summary">Destinatarios: <b>' + s.recipients + '</b> · Respondido: <b>' + s.answered
        + '</b> · Leído: <b>' + s.read + '</b> · Sin leer: <b>' + s.new + '</b> · No recibido: <b>' + s.none + '</b></div>';
      html += '<div class="gal_body"><table><tr><th>Miembro</th><th>Estado</th><th>Manual</th></tr>'
        + list.map((row) => {
          let hint = '';
          if (row.manual) hint = 'manual';
          else if (row.replied && row.game !== 'answered') hint = 'validado por su respuesta';
          else if (row.effective === 'answered' && row.game !== 'answered') hint = 'respondió antes';
          const options = [['', 'Auto']].concat(['answered', 'read', 'new', 'none'].map((v) => [v, core.LABEL[v]]))
            .map(([v, label]) => '<option value="' + v + '"' + ((row.manual || '') === v ? ' selected' : '') + '>' + label + '</option>').join('');
          return '<tr><td>' + this.esc(row.name) + '</td><td class="gal_' + row.effective + '">' + row.label
            + (hint ? ' <span class="gal_hint">(' + hint + ')</span>' : '') + '</td>'
            + '<td><select data-act="manual" data-id="' + row.id + '">' + options + '</select></td></tr>';
        }).join('')
        + '</table></div>';
      box.innerHTML = html;
      this._placeDetail();
      box.classList.add('gal_open');
    },

    // El detalle cubre el cuerpo de la ventana principal (debajo de su cabecera), así no ocupa más ancho.
    _placeDetail() {
      const box = this._detail;
      if (!box) return;
      const p = this._panel.getBoundingClientRect();
      const head = this._panel.querySelector('.gal_head');
      const hh = head ? head.offsetHeight : 34;
      box.style.left = (p.left + 2) + 'px';
      box.style.top = (p.top + 2 + hh) + 'px';
      box.style.width = (p.width - 4) + 'px';
      box.style.height = Math.max(p.height - 4 - hh, 0) + 'px';
    },

    PAGE_SIZE: 5,

    // Registro de boletines, de tamaño fijo y paginado. Solo el último creado tiene activo el botón 📄, y solo una vez:
    // copia los destinatarios guardados al crearlo, aunque se haya cerrado y vuelto a abrir la ventana.
    _gridHtml(keys) {
      const state = GAL.state;
      const pages = Math.max(1, Math.ceil(keys.length / this.PAGE_SIZE));
      this._page = Math.max(0, Math.min(this._page || 0, pages - 1));
      const shown = keys.slice(this._page * this.PAGE_SIZE, (this._page + 1) * this.PAGE_SIZE);
      const two = (n) => (n < 10 ? '0' : '') + n;
      const rowsHtml = shown.map((k) => {
        const b = state.bulletins[k];
        const captured = Object.keys(b.recipients).length;
        const can = GAL.core.copyAvailable(state, k);
        let why = 'Copiar destinatarios (una sola vez)';
        if (!b.copy) why = 'Este boletín se creó antes de guardar la lista de destinatarios';
        else if (b.copy.used) why = 'Los destinatarios ya se copiaron';
        else if (!can) why = 'Solo el último boletín creado puede copiar sus destinatarios';
        const d = new Date(b.firstSeen);
        const key = this.esc(k);
        return '<tr class="gal_row' + (k === this.selected ? ' gal_sel' : '') + '">'
          + '<td data-act="pick" data-key="' + key + '" title="' + this.esc(b.subject) + '">' + this.esc(b.subject) + '</td>'
          + '<td data-act="pick" data-key="' + key + '">' + two(d.getDate()) + '/' + two(d.getMonth() + 1) + '</td>'
          + '<td data-act="pick" data-key="' + key + '">' + (captured || '—') + '</td>'
          + '<td><button class="gal_icon" data-act="copydest" data-key="' + key + '" title="' + this.esc(why) + '"'
          + (can ? '' : ' disabled') + '>📄</button></td></tr>';
      });
      while (rowsHtml.length < this.PAGE_SIZE) rowsHtml.push('<tr class="gal_empty"><td colspan="4">&nbsp;</td></tr>');
      return '<div class="gal_grid"><table><colgroup><col><col style="width:44px"><col style="width:38px"><col style="width:34px"></colgroup>'
        + '<tr><th>Boletín</th><th>Fecha</th><th>Dest.</th><th></th></tr>' + rowsHtml.join('') + '</table></div>'
        + '<div class="gal_pager"><button data-act="pageprev"' + (this._page > 0 ? '' : ' disabled') + '>◀</button>'
        + '<span>' + (this._page + 1) + ' / ' + pages + '</span>'
        + '<button data-act="pagenext"' + (this._page < pages - 1 ? '' : ' disabled') + '>▶</button></div>';
    },

    _selfName() {
      return (uw.Game && uw.Game.player_name) || '';
    },

    // Bloque «Próximo boletín»: asunto y lista de destinatarios separada por ;
    _nextHtml() {
      const state = GAL.state;
      const names = GAL.core.recipientNames(state, this._selfName());
      return '<div class="gal_next"><b>Próximo boletín</b>'
        + '<div class="gal_bar"><input data-act="subject" placeholder="Asunto del boletín" value="' + this.esc(state.next.subject) + '">'
        + '<button data-act="createbulletin" title="Actualiza los miembros, crea el boletín y guarda la lista de destinatarios (' + names.length + ') para copiarla con 📄">Crear boletín</button></div>'
        + (this._list ? '<div class="gal_hint">Destinatarios guardados (cópialos con 📄 del registro, o haz clic aquí y Ctrl+C):</div>'
          + '<textarea data-act="list" readonly rows="3" style="width:100%;box-sizing:border-box">' + this.esc(this._list) + '</textarea>' : '')
        + (state.directory ? '' : '<div class="gal_hint">Sin alianzas: pulsa ⚙ y agrega el ID de tus alianzas.</div>') + '</div>';
    },

    // Configuración: alianzas por ID (traen su lista de miembros de los datos públicos del juego) y enemigos.
    _configHtml() {
      const state = GAL.state;
      const dir = state.directory;
      const chip = (label, bucket, key) => '<span class="gal_chip">' + label
        + ' <span data-act="rm" data-bucket="' + bucket + '" data-key="' + this.esc(key) + '" title="Quitar">✕</span></span>';
      const alliances = state.allianceIds.map((id) => {
        const members = dir ? Object.keys(dir.members).filter((m) => dir.members[m].aid === id) : [];
        const current = members.filter((m) => !dir.members[m].left).length;
        const name = dir && dir.alliances[id] ? this.esc(dir.alliances[id]) + ' · ' : '';
        return chip(name + 'ID ' + id + (dir ? ' · ' + current + ' miembros' : ''), 'alliance', String(id));
      }).join('') || '—';
      const left = dir ? Object.keys(dir.members).filter((m) => dir.members[m].left).map((m) => this.esc(dir.members[m].name)) : [];
      return '<div class="gal_next"><b>Alianzas</b>'
        + '<div class="gal_bar"><input data-act="aid" placeholder="ID o nombre de la alianza"><button data-act="addalliance">Agregar</button>'
        + '<button data-act="refresh" title="Descarga los datos públicos de Grepolis (players.txt y alliances.txt)">Actualizar</button></div>'
        + '<div class="gal_hint">' + alliances + '</div>'
        + '<div class="gal_hint">' + (dir ? 'Actualizado ' + new Date(dir.at).toLocaleString() + '. ' : 'Sin datos todavía. ')
        + 'Si alguien sale de la alianza, queda en el historial como «salió» y deja de recibir los boletines.</div>'
        + (left.length ? '<div class="gal_hint">Salieron: ' + left.join(', ') + '</div>' : '')
        + '</div><div class="gal_next"><b>Enemigos</b> <span class="gal_hint">(se excluyen de los destinatarios)</span>'
        + '<div class="gal_bar"><input data-act="enemy" placeholder="Nombre del enemigo"><button data-act="addenemy">Agregar</button></div>'
        + '<div class="gal_hint">' + (Object.keys(state.enemies).map((k) => chip(this.esc(state.enemies[k].name), 'enemies', k)).join('') || '—') + '</div></div>'
        + '<div class="gal_foot">' + (this._note ? this.esc(this._note) : '') + '</div>';
    },

    _onClick(e) {
      const act = e.target.getAttribute('data-act');
      if (act === 'close') this.toggle();
      if (act === 'bbcode') this._copy(GAL.core.exportBBCode(GAL.state), 'Tabla BBCode');
      if (act === 'createbulletin') {
        const input = this._panel.querySelector('input[data-act="subject"]');
        const subject = input ? input.value : '';
        if (!subject.trim()) { this._note = 'Escribe el asunto del boletín'; this.render(); return; }
        if (this._creating) return;
        this._creating = true;
        // Antes de armar la lista se actualizan los miembros de las alianzas, para no dejar fuera a un recién
        // llegado ni incluir a quien ya salió. Si la descarga falla, se usa la última lista guardada y se avisa.
        this._note = 'Actualizando miembros…';
        this.render();
        this._fetchDirectory(60000, 'Miembros al día').then((result) => {
          this._creating = false;
          const key = GAL.core.createBulletin(GAL.state, subject, Date.now());
          if (!key) { this._note = 'Escribe el asunto del boletín'; this.render(); return; }
          GAL.state.next.subject = '';
          GAL.storage.save(GAL.state);
          this._page = 0;
          const names = GAL.core.pendingNames(GAL.state, key, this._selfName());
          this._list = names.join(';');
          GAL.core.setCopy(GAL.state, key, names, Date.now());
          GAL.storage.save(GAL.state);
          this._note = 'Boletín creado (' + result + '). ' + names.length + ' destinatarios guardados: copia con 📄';
          this.render();
        });
      }
      if (act === 'pick') {
        const key = e.target.getAttribute('data-key');
        if (this.selected === key && this._detailOpen) { this.selected = null; this._detailOpen = false; }
        else { this.selected = key; this._detailOpen = true; }
        this.render();
      }
      if (act === 'closedetail') { this.selected = null; this._detailOpen = false; this.render(); }
      if (act === 'pageprev') { this._page = (this._page || 0) - 1; this.render(); }
      if (act === 'pagenext') { this._page = (this._page || 0) + 1; this.render(); }
      if (act === 'copydest') {
        const key = e.target.getAttribute('data-key');
        const names = GAL.core.takeCopy(GAL.state, key);
        if (!names) { this._note = 'Este boletín ya no puede copiar sus destinatarios'; this.render(); return; }
        // La copia se da por usada solo si el portapapeles la aceptó.
        this._copy(names.join(';'), 'Destinatarios (' + names.length + ')', () => {
          GAL.core.markCopyUsed(GAL.state, key);
          GAL.storage.save(GAL.state);
        });
      }
      if (act === 'list') e.target.select();
      if (act === 'copypending') {
        const pending = this.selected ? GAL.core.pendingNames(GAL.state, this.selected, this._selfName()) : [];
        this._list = pending.join(';');
        this._copy(this._list, 'Lista de pendientes');
      }
      if (act === 'config') { this._config = !this._config; this.render(); }
      if (act === 'refresh') this._refreshDirectory();
      if (act === 'addalliance') {
        const input = this._panel.querySelector('input[data-act="aid"]');
        const text = String(input.value).trim();
        if (!text) return;
        if (/^\d+$/.test(text)) { this._addAlliance(Number(text)); return; }
        // Un nombre: se busca en alliances.txt y se usa su ID.
        fetch(location.origin + '/data/alliances.txt')
          .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
          .then((txt) => {
            const found = GAL.core.findAlliance(txt, text);
            if (found.match) { this._addAlliance(found.match.id); return; }
            this._note = found.matches.length
              ? 'Varias coinciden: ' + found.matches.slice(0, 6).map((a) => a.name + ' (ID ' + a.id + ')').join(', ') + '. Escribe el nombre completo o el ID'
              : 'No se encontró ninguna alianza llamada «' + text + '»';
            this.render();
          })
          .catch((err) => { this._note = 'No se pudo consultar las alianzas (' + err.message + ')'; this.render(); });
      }
      if (act === 'addenemy') {
        const input = this._panel.querySelector('input[data-act="enemy"]');
        if (GAL.core.addPlayers(GAL.state, 'enemies', input.value)) {
          GAL.storage.save(GAL.state);
          this.render();
        }
      }
      if (act === 'rm') {
        const bucket = e.target.getAttribute('data-bucket');
        const key = e.target.getAttribute('data-key');
        if (bucket === 'alliance') GAL.state.allianceIds = GAL.state.allianceIds.filter((id) => String(id) !== key);
        else GAL.core.removePlayer(GAL.state, bucket, key);
        GAL.storage.save(GAL.state);
        this.render();
      }
      if (act === 'remove' && this.selected) {
        const subject = GAL.state.bulletins[this.selected].subject;
        if (!confirm('¿Borrar el boletín «' + subject + '» de GrepoAlliance? No borra nada en el juego.')) return;
        GAL.core.removeBulletin(GAL.state, this.selected);
        GAL.storage.save(GAL.state);
        this.selected = null;
        this._detailOpen = false;
        this.render();
      }
    },

    _addAlliance(id) {
      if (!GAL.state.allianceIds.includes(id)) GAL.state.allianceIds.push(id);
      GAL.storage.save(GAL.state);
      this._refreshDirectory();
    },

    // Descarga los volcados públicos del mundo (los mismos que usan los sitios de estadísticas). No son peticiones
    // del juego ni llevan sesión; se pide como máximo una vez cada 10 minutos porque el servidor los renueva cada hora.
    _refreshDirectory() {
      this._fetchDirectory(600000, 'Los datos tienen menos de 10 minutos').then((text) => { this._note = text; this.render(); });
    },

    // Devuelve una promesa con el texto del resultado; nunca se rechaza. Si los datos guardados tienen menos de
    // maxAge milisegundos no vuelve a descargar y devuelve tooFresh.
    _fetchDirectory(maxAge, tooFresh) {
      const state = GAL.state;
      const ids = state.allianceIds.slice();
      if (!ids.length) return Promise.resolve('Agrega primero el ID de una alianza');
      const sameIds = state.directory && state.directory.ids && state.directory.ids.slice().sort().join() === ids.slice().sort().join();
      if (sameIds && Date.now() - state.directory.at < maxAge) return Promise.resolve(tooFresh);
      const base = location.origin + '/data/';
      return Promise.all([fetch(base + 'players.txt'), fetch(base + 'alliances.txt')])
        .then((rs) => {
          if (!rs.every((r) => r.ok)) throw new Error('HTTP ' + rs.map((r) => r.status).join('/'));
          return Promise.all(rs.map((r) => r.text()));
        })
        .then((texts) => {
          const count = GAL.core.applyDirectory(state, ids, texts[0], texts[1], Date.now());
          GAL.storage.save(state);
          return count + ' miembros cargados';
        })
        .catch((err) => 'No se pudieron descargar los datos de las alianzas (' + err.message + ')');
    },

    // Copia al portapapeles. Si el navegador lo impide, muestra el texto para copiarlo a mano.
    _copy(text, label, onCopied) {
      const done = () => { if (onCopied) onCopied(); this._note = label + ' copiado al portapapeles'; this.render(); };
      const manual = () => prompt('No se pudo copiar automáticamente. Copia el texto:', text);
      try {
        navigator.clipboard.writeText(text).then(done, manual);
      } catch (e) {
        manual();
      }
    },

    _onChange(e) {
      const act = e.target.getAttribute('data-act');
      if (act === 'bulletin') {
        this.selected = e.target.value;
        this.render();
      }
      if (act === 'subject') {
        GAL.state.next.subject = e.target.value.trim();
        GAL.storage.save(GAL.state);
      }
      if (act === 'manual') {
        GAL.core.setManual(GAL.state, this.selected, Number(e.target.getAttribute('data-id')), e.target.value);
        GAL.storage.save(GAL.state);
        this.render();
      }
    },
  };

  // ═══ BOOTSTRAP ═══
  // Los datos se guardan por jugador. Se espera a que el juego exponga Game.player_id antes de cargar:
  // cargar con una clave y guardar con otra perdería lo capturado.
  (function boot(attempt) {
    if (!(uw.Game && uw.Game.player_id)) {
      if (attempt < 150) setTimeout(() => boot(attempt + 1), 200);
      else console.warn('[GrepoAlliance] el juego no expuso Game.player_id; no se inicia.');
      return;
    }
    GAL.state = GAL.storage.load();
    GAL.ui.init();
    GAL.capture.start();
    console.info('[GrepoAlliance] v' + GAL.VERSION + ' cargado.');
  })(0);
})();
