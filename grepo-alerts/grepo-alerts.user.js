// ==UserScript==
// @name         GrepoAlerts — Rastreador de Movimientos
// @namespace    grepo-alerts
// @version      0.1.9
// @description  Rastrea movimientos del juego y notifica cuando terminan. Sin automatización.
// @author       KratosDES
// @match        *://*.grepolis.com/game/*
// @exclude      *://forum.*.grepolis.com/*
// @exclude      *://wiki.*.grepolis.com/*
// @grant        unsafeWindow
// @run-at       document-end
// @noframes
// ==/UserScript==

/**
 * GrepoAlerts v0.1.0
 *
 * Arquitectura modular en IIFE (single-file para TamperMonkey).
 * Módulos internos: Utils → EventBus → Storage → GameAccess →
 *                   Parser → Tracker → Notifications → UI → Bootstrap
 *
 * Estrategia de acceso al juego:
 *   1. uw.MM.getCollectionType('Commands') — modelos Backbone del juego (timestamps exactos)
 *   2. DOM fallback — parsea [data-end-at] o texto HH:MM:SS cuando el modelo no está
 *
 * Persistencia: localStorage con key grepo_alerts_{world}_{player}
 * Timer recovery: al recargar, restaura setTimeout desde timestamps guardados
 */

;(function (win) {
  'use strict';

  // ════════════════════════════════════════════════════════════════
  // NAMESPACE
  // ════════════════════════════════════════════════════════════════
  const GA = win.GrepoAlerts = {};

  // ════════════════════════════════════════════════════════════════
  // CONFIG
  // ════════════════════════════════════════════════════════════════
  GA.VERSION        = '0.1.9';
  GA.STORAGE_PREFIX = 'grepo_alerts';
  GA.POLL_INTERVAL  = 500;    // ms — intervalo de polling para init
  GA.MAX_RETRIES    = 60;     // 30 segundos máximo de espera
  GA.MAX_HISTORY    = 100;    // alertas máximas en storage
  GA.STALE_HOURS    = 24;     // horas hasta que una alerta expira
  GA.DEBUG          = false;

  const log  = (...a) => GA.DEBUG && console.log('%c[GrepoAlerts]', 'color:#c8a96e', ...a);
  const warn = (...a) => console.warn('[GrepoAlerts]', ...a);

  // ════════════════════════════════════════════════════════════════
  // MODULE: Utils
  // ════════════════════════════════════════════════════════════════
  GA.utils = {

    /**
     * Extrae un timestamp Unix (ms) de un elemento timer del DOM.
     * Soporta: [data-end-at], [data-time-until], texto HH:MM:SS, MM:SS.
     */
    parseTimer(el) {
      if (!el) return null;

      // Atributos de timestamp absoluto (segundos Unix → ms)
      const raw = el.getAttribute('data-end-at')
               || el.getAttribute('data-time-until')
               || el.getAttribute('data-countdown')
               || el.getAttribute('data-time');
      if (raw) {
        const n = parseInt(raw, 10);
        // Si el número tiene < 13 dígitos, probablemente es Unix segundos
        return n < 9999999999 ? n * 1000 : n;
      }

      // Fallback: parsear texto HH:MM:SS o MM:SS → tiempo relativo desde ahora
      const text = el.textContent.trim();
      const hms  = text.match(/^(\d+):(\d{2}):(\d{2})$/);
      const ms   = text.match(/^(\d+):(\d{2})$/);
      if (hms) {
        const secs = (+hms[1]) * 3600 + (+hms[2]) * 60 + (+hms[3]);
        return Date.now() + secs * 1000;
      }
      if (ms) {
        const secs = (+ms[1]) * 60 + (+ms[2]);
        return Date.now() + secs * 1000;
      }
      return null;
    },

    /** Formatea ms restantes en "2h 15m", "45m 3s", "12s" */
    formatRelative(tsMs) {
      const diff = tsMs - Date.now();
      if (diff <= 0) return 'Ahora';
      const s = Math.floor(diff / 1000);
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = s % 60;
      if (h > 0)   return `${h}h ${m}m`;
      if (m > 0)   return `${m}m ${sec}s`;
      return `${sec}s`;
    },

    /** Formatea timestamp como "HH:MM" usando la timezone del servidor del juego */
    formatTime(tsMs) {
      try {
        const tz = (win.uw || win).Game?.player_timezone;
        return new Intl.DateTimeFormat([], {
          timeZone: tz,
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        }).format(new Date(tsMs));
      } catch {
        return new Date(tsMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
    },

    /** ID único corto */
    uid() {
      return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    },

    /** Escapa HTML básico */
    esc(str) {
      return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }
  };

  // ════════════════════════════════════════════════════════════════
  // MODULE: EventBus
  // pub/sub desacoplado para comunicación entre módulos
  // ════════════════════════════════════════════════════════════════
  GA.events = {
    _h: {},

    on(event, fn)  { (this._h[event] = this._h[event] || []).push(fn); },
    off(event, fn) { if (this._h[event]) this._h[event] = this._h[event].filter(h => h !== fn); },

    emit(event, ...args) {
      (this._h[event] || []).forEach(fn => {
        try { fn(...args); } catch (e) { warn('EventBus:', event, e); }
      });
    }
  };

  // ════════════════════════════════════════════════════════════════
  // MODULE: Storage
  // localStorage con key por world+player, expiración automática
  // ════════════════════════════════════════════════════════════════
  GA.storage = {

    _key() {
      return `${GA.STORAGE_PREFIX}_${GA._worldId()}_${GA._playerId()}`;
    },

    _read() {
      try   { return JSON.parse(localStorage.getItem(this._key()) || '{}'); }
      catch { return {}; }
    },

    _write(data) {
      try   { localStorage.setItem(this._key(), JSON.stringify(data)); }
      catch (e) { warn('Storage write:', e); }
    },

    /** Devuelve alertas no expiradas (< 24h pasado su timestamp) */
    getAlerts() {
      const cutoff = Date.now() - GA.STALE_HOURS * 3600 * 1000;
      return (this._read().alerts || []).filter(a => a.tsMs > cutoff);
    },

    /** Guarda alerta. Retorna false si ya existía (dedup por id). */
    saveAlert(alert) {
      const data = this._read();
      data.alerts = data.alerts || [];
      if (data.alerts.some(a => a.id === alert.id)) return false;
      data.alerts.push(alert);
      // Trim al máximo
      if (data.alerts.length > GA.MAX_HISTORY)
        data.alerts = data.alerts.slice(-GA.MAX_HISTORY);
      this._write(data);
      return true;
    },

    removeAlert(id) {
      const data = this._read();
      data.alerts = (data.alerts || []).filter(a => a.id !== id);
      this._write(data);
    },

    updateStatus(id, status) {
      const data = this._read();
      const a = (data.alerts || []).find(a => a.id === id);
      if (a) { a.status = status; this._write(data); }
    },

    getSettings() {
      return {
        soundEnabled:    true,
        visualEnabled:   true,
        browserEnabled:  false,
        autoplayEnabled: false,
        volume:          0.6,
        earlyMs:         0,
        ...(this._read().settings || {})
      };
    },

    saveSettings(patch) {
      const data = this._read();
      data.settings = { ...this.getSettings(), ...patch };
      this._write(data);
    }
  };

  // ════════════════════════════════════════════════════════════════
  // Helpers de contexto del juego
  // ════════════════════════════════════════════════════════════════

  /** Extrae world ID del dominio (ej: "ar102" de ar102.grepolis.com) */
  GA._worldId = () => {
    const m = location.hostname.match(/^([a-z]{2}\d+)\./);
    return m ? m[1] : 'unknown';
  };

  /** Player ID desde el game namespace */
  GA._playerId = () => {
    try { return (win.uw || win).Game?.player_id ?? 'unknown'; }
    catch { return 'unknown'; }
  };

  // ════════════════════════════════════════════════════════════════
  // MODULE: GameAccess
  // Wrapper sobre uw.MM — accede a colecciones Backbone del juego
  // ════════════════════════════════════════════════════════════════
  GA.game = {

    _uw() { return (win.uw || win); },

    /**
     * Accede a una colección Backbone por nombre.
     * API real de Grepolis: MM.getOnlyCollectionByName(name)
     * (distinto a la convención uw.MM.getCollectionType usada en bots externos)
     */
    _collection(name) {
      try { return this._uw().MM?.getOnlyCollectionByName?.(name) ?? null; }
      catch { return null; }
    },

    // Movimientos salientes/entrantes — Grepolis usa colecciones separadas
    getAttacks()       { return this._collection('Attack')?.models          || []; },
    getSupports()      { return this._collection('Support')?.models         || []; },
    getTrades()        { return this._collection('Trade')?.models           || []; },
    getBuildingOrders(){ return this._collection('BuildingBuildData')?.models || []; },
    getUnitOrders()    { return this._collection('UnitOrder')?.models        || []; },

    /** Todos los modelos de tipo "comando" (ataque/apoyo/transporte) */
    getCommands() {
      return [
        ...this.getAttacks(),
        ...this.getSupports(),
        ...this.getTrades(),
      ];
    },

    getCurrentTownId() {
      try { return this._uw().Game?.townId ?? null; }
      catch { return null; }
    },

    /**
     * Registra listeners en las colecciones Backbone.
     * add    = nuevo movimiento detectado → schedular alerta
     * remove = movimiento completado/cancelado → notificar
     * Se llama una sola vez — guarda flag _gaHooked para evitar duplicados.
     * También se puede re-llamar al detectar cambios en la toolbar (re-hook seguro).
     */
    hookCollections() {
      // Nombres reales de colecciones en Grepolis (verificado via MM.getCollections())
      ['Attack', 'Support', 'Trade', 'BuildingBuildData', 'UnitOrder'].forEach(name => {
        const col = this._collection(name);
        if (!col || col._gaHooked) return;
        col._gaHooked = true;

        // Nuevo modelo detectado → crear alerta con timer hasta arrival_at
        col.on('add', model => {
          GA.events.emit('model:added', { model, source: name });
          log(`Model added to ${name}:`, model.id);
        });

        // Modelo removido → movimiento completado, disparar notificación
        col.on('remove', model => {
          GA.events.emit('model:removed', { id: String(model.id), source: name });
          log(`Model removed from ${name}:`, model.id);
        });

        log(`Hooked Backbone collection: ${name}`);
      });

      // Escanear modelos ya existentes en la colección (cargados antes del hook)
      ['Attack', 'Support', 'Trade'].forEach(name => {
        const col = this._collection(name);
        if (!col?.models?.length) return;
        col.models.forEach(model => {
          GA.events.emit('model:added', { model, source: name });
        });
      });
    }
  };

  // ════════════════════════════════════════════════════════════════
  // MODULE: Parser
  // Transforma modelos Backbone o filas DOM en objetos Alert normalizados
  // ════════════════════════════════════════════════════════════════
  GA.parser = {

    TYPES: {
      attack:            { label: 'Ataque',         icon: '⚔️'  },
      support:           { label: 'Apoyo',           icon: '🛡️'  },
      return_own_units:  { label: 'Retorno',         icon: '↩️'  },
      colonization:      { label: 'Colonización',    icon: '🏛️'  },
      spy:               { label: 'Espionaje',       icon: '👁️'  },
      transport:         { label: 'Transporte',      icon: '📦'  },
      building:          { label: 'Construcción',    icon: '🏗️'  },
      unit:              { label: 'Reclutamiento',   icon: '🗡️'  },
      farm:              { label: 'Farm',            icon: '🌾'  },
      custom:            { label: 'Personalizada',   icon: '📝'  },
    },

    _meta(type) {
      return this.TYPES[type] || { label: type || 'Movimiento', icon: '📌' };
    },

    _base(id, type, tsMs, townId, extra) {
      const meta = this._meta(type);
      return {
        id,
        type,
        icon:      meta.icon,
        label:     extra?.label ?? meta.label,
        townId,
        tsMs,
        status:    'pending',
        trackedAt: Date.now(),
        ...extra
      };
    },

    /**
     * @param {Object} model  — modelo Backbone
     * @param {string} source — nombre real de la colección ('Attack'|'Support'|'Trade')
     */
    fromCommand(model, source = 'Attack') {
      const a = model.attributes ?? model;
      // Campo real verificado en consola: arrival_at (no arrive_at)
      const tsMs = a.arrival_at ? a.arrival_at * 1000 : null;
      if (!tsMs) return null;

      // destination_town_name no existe en Trade — extraer del link HTML (title="nombre")
      const dest = a.destination_town_name
        ?? (a.destination_town_link?.match(/title="([^"]+)"/)?.[1])
        ?? a.destination_town_id
        ?? '?';

      // Para trades: armar resumen de recursos
      const resources = source === 'Trade'
        ? [
            a.wood  > 0 ? `madera:${a.wood}`  : null,
            a.stone > 0 ? `piedra:${a.stone}` : null,
            a.iron  > 0 ? `hierro:${a.iron}`  : null,
            a.gold  > 0 ? `oro:${a.gold}`     : null,
          ].filter(Boolean).join(' ')
        : null;

      const type = a.type ?? (source === 'Trade' ? 'transport' : 'attack');
      const meta = this._meta(type);
      const label = resources
        ? `${meta.label} → ${dest} [${resources}]`
        : `${meta.label} → ${dest}`;

      return this._base(
        `cmd_${model.id}`,
        type,
        tsMs,
        a.origin_town_id,
        {
          modelId: model.id,
          source,
          label,
          resources: resources ?? null,
        }
      );
    },

    fromBuildingOrder(model) {
      const a = model.attributes ?? model;
      const tsMs = a.finished_at ? a.finished_at * 1000 : null;
      if (!tsMs) return null;

      return this._base(
        `bld_${model.id}`,
        'building',
        tsMs,
        a.town_id,
        {
          modelId: model.id,
          source:  'BuildingBuildData',
          label:   `Construcción: ${a.building_type ?? a.name ?? '?'}`
        }
      );
    },

    fromUnitOrder(model) {
      const a = model.attributes ?? model;
      const tsMs = (a.finish_time ?? a.finished_at);
      if (!tsMs) return null;
      const ts = tsMs < 9999999999 ? tsMs * 1000 : tsMs;

      return this._base(
        `unit_${model.id}`,
        'unit',
        ts,
        a.town_id,
        {
          modelId: model.id,
          source:  'UnitOrder',
          label:   `Reclutamiento: ${a.unit_name ?? '?'}`
        }
      );
    },

    /**
     * Fallback DOM: extrae datos desde una fila HTML que contiene un timer.
     * Infiere el tipo de movimiento por keywords en el texto de la fila.
     */
    fromRow(row) {
      const timerEl = row.querySelector(
        '[data-end-at], [data-time-until], [data-countdown], .timer_watch, .countdown, .eta, .time'
      );
      const tsMs = GA.utils.parseTimer(timerEl);
      if (!tsMs || tsMs <= Date.now()) return null;

      // Inferir tipo por texto del row
      const text = (row.textContent ?? '').toLowerCase();
      const typeMap = [
        ['attack',   ['attack', 'ataque']],
        ['support',  ['support', 'apoyo']],
        ['transport',['transport', 'transporte', 'recurso']],
        ['building', ['building', 'construcc', 'edificio']],
        ['unit',     ['unit', 'recruit', 'reclutam']],
      ];
      let type = 'transport';
      for (const [t, keys] of typeMap) {
        if (keys.some(k => text.includes(k))) { type = t; break; }
      }

      return this._base(
        `dom_${GA.utils.uid()}`,
        type,
        tsMs,
        GA.game.getCurrentTownId(),
        { source: 'DOM' }
      );
    }
  };

  // ════════════════════════════════════════════════════════════════
  // MODULE: Tracker
  // Gestiona el ciclo de vida de las alertas: track → schedule → complete
  // ════════════════════════════════════════════════════════════════
  GA.tracker = {

    _timers: new Map(),   // alert.id → setTimeout handle

    /** Registra una nueva alerta y schedula su notificación */
    track(alert) {
      if (!alert) return false;

      const saved = GA.storage.saveAlert(alert);
      if (!saved) {
        log('Already tracked:', alert.id);
        return false;
      }

      this._schedule(alert);
      GA.events.emit('alert:added', alert);
      log(`Tracked [${alert.type}] "${alert.label}" @ ${GA.utils.formatTime(alert.tsMs)}`);
      return true;
    },

    /** Cancela y elimina una alerta */
    untrack(id) {
      const h = this._timers.get(id);
      if (h) { clearTimeout(h); this._timers.delete(id); }
      GA.storage.removeAlert(id);
      GA.events.emit('alert:removed', id);
    },

    /** Schedula el setTimeout para la notificación */
    _schedule(alert) {
      const settings = GA.storage.getSettings();
      const delay = alert.tsMs - Date.now() - (settings.earlyMs ?? 0);

      if (delay <= 0) {
        // Pasó o está ocurriendo ahora
        this._notify(alert);
        return;
      }

      const handle = setTimeout(() => {
        this._notify(alert);
        this._timers.delete(alert.id);
      }, delay);

      this._timers.set(alert.id, handle);
    },

    _notify(alert) {
      GA.notifications.fire(alert);
      GA.storage.updateStatus(alert.id, 'notified');
      GA.events.emit('alert:notified', alert);
    },

    /**
     * Al recargar la página: restaura alertas pending del storage
     * y reschedula sus timers. Las alertas ya notificadas se dejan en historial.
     */
    restore() {
      const alerts = GA.storage.getAlerts();
      let count = 0;
      for (const a of alerts) {
        if (a.status === 'pending') {
          this._schedule(a);
          count++;
        }
      }
      log(`Restored ${count} pending alerts`);
    },

    /**
     * Cuando Backbone emite 'remove' en una colección,
     * busca si alguna alerta pendiente corresponde a ese modelo.
     */
    onModelRemoved({ id, source }) {
      const alerts = GA.storage.getAlerts();
      for (const a of alerts) {
        if (a.status === 'pending'
            && a.source === source
            && String(a.modelId) === String(id)) {
          const h = this._timers.get(a.id);
          if (h) { clearTimeout(h); this._timers.delete(a.id); }
          this._notify(a);
        }
      }
    },

    /**
     * Cuando Backbone emite 'add' en una colección,
     * parsea el modelo y schedula la alerta automáticamente.
     */
    onModelAdded({ model, source }) {
      let alert = null;

      if (source === 'BuildingBuildData') {
        alert = GA.parser.fromBuildingOrder(model);
      } else if (source === 'UnitOrder') {
        alert = GA.parser.fromUnitOrder(model);
      } else {
        // Attack, Support, Trade
        alert = GA.parser.fromCommand(model, source);
      }

      if (alert) {
        GA.tracker.track(alert);
      }
    }
  };

  // ════════════════════════════════════════════════════════════════
  // MODULE: Notifications
  // Tres canales: sonido (Web Audio) + visual (toast in-game) + browser
  // ════════════════════════════════════════════════════════════════
  GA.notifications = {

    _ctx: null,

    _audioCtx() {
      if (!this._ctx)
        this._ctx = new (window.AudioContext || window.webkitAudioContext)();
      return this._ctx;
    },

    fire(alert) {
      const s = GA.storage.getSettings();
      log('Firing notification:', alert.label);
      if (s.soundEnabled)   this.sound();
      if (s.visualEnabled)  this.toast(alert);
      if (s.browserEnabled) this.browser(alert);
    },

    /** Alarma tipo despertador — repite la secuencia 3 veces */
    sound() {
      if (!this._ctx) return;
      try {
        const ctx     = this._ctx;
        const vol     = Math.min(1, Math.max(0, GA.storage.getSettings().volume ?? 0.6));
        const now     = ctx.currentTime;
        const BEEPS   = 8;
        const ON      = 0.14;
        const OFF     = 0.07;
        const REPEATS = 3;
        const PAUSE   = 0.8;
        const seqDur  = BEEPS * (ON + OFF);

        for (let r = 0; r < REPEATS; r++) {
          const base = now + r * (seqDur + PAUSE);
          for (let i = 0; i < BEEPS; i++) {
            const t    = base + i * (ON + OFF);
            const freq = i % 2 === 0 ? 1050 : 880;
            const osc  = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'square';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(vol, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + ON);
            osc.start(t);
            osc.stop(t + ON);
          }
        }
      } catch (e) { log('Audio error:', e); }
    },

    /** Toast overlay dentro del juego */
    toast(alert) {
      let container = document.getElementById('ga_toast_container');
      if (!container) {
        container = document.createElement('div');
        container.id = 'ga_toast_container';
        document.body.appendChild(container);
      }

      const el = document.createElement('div');
      el.className = 'ga_toast';
      el.innerHTML = `
        <span class="ga_toast_icon">${GA.utils.esc(alert.icon)}</span>
        <div class="ga_toast_body">
          <div class="ga_toast_title">Movimiento completado</div>
          <div class="ga_toast_msg">${GA.utils.esc(alert.label)}</div>
        </div>
        <button class="ga_toast_close" aria-label="Cerrar">×</button>
      `;

      el.querySelector('.ga_toast_close').onclick = () => el.remove();
      container.appendChild(el);

      // Animación entrada
      requestAnimationFrame(() => el.classList.add('ga_show'));
      // Auto-dismiss después de 8s
      setTimeout(() => el.classList.remove('ga_show'), 7700);
      setTimeout(() => el.remove(), 8200);
    },

    /** Notificación nativa del SO */
    browser(alert) {
      if (!('Notification' in window)) return;
      if (Notification.permission === 'granted') {
        new Notification(`${alert.icon} GrepoAlerts`, {
          body: alert.label,
          icon: '/favicon.ico',
          tag:  `ga_${alert.id}`
        });
      } else if (Notification.permission !== 'denied') {
        // Solicitamos en el primer click (ver UI.requestBrowserPermission)
      }
    },

    requestBrowserPermission() {
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().then(p => {
          log('Browser notification permission:', p);
        });
      }
    }
  };

  // ════════════════════════════════════════════════════════════════
  // MODULE: UI
  // FAB + Panel + Bell buttons + MutationObserver
  // ════════════════════════════════════════════════════════════════
  GA.ui = {

    _observer:    null,
    _panelOpen:   false,
    _activeTab:   'active',
    _refreshTick: null,
    _injected:    new WeakSet(),   // rows ya procesados

    // ─── CSS ──────────────────────────────────────────────────────
    injectStyles() {
      if (document.getElementById('ga_styles')) return;
      const s = document.createElement('style');
      s.id = 'ga_styles';
      s.textContent = `
        /* ─ Tokens ─ */
        :root {
          --ga-gold:    #c8a96e;
          --ga-gold-lt: #e8c87a;
          --ga-bg:      #1e1507;
          --ga-bg2:     #2d1e08;
          --ga-bg3:     #3d2d11;
          --ga-border:  #5a3d12;
          --ga-text:    #d4b483;
          --ga-muted:   #8b7a52;
          --ga-green:   #27ae60;
          --ga-red:     #e74c3c;
        }

        /* ─ Bell button ─ */
        .ga_bell {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          font-size: 13px;
          cursor: pointer;
          opacity: 0.4;
          transition: opacity .15s, transform .1s;
          user-select: none;
          margin: 0 3px;
          vertical-align: middle;
          flex-shrink: 0;
          position: relative;
        }
        .ga_bell:hover           { opacity: 1; transform: scale(1.2); }
        .ga_bell.ga_tracked      { opacity: 1; }
        .ga_bell.ga_tracked span { display: none; }
        .ga_bell.ga_ringing      { animation: ga_ring .35s ease; }
        @keyframes ga_ring {
          0%,100% { transform: rotate(0);    }
          25%     { transform: rotate(18deg); }
          75%     { transform: rotate(-18deg);}
        }

        /* Bell tooltip */
        .ga_bell_tip {
          position: absolute;
          bottom: 125%;
          left: 50%;
          transform: translateX(-50%);
          background: var(--ga-bg3);
          border: 1px solid var(--ga-border);
          color: var(--ga-text);
          padding: 3px 8px;
          border-radius: 4px;
          font-size: 11px;
          white-space: nowrap;
          pointer-events: none;
          z-index: 999999;
          opacity: 0;
          animation: ga_fadein .2s .1s forwards, ga_fadeout .2s 2.3s forwards;
        }
        @keyframes ga_fadein  { to { opacity: 1; } }
        @keyframes ga_fadeout { to { opacity: 0; } }

        /* ─ FAB ─ */
        #ga_fab {
          position: fixed;
          bottom: 76px;
          left: 14px;
          z-index: 99999;
          width: 46px;
          height: 46px;
          border-radius: 50%;
          background: linear-gradient(145deg, #c8a96e, #7a5510);
          border: 2px solid var(--ga-border);
          box-shadow: 0 4px 14px rgba(0,0,0,.65);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 22px;
          user-select: none;
          transition: transform .15s;
        }
        #ga_fab:hover { transform: scale(1.08); }
        #ga_fab_badge {
          position: absolute;
          top: -5px;
          right: -5px;
          background: var(--ga-red);
          color: #fff;
          border-radius: 50%;
          min-width: 18px;
          height: 18px;
          font-size: 11px;
          font-weight: 700;
          display: none;
          align-items: center;
          justify-content: center;
          padding: 0 2px;
        }
        #ga_fab_badge.ga_visible { display: flex; }

        /* ─ Panel ─ */
        #ga_panel {
          position: fixed;
          bottom: 132px;
          left: 14px;
          z-index: 99998;
          width: 320px;
          max-height: 460px;
          background: linear-gradient(180deg, var(--ga-bg3) 0%, var(--ga-bg) 100%);
          border: 2px solid #8b6914;
          border-radius: 8px;
          box-shadow: 0 8px 28px rgba(0,0,0,.8);
          font-family: "Trebuchet MS", Tahoma, sans-serif;
          color: var(--ga-text);
          display: none;
          flex-direction: column;
          overflow: hidden;
        }
        #ga_panel.ga_open { display: flex; }

        /* Panel header */
        .ga_ph {
          padding: 10px 14px;
          background: linear-gradient(180deg, #5a3d12, #3a2508);
          border-bottom: 1px solid #7a5510;
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-shrink: 0;
        }
        .ga_ph_title {
          font-size: 13px;
          font-weight: 700;
          color: var(--ga-gold-lt);
          letter-spacing: .4px;
        }
        .ga_ph_btn {
          background: none;
          border: 1px solid var(--ga-border);
          color: var(--ga-gold);
          border-radius: 4px;
          padding: 2px 8px;
          font-size: 11px;
          cursor: pointer;
          font-family: inherit;
          transition: background .15s;
        }
        .ga_ph_btn:hover { background: rgba(200,169,110,.15); }

        /* Tabs */
        .ga_tabs {
          display: flex;
          border-bottom: 1px solid var(--ga-bg2);
          flex-shrink: 0;
          background: rgba(0,0,0,.2);
        }
        .ga_tab {
          flex: 1;
          padding: 7px 4px;
          text-align: center;
          font-size: 11px;
          cursor: pointer;
          color: var(--ga-muted);
          border-bottom: 2px solid transparent;
          transition: color .15s;
        }
        .ga_tab.ga_on {
          color: var(--ga-gold-lt);
          border-bottom-color: var(--ga-gold);
          background: rgba(200,169,110,.05);
        }

        /* Content area */
        .ga_content {
          flex: 1;
          overflow-y: auto;
          padding: 6px;
          scrollbar-width: thin;
          scrollbar-color: var(--ga-border) transparent;
        }
        .ga_content::-webkit-scrollbar { width: 4px; }
        .ga_content::-webkit-scrollbar-thumb { background: var(--ga-border); border-radius: 2px; }

        /* Alert row */
        .ga_row {
          display: flex;
          align-items: center;
          gap: 7px;
          padding: 7px 8px;
          border-radius: 5px;
          margin-bottom: 3px;
          background: rgba(255,255,255,.03);
          border: 1px solid transparent;
          border-left: 3px solid var(--ga-border);
          transition: border-color .15s;
        }
        .ga_row:hover { border-color: var(--ga-gold); }
        .ga_row.ga_done { border-left-color: var(--ga-green); opacity: .65; }

        .ga_row_icon { font-size: 16px; flex-shrink: 0; }
        .ga_row_info { flex: 1; min-width: 0; }
        .ga_row_label {
          font-size: 12px;
          font-weight: 700;
          color: var(--ga-text);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .ga_row_meta { font-size: 10px; color: var(--ga-muted); margin-top: 1px; }

        .ga_row_cd {
          font-size: 11px;
          font-weight: 700;
          color: var(--ga-gold-lt);
          text-align: right;
          flex-shrink: 0;
          min-width: 46px;
        }
        .ga_row_cd.ga_urgent { color: var(--ga-red); }

        .ga_row_del {
          background: none;
          border: none;
          color: var(--ga-border);
          cursor: pointer;
          font-size: 15px;
          line-height: 1;
          padding: 0 2px;
          flex-shrink: 0;
          transition: color .15s;
          font-family: inherit;
        }
        .ga_row_del:hover { color: var(--ga-red); }

        /* Empty state */
        .ga_empty {
          text-align: center;
          color: var(--ga-border);
          padding: 24px 16px;
          font-size: 12px;
          line-height: 1.6;
        }
        .ga_empty_hint {
          margin-top: 6px;
          font-size: 10px;
          color: var(--ga-muted);
          opacity: .7;
        }

        /* Settings */
        .ga_srow {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 9px 4px;
          border-bottom: 1px solid var(--ga-bg2);
          font-size: 12px;
        }
        .ga_toggle {
          width: 36px;
          height: 20px;
          border-radius: 10px;
          background: var(--ga-bg2);
          border: 1px solid var(--ga-border);
          cursor: pointer;
          position: relative;
          transition: background .2s;
          flex-shrink: 0;
        }
        .ga_toggle.ga_on { background: #7a5510; border-color: var(--ga-gold); }
        .ga_toggle::after {
          content: '';
          position: absolute;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--ga-gold);
          top: 2px;
          left: 2px;
          transition: left .2s;
        }
        .ga_toggle.ga_on::after { left: 18px; }

        /* ─ Toast ─ */
        #ga_toasts {
          position: fixed;
          top: 18px;
          right: 18px;
          z-index: 999999;
          display: flex;
          flex-direction: column;
          gap: 8px;
          pointer-events: none;
          max-width: 300px;
        }
        .ga_toast {
          background: linear-gradient(135deg, var(--ga-bg3), var(--ga-bg));
          border: 1px solid #8b6914;
          border-radius: 8px;
          padding: 10px 12px;
          display: flex;
          align-items: center;
          gap: 10px;
          box-shadow: 0 4px 18px rgba(0,0,0,.75);
          pointer-events: auto;
          font-family: "Trebuchet MS", Tahoma, sans-serif;
          color: var(--ga-text);
          opacity: 0;
          transform: translateX(16px);
          transition: opacity .28s, transform .28s;
        }
        .ga_toast.ga_show { opacity: 1; transform: translateX(0); }
        .ga_toast_icon { font-size: 22px; flex-shrink: 0; }
        .ga_toast_body { flex: 1; }
        .ga_toast_title { font-size: 10px; color: var(--ga-muted); text-transform: uppercase; letter-spacing: .5px; }
        .ga_toast_msg   { font-size: 13px; font-weight: 700; color: var(--ga-gold-lt); }
        .ga_toast_x {
          background: none; border: none; color: var(--ga-muted);
          cursor: pointer; font-size: 17px; line-height: 1; padding: 0;
        }
        .ga_toast_x:hover { color: var(--ga-red); }

        /* ─ Volume slider ─ */
        .ga_slider {
          width: 80px;
          accent-color: var(--ga-gold);
          cursor: pointer;
          vertical-align: middle;
        }

        /* ─ Time input (MM:SS) ─ */
        .ga_time_in {
          width: 28px;
          background: var(--ga-bg2);
          border: 1px solid var(--ga-border);
          color: var(--ga-text);
          border-radius: 3px;
          padding: 2px 3px;
          font-size: 11px;
          text-align: center;
          font-family: monospace;
        }
        .ga_time_in:focus { outline: 1px solid var(--ga-gold); }

        /* ─ Custom alert form ─ */
        .ga_input {
          width: 100%;
          box-sizing: border-box;
          background: var(--ga-bg2);
          border: 1px solid var(--ga-border);
          color: var(--ga-text);
          border-radius: 4px;
          padding: 5px 8px;
          font-size: 11px;
          font-family: inherit;
          margin-bottom: 6px;
        }
        .ga_input:focus { outline: 1px solid var(--ga-gold); }
        .ga_input::placeholder { color: var(--ga-muted); }
        .ga_custom_wrap {
          border-top: 1px solid var(--ga-border);
          padding: 8px 6px 4px;
          background: rgba(0,0,0,.15);
        }
        .ga_custom_title {
          font-size: 10px;
          color: var(--ga-gold);
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: .5px;
          margin-bottom: 6px;
        }
        .ga_radio_row {
          display: flex;
          gap: 12px;
          margin-bottom: 6px;
          font-size: 11px;
          color: var(--ga-muted);
        }
        .ga_radio_row label { display:flex; align-items:center; gap:4px; cursor:pointer; }
        .ga_form_row {
          display: flex;
          align-items: center;
          gap: 4px;
          margin-bottom: 6px;
          font-size: 11px;
          color: var(--ga-muted);
        }
        .ga_form_actions { display: flex; gap: 6px; margin-top: 4px; }
        .ga_btn_add {
          flex: 1;
          background: linear-gradient(180deg,#7a5510,#5a3d12);
          border: 1px solid var(--ga-gold);
          color: var(--ga-gold-lt);
          border-radius: 4px;
          padding: 4px 8px;
          font-size: 11px;
          cursor: pointer;
          font-family: inherit;
          font-weight: 700;
        }
        .ga_btn_add:hover { background: #8b6914; }
        .ga_btn_cancel {
          background: none;
          border: 1px solid var(--ga-border);
          color: var(--ga-muted);
          border-radius: 4px;
          padding: 4px 8px;
          font-size: 11px;
          cursor: pointer;
          font-family: inherit;
        }
      `;
      document.head.appendChild(s);
    },

    // ─── FAB ──────────────────────────────────────────────────────
    buildFAB() {
      if (document.getElementById('ga_fab')) return;
      const fab = document.createElement('div');
      fab.id    = 'ga_fab';
      fab.title = 'GrepoAlerts';
      fab.innerHTML = `🔔<span id="ga_fab_badge"></span>`;
      fab.onclick = () => {
        if (!GA.notifications._ctx)
          GA.notifications._ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.togglePanel();
      };
      document.body.appendChild(fab);
    },

    updateBadge() {
      const badge = document.getElementById('ga_fab_badge');
      if (!badge) return;
      const n = GA.storage.getAlerts().filter(a => a.status === 'pending').length;
      badge.textContent = n > 9 ? '9+' : n;
      badge.classList.toggle('ga_visible', n > 0);
    },

    // ─── Panel ────────────────────────────────────────────────────
    buildPanel() {
      if (document.getElementById('ga_panel')) return;
      const p = document.createElement('div');
      p.id = 'ga_panel';
      p.innerHTML = `
        <div class="ga_ph">
          <span class="ga_ph_title">🔔 GrepoAlerts <span style="font-weight:400;font-size:10px;opacity:.6">v${GA.VERSION}</span></span>
          <button class="ga_ph_btn" id="ga_clear">Limpiar historial</button>
        </div>
        <div class="ga_tabs">
          <div class="ga_tab ga_on" data-tab="active">Activas</div>
          <div class="ga_tab" data-tab="history">Historial</div>
          <div class="ga_tab" data-tab="settings">Config</div>
        </div>
        <div class="ga_content" id="ga_c_active"></div>
        <div id="ga_c_custom" style="display:none"></div>
        <div class="ga_content" id="ga_c_history" style="display:none"></div>
        <div class="ga_content" id="ga_c_settings" style="display:none"></div>
      `;

      p.querySelector('#ga_clear').onclick = () => {
        GA.storage.getAlerts()
          .filter(a => a.status === 'notified')
          .forEach(a => GA.storage.removeAlert(a.id));
        this._render();
        this.updateBadge();
      };

      p.querySelectorAll('.ga_tab').forEach(tab => {
        tab.onclick = () => this._switchTab(tab.dataset.tab);
      });

      document.body.appendChild(p);
      this._buildSettings();
    },

    togglePanel() {
      this._panelOpen = !this._panelOpen;
      const p = document.getElementById('ga_panel');
      if (!p) return;
      p.classList.toggle('ga_open', this._panelOpen);
      if (this._panelOpen) {
        this._render();
        this._refreshTick = setInterval(() => this._renderList('active'), 1000);
      } else {
        clearInterval(this._refreshTick);
      }
    },

    _switchTab(tab) {
      this._activeTab = tab;
      document.querySelectorAll('#ga_panel .ga_tab').forEach(t =>
        t.classList.toggle('ga_on', t.dataset.tab === tab)
      );
      ['active', 'history', 'settings'].forEach(t => {
        const el = document.getElementById(`ga_c_${t}`);
        if (el) el.style.display = t === tab ? 'block' : 'none';
      });
      if (tab !== 'settings') this._renderList(tab);
    },

    _render() {
      this._renderList(this._activeTab === 'settings' ? 'active' : this._activeTab);
      this.updateBadge();
    },

    _renderList(tab) {
      const el = document.getElementById(`ga_c_${tab}`);
      if (!el || el.style.display === 'none') return;

      const all = GA.storage.getAlerts();
      const list = tab === 'active'
        ? all.filter(a => a.status === 'pending').sort((a, b) => a.tsMs - b.tsMs)
        : all.filter(a => a.status === 'notified').sort((a, b) => b.tsMs - a.tsMs).slice(0, 40);

      if (!list.length) {
        const hint = tab === 'active'
          ? 'Hacé click en el 🔔 junto<br>a cualquier movimiento del juego.'
          : 'Las alertas completadas<br>aparecen aquí.';
        el.innerHTML = `<div class="ga_empty">No hay alertas.<div class="ga_empty_hint">${hint}</div></div>`;
        return;
      }

      el.innerHTML = list.map(a => {
        const remaining = a.tsMs - Date.now();
        const cd  = a.status === 'pending'
          ? GA.utils.formatRelative(a.tsMs)
          : `✓ ${GA.utils.formatTime(a.tsMs)}`;
        const urgent = a.status === 'pending' && remaining > 0 && remaining < 60_000;

        const meta = a.status === 'pending'
          ? `Llega: ${GA.utils.formatTime(a.tsMs)}`
          : `Llegó: ${GA.utils.formatTime(a.tsMs)}`;

        return `
          <div class="ga_row ${a.status === 'notified' ? 'ga_done' : ''}">
            <span class="ga_row_icon">${GA.utils.esc(a.icon)}</span>
            <div class="ga_row_info">
              <div class="ga_row_label" title="${GA.utils.esc(a.label)}">${GA.utils.esc(a.label)}</div>
              <div class="ga_row_meta">${meta}</div>
            </div>
            <span class="ga_row_cd ${urgent ? 'ga_urgent' : ''}">${cd}</span>
            <button class="ga_row_del" data-id="${GA.utils.esc(a.id)}" title="Eliminar">×</button>
          </div>
        `;
      }).join('');

      el.querySelectorAll('.ga_row_del').forEach(btn => {
        btn.onclick = e => {
          e.stopPropagation();
          GA.tracker.untrack(btn.dataset.id);
          this._render();
          this.updateBadge();
        };
      });

      if (tab === 'active') {
        const addBtn = document.createElement('div');
        addBtn.style.cssText = 'text-align:center;padding:6px 0';
        addBtn.innerHTML = `<button class="ga_ph_btn" id="ga_open_custom" style="font-size:11px">＋ Alerta personalizada</button>`;
        el.appendChild(addBtn);
        el.querySelector('#ga_open_custom').onclick = () => this._toggleCustomForm();
      }
    },

    _buildSettings() {
      const el = document.getElementById('ga_c_settings');
      if (!el) return;
      const s = GA.storage.getSettings();
      const toggles = [
        { key: 'soundEnabled',    label: '🔊 Sonido'                    },
        { key: 'visualEnabled',   label: '📋 Notificación visual'        },
        { key: 'browserEnabled',  label: '💬 Notificación del navegador' },
        { key: 'autoplayEnabled', label: '▶️ Autoplay (sin click previo)' },
      ];

      el.innerHTML = toggles.map(r => `
        <div class="ga_srow">
          <span>${r.label}</span>
          <div class="ga_toggle ${s[r.key] ? 'ga_on' : ''}" data-key="${r.key}"></div>
        </div>
      `).join('') + `
        <div class="ga_srow">
          <span>⏰ Avisar antes (MM:SS)</span>
          <div style="display:flex;align-items:center;gap:3px">
            <input type="number" class="ga_time_in" min="0" max="59" id="ga_early_mm"
                   value="${String(Math.floor((s.earlyMs||0)/60000)).padStart(2,'0')}">
            <span style="color:var(--ga-muted);font-weight:700">:</span>
            <input type="number" class="ga_time_in" min="0" max="59" id="ga_early_ss"
                   value="${String(Math.floor(((s.earlyMs||0)%60000)/1000)).padStart(2,'0')}">
          </div>
        </div>
        <div class="ga_srow">
          <span>🎚️ Volumen</span>
          <input type="range" class="ga_slider" min="0" max="1" step="0.1"
                 value="${s.volume ?? 0.6}" id="ga_vol_slider">
        </div>
        <div style="text-align:center;margin-top:12px;font-size:10px;color:var(--ga-border)">
          GrepoAlerts v${GA.VERSION}<br>
          Solo monitoreo — sin automatización de acciones
        </div>
      `;

      el.querySelectorAll('.ga_toggle').forEach(t => {
        t.onclick = () => {
          t.classList.toggle('ga_on');
          const val = t.classList.contains('ga_on');
          GA.storage.saveSettings({ [t.dataset.key]: val });
          if (t.dataset.key === 'browserEnabled' && val)
            GA.notifications.requestBrowserPermission();
          if (t.dataset.key === 'autoplayEnabled' && val && !GA.notifications._ctx)
            GA.notifications._ctx = new (window.AudioContext || window.webkitAudioContext)();
        };
      });

      el.querySelector('#ga_vol_slider')?.addEventListener('input', e => {
        GA.storage.saveSettings({ volume: parseFloat(e.target.value) });
      });

      const saveEarly = () => {
        const mm = parseInt(el.querySelector('#ga_early_mm')?.value || 0);
        const ss = parseInt(el.querySelector('#ga_early_ss')?.value || 0);
        GA.storage.saveSettings({ earlyMs: (mm * 60 + ss) * 1000 });
      };
      el.querySelector('#ga_early_mm')?.addEventListener('change', saveEarly);
      el.querySelector('#ga_early_ss')?.addEventListener('change', saveEarly);
    },

    // ─── Toast container ─────────────────────────────────────────
    buildToastContainer() {
      if (!document.getElementById('ga_toasts')) {
        const c = document.createElement('div');
        c.id = 'ga_toasts';
        document.body.appendChild(c);
      }
    },

    // ─── Bell injection ──────────────────────────────────────────

    /**
     * Selectores de filas candidatas. Grepolis usa .trow1/.trow2 en tablas
     * y clases más específicas en ventanas de comandos.
     * El fallback es cualquier <tr> o <li> que contenga un timer.
     */
    CANDIDATE_SELECTORS: [
      'tr.trow1', 'tr.trow2',
      '.command_list_entry',
      '.movement_slot',
      '.command_row',
      '.js-command-item',
      '.building_order',
      '.order_item',
      '.unit_order',
      '.troop_slot',
      'div.item[data-id]',
    ].join(','),

    TIMER_SELECTOR: [
      '[data-end-at]',
      '[data-time-until]',
      '[data-countdown]',
      '.timer_watch',
      '.countdown',
      '.eta',
      '.slot_action_small_container',
      '.time',
    ].join(','),

    scanAndInject() {
      // Filas explícitas
      document.querySelectorAll(this.CANDIDATE_SELECTORS).forEach(row => {
        if (row.querySelector(this.TIMER_SELECTOR)) this._addBell(row);
      });

      // Fallback: cualquier <tr>/<li> con timer que no fue cubierto
      document.querySelectorAll(`tr, li`).forEach(row => {
        if (row.querySelector(this.TIMER_SELECTOR)) this._addBell(row);
      });
    },

    _addBell(row) {
      // Evitar re-procesar y evitar insertar en rows que ya tienen campana
      if (this._injected.has(row)) return;
      if (row.querySelector('.ga_bell')) return;
      this._injected.add(row);

      const bell = document.createElement('span');
      bell.className = 'ga_bell';
      bell.title = 'Registrar alerta (GrepoAlerts)';
      bell.innerHTML = '🔔';

      bell.onclick = e => {
        e.stopPropagation();
        e.preventDefault();
        this._onBellClick(bell, row);
      };

      // Insertar después del primer timer encontrado, o al final de la fila
      const timer = row.querySelector(this.TIMER_SELECTOR);
      if (timer?.parentNode) {
        timer.parentNode.insertBefore(bell, timer.nextSibling);
      } else {
        row.appendChild(bell);
      }
    },

    _onBellClick(bell, row) {
      let alert = null;

      // Intentar encontrar el model ID en el DOM (el juego usa data-id en rows)
      const modelId = row.dataset.id
        ?? row.dataset.commandId
        ?? row.closest('[data-id]')?.dataset.id;

      if (modelId) {
        // Buscar en cada colección de comandos con su source real
        const cmdSources = [
          ['Attack',  GA.game.getAttacks()],
          ['Support', GA.game.getSupports()],
          ['Trade',   GA.game.getTrades()],
        ];
        for (const [src, models] of cmdSources) {
          const m = models.find(m => String(m.id) === modelId);
          if (m) { alert = GA.parser.fromCommand(m, src); break; }
        }

        // Buscar en Buildings
        if (!alert) {
          const bld = GA.game.getBuildingOrders().find(m => String(m.id) === modelId);
          if (bld) alert = GA.parser.fromBuildingOrder(bld);
        }

        // Buscar en Units
        if (!alert) {
          const unit = GA.game.getUnitOrders().find(m => String(m.id) === modelId);
          if (unit) alert = GA.parser.fromUnitOrder(unit);
        }
      }

      // Fallback: parsear desde DOM
      if (!alert) alert = GA.parser.fromRow(row);

      if (!alert) {
        this._bellTip(bell, '❌ No se pudo leer el timer', 'error');
        return;
      }

      const tracked = GA.tracker.track(alert);
      if (!tracked) {
        this._bellTip(bell, '✓ Ya registrado', 'info');
        return;
      }

      bell.classList.add('ga_tracked', 'ga_ringing');
      setTimeout(() => bell.classList.remove('ga_ringing'), 400);
      this._bellTip(bell, `✓ ${GA.utils.formatRelative(alert.tsMs)}`, 'ok');
    },

    _toggleCustomForm() {
      const wrap = document.getElementById('ga_c_custom');
      if (!wrap) return;
      const visible = wrap.style.display !== 'none';
      if (visible) { wrap.style.display = 'none'; return; }

      wrap.style.display = 'block';
      wrap.innerHTML = `
        <div class="ga_custom_wrap">
          <div class="ga_custom_title">Nueva alerta personalizada</div>
          <input type="text" class="ga_input" id="ga_ct" placeholder="Texto de la notificación" maxlength="80">
          <div class="ga_radio_row">
            <label><input type="radio" name="ga_ctype" value="exact" checked> Hora exacta</label>
            <label><input type="radio" name="ga_ctype" value="countdown"> Cuenta regresiva</label>
          </div>
          <div class="ga_form_row" id="ga_row_exact">
            HH <input type="number" class="ga_time_in" id="ga_c_hh" min="0" max="23" value="00">
            : MM <input type="number" class="ga_time_in" id="ga_c_mm" min="0" max="59" value="00">
          </div>
          <div class="ga_form_row" id="ga_row_cd" style="display:none">
            HH <input type="number" class="ga_time_in" id="ga_c_chh" min="0" max="99" value="00">
            : MM <input type="number" class="ga_time_in" id="ga_c_cmm" min="0" max="59" value="00">
            : SS <input type="number" class="ga_time_in" id="ga_c_css" min="0" max="59" value="00">
          </div>
          <div class="ga_form_actions">
            <button class="ga_btn_add" id="ga_ct_add">Agregar</button>
            <button class="ga_btn_cancel" id="ga_ct_cancel">Cancelar</button>
          </div>
        </div>
      `;

      wrap.querySelectorAll('input[name="ga_ctype"]').forEach(r => {
        r.onchange = () => {
          const isExact = wrap.querySelector('input[name="ga_ctype"]:checked').value === 'exact';
          wrap.querySelector('#ga_row_exact').style.display = isExact ? 'flex' : 'none';
          wrap.querySelector('#ga_row_cd').style.display    = isExact ? 'none' : 'flex';
        };
      });

      wrap.querySelector('#ga_ct_cancel').onclick = () => { wrap.style.display = 'none'; };
      wrap.querySelector('#ga_ct_add').onclick    = () => this._addCustomAlert(wrap);
    },

    _addCustomAlert(wrap) {
      const label = wrap.querySelector('#ga_ct')?.value?.trim();
      if (!label) { wrap.querySelector('#ga_ct').focus(); return; }

      const type  = wrap.querySelector('input[name="ga_ctype"]:checked').value;
      let tsMs;

      if (type === 'exact') {
        const hh = parseInt(wrap.querySelector('#ga_c_hh').value || 0);
        const mm = parseInt(wrap.querySelector('#ga_c_mm').value || 0);
        const now = new Date();
        const target = new Date(now);
        target.setHours(hh, mm, 0, 0);
        if (target <= now) target.setDate(target.getDate() + 1);
        tsMs = target.getTime();
      } else {
        const hh = parseInt(wrap.querySelector('#ga_c_chh').value || 0);
        const mm = parseInt(wrap.querySelector('#ga_c_cmm').value || 0);
        const ss = parseInt(wrap.querySelector('#ga_c_css').value || 0);
        tsMs = Date.now() + (hh * 3600 + mm * 60 + ss) * 1000;
      }

      if (!tsMs || tsMs <= Date.now()) {
        wrap.querySelector('#ga_ct').style.outline = '1px solid var(--ga-red)';
        return;
      }

      const alert = {
        id:        `custom_${GA.utils.uid()}`,
        type:      'custom',
        icon:      '📝',
        label,
        tsMs,
        status:    'pending',
        trackedAt: Date.now(),
        source:    'custom',
      };

      GA.tracker.track(alert);
      wrap.style.display = 'none';
      this._render();
    },

    _bellTip(bell, msg, type) {
      // Eliminar tooltip previo si existe
      bell.querySelector('.ga_bell_tip')?.remove();
      const tip = document.createElement('span');
      tip.className = 'ga_bell_tip';
      tip.textContent = msg;
      if (type === 'error') tip.style.background = 'var(--ga-red)';
      if (type === 'info')  tip.style.background = 'var(--ga-border)';
      bell.appendChild(tip);
      setTimeout(() => tip.remove(), 2600);
    },

    // ─── MutationObserver ─────────────────────────────────────────
    // Patrón NaKamize: observar indicadores de actividad en la toolbar
    // (NO #main_area — los movimientos no aparecen ahí hasta que el usuario abre la ventana)
    startObserver() {
      // Los 3 indicadores confirmados en consola: attack_indicator, trades, commands
      const toolbarSelectors = [
        '.activity.attack_indicator',
        '.activity.trades',
        '.activity.commands',
      ];

      let watched = 0;
      toolbarSelectors.forEach(selector => {
        const el = document.querySelector(`#ui_box .tb_activities ${selector}`);
        if (!el) return;

        new MutationObserver(() => {
          const active = el.classList.contains('active');
          log(`Toolbar indicator changed [${selector}] active:${active}`);
          // Re-hookear por si hay nuevas colecciones cargadas
          GA.game.hookCollections();
          this.scanAndInject();
        }).observe(el, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });

        watched++;
        log(`Watching toolbar indicator: ${selector}`);
      });

      // Observer para el dropdown de trades — observa body porque el elemento
      // puede no existir al init (se crea lazily por el juego)
      new MutationObserver(mutations => {
        for (const m of mutations) {
          if (m.target.id === 'toolbar_activity_trades_list'
              && m.target.style.display !== 'none') {
            log('Trades dropdown visible — scanAndInject');
            this.scanAndInject();
            break;
          }
        }
      }).observe(document.body, { attributes: true, attributeFilter: ['style'], subtree: true });

      // Fallback: si la toolbar aún no está en el DOM, observar #main_area
      if (watched === 0) {
        const target = document.getElementById('main_area') ?? document.body;
        new MutationObserver(() => this.scanAndInject())
          .observe(target, { childList: true, subtree: true });
        log('Fallback observer on #' + (target.id || 'body'));
      }
    },

    // ─── Init ─────────────────────────────────────────────────────
    init() {
      this.injectStyles();
      this.buildToastContainer();
      this.buildFAB();
      this.buildPanel();
      this.startObserver();
      this.scanAndInject();   // primera pasada
      log('UI ready');
    }
  };

  // ════════════════════════════════════════════════════════════════
  // BOOTSTRAP
  // Espera a que el game namespace (uw.MM) esté disponible
  // ════════════════════════════════════════════════════════════════
  function init() {
    log(`GrepoAlerts v${GA.VERSION} — Initializing`);

    // Registrar listeners del EventBus
    GA.events.on('model:added',    data => GA.tracker.onModelAdded(data));
    GA.events.on('model:removed',  data => GA.tracker.onModelRemoved(data));
    GA.events.on('alert:notified', ()   => { GA.ui.updateBadge(); GA.ui._render?.(); });
    GA.events.on('alert:added',    ()   => GA.ui.updateBadge());

    // Restaurar alertas pendientes del storage (page reload recovery)
    GA.tracker.restore();

    // Hookear Backbone collections si están disponibles
    GA.game.hookCollections();

    // Inicializar interfaz
    GA.ui.init();

    log('Ready ✓');
  }

  function waitForGame() {
    let attempts = 0;
    (function check() {
      const uw = (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);

      // Grepolis expone MM directamente en window (sin wrapper uw.*).
      // En TamperMonkey, unsafeWindow === window, así que ambos caminos son equivalentes.
      // API real verificada en consola: MM.getOnlyCollectionByName (no getCollectionType)
      const hasMM   = !!(uw.MM?.getOnlyCollectionByName || uw.uw?.MM?.getOnlyCollectionByName);
      const hasGame = !!(uw.Game?.player_id              || uw.uw?.Game?.player_id);

      if (hasMM || (hasGame && attempts > 4)) {
        if (!hasMM) {
          warn('MM.getOnlyCollectionByName not available — running in DOM-only mode');
        }
        init();
      } else if (attempts++ < GA.MAX_RETRIES) {
        setTimeout(check, GA.POLL_INTERVAL);
      } else {
        warn('Game namespace not found — running in DOM-only mode');
        init();
      }
    })();
  }

  waitForGame();

})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
