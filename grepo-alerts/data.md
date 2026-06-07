# GrepoAlerts — Documentación de desarrollo

> Archivo generado el 2026-06-07. Consolida todo el conocimiento acumulado en sesiones de desarrollo,
> tests en consola validados en el juego real, y el historial de versiones del script.

---

## 1. Contexto del proyecto

**GrepoAlerts** es un userscript para TamperMonkey que rastrea movimientos del juego Grepolis
(tratos comerciales, ataques, apoyos, construcciones, reclutamientos) y notifica al jugador
cuando terminan. Sin automatización de acciones — solo monitoreo.

- **Archivo principal**: `Grepo-Smart-coder/tools/grepo-alerts/grepo-alerts.user.js`
- **Versión actual**: 0.1.9
- **Juego objetivo**: ar100.grepolis.com (servidor AR, mundo ar100)
- **Timezone del servidor**: `America/Argentina/Buenos_Aires` (UTC-3, `server_gmt_offset: -10800`)

---

## 2. Arquitectura del script

```
IIFE (single-file TamperMonkey)
│
├── Utils          → parseTimer, formatRelative, formatTime, uid, esc
├── EventBus       → pub/sub desacoplado entre módulos
├── Storage        → localStorage por world+player, expiración 24h
├── GameAccess     → wrapper sobre MM.getOnlyCollectionByName()
├── Parser         → transforma modelos Backbone o DOM en objetos Alert
├── Tracker        → ciclo de vida: track → schedule → notify
├── Notifications  → sonido (Web Audio) + toast visual + browser notification
├── UI             → FAB + Panel + Bell injection + MutationObserver
└── Bootstrap      → waitForGame() → polling hasta MM disponible → init()
```

### Módulo GameAccess — API real verificada

```javascript
// API real de Grepolis (NO getCollectionType — eso es de bots externos)
MM.getOnlyCollectionByName('Trade')    // colección de trades
MM.getOnlyCollectionByName('Attack')   // colección de ataques
MM.getOnlyCollectionByName('Support')  // colección de apoyos
MM.getOnlyCollectionByName('BuildingBuildData')  // cola de construcción
MM.getOnlyCollectionByName('UnitOrder')          // cola de reclutamiento

// Acceso al modelo
col.models[0].attributes.arrival_at   // Unix segundos — timestamp exacto de llegada
col.models[0].id                       // coincide con data-id del DOM
```

### Objeto Alert normalizado

```javascript
{
  id:        'cmd_413870' | 'bld_...' | 'unit_...' | 'dom_...' | 'custom_...',
  type:      'transport' | 'attack' | 'support' | 'building' | 'unit' | 'custom' | ...,
  icon:      '📦' | '⚔️' | '🛡️' | '🏗️' | '🗡️' | '📝' | ...,
  label:     'Transporte → Ciudad de spam 2',
  tsMs:      1780498409000,   // Unix ms — timestamp de llegada
  status:    'pending' | 'notified',
  trackedAt: Date.now(),
  source:    'Trade' | 'Attack' | 'Support' | 'BuildingBuildData' | 'UnitOrder' | 'DOM' | 'custom',
  modelId:   413870,          // id del modelo Backbone (si viene de Backbone)
  townId:    ...,
  resources: 'madera:22500'   // solo para trades
}
```

---

## 3. DOM del juego — hallazgos validados en consola

### Dropdown de trades (toolbar)

```html
<!-- Contenedor — display:none por defecto, display:block en hover sobre el ícono -->
<div id="toolbar_activity_trades_list" style="display: none;">
  <div class="content js-dropdown-item-list">
    <div class="item trade option even selected" data-id="413962">
      <div class="icon trade_icon res returning">...</div>
      <div class="time">00:05:33</div>   <!-- countdown relativo — NO usar para timestamp -->
      <div class="town_link"><a title="100A0-Qarth" class="gp_town_link">...</a></div>
    </div>
  </div>
</div>
```

**Observaciones clave**:
- El elemento existe en DOM **aunque esté oculto** (display:none)
- El `data-id` del div coincide con `model.id` en la colección Backbone
- `div.time` tiene texto relativo (countdown) — impreciso para scheduling
- El timestamp exacto viene de `model.attributes.arrival_at` (segundos Unix)
- El popup de hover (`#popup_content`) muestra "Llegada: HH:MM:SS" pero está **vacío sin hover**

### Popup de hover

```html
<table id="popup_div" style="display: none;">
  <td id="popup_content">
    <div><img src="wood.png"> 22500 <br>Llegada: 12:00:36</div>
  </td>
</table>
```

### Indicadores de la toolbar (patrón NaKamize)

```javascript
// Confirmados en consola — donde el juego muestra actividad
'.activity.attack_indicator'   // ataques entrantes
'.activity.trades'             // trades activos
'.activity.commands'           // comandos generales
// Selector completo:
document.querySelector('#ui_box .tb_activities .activity.trades')
```

### Timezone del servidor

```javascript
// Campos confirmados en el objeto Game del juego
Game.player_timezone    // "America/Argentina/Buenos_Aires"
Game.server_gmt_offset  // -10800 (UTC-3 en segundos)
Game.server_time        // Unix timestamp actual del servidor

// Formatear hora igual que el juego (CORRECTO)
new Intl.DateTimeFormat([], {
  timeZone: Game.player_timezone,
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
}).format(new Date(arrival_at * 1000))
// → "11:56:25" (igual al juego)

// NO usar (INCORRECTO — usa timezone del OS)
new Date(arrival_at * 1000).toLocaleTimeString()
// → "9:53:29" (2 horas de diferencia)
```

---

## 4. Tests de consola validados

### Test completo de diagnóstico

```javascript
// Ejecutar con un trade activo en el juego
var t = document.getElementById('toolbar_activity_trades_list');
var col = MM.getOnlyCollectionByName('Trade');
var m = col?.models?.[0];
var a = m?.attributes;
console.log('=== DOM ===');
console.log('contenedor:', !!t, '| display:', t?.style.display);
console.log('items:', document.querySelectorAll('div.item[data-id]').length);
console.log('timers:', document.querySelectorAll('div.item[data-id] .time').length);
console.log('=== MODELO ===');
console.log('modelos en Trade:', col?.models?.length);
console.log('arrival_at:', a?.arrival_at);
console.log('hora llegada:', a?.arrival_at ? new Date(a.arrival_at * 1000).toLocaleTimeString() : 'N/A');
console.log('data-id DOM:', document.querySelector('div.item[data-id]')?.dataset?.id);
console.log('id modelo:', m?.id);
console.log('coinciden:', String(m?.id) === document.querySelector('div.item[data-id]')?.dataset?.id);
```

**Resultados obtenidos**:
- `contenedor: true | display: none` ✓
- `items: 1 | timers: 1` ✓
- `modelos en Trade: 1` ✓
- `arrival_at: 1780498409` ✓
- `hora llegada (toLocaleTimeString): 9:53:29` ← INCORRECTO (timezone OS)
- `coinciden: true` ✓ (data-id DOM = model.id Backbone)

### Test timezone

```javascript
Object.keys(Game).filter(k =>
  k.toLowerCase().includes('time') ||
  k.toLowerCase().includes('zone') ||
  k.toLowerCase().includes('offset')
)
// → ["locale_gmt_offset", "map_chunks_poll_time", "player_timezone",
//    "server_gmt_offset", "server_time", "unit_build_time_reduction", ...]

console.log('server_gmt_offset:', Game.server_gmt_offset); // -10800
console.log('player_timezone:', Game.player_timezone);      // America/Argentina/Buenos_Aires
console.log('server_time:', Game.server_time);              // 1780498263
```

### Test hora correcta

```javascript
var arrival_at = MM.getOnlyCollectionByName('Trade')?.models?.[0]?.attributes?.arrival_at;
console.log(new Intl.DateTimeFormat([], {
  timeZone: Game.player_timezone,
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
}).format(new Date(arrival_at * 1000)))
// → "11:56:25" ✓ coincide con lo que muestra el juego
```

### Test observer manual (para debug)

```javascript
// Verificar si el observer del dropdown funciona
var t = document.getElementById('toolbar_activity_trades_list');
var obs = new MutationObserver(() => console.log('CAMBIÓ display:', t.style.display));
obs.observe(t, { attributes: true, attributeFilter: ['style'] });
console.log('observer listo — ahora hover sobre trades');
// → al hacer hover: "CAMBIÓ display: block"
```

### Test versión y estado del script

```javascript
var GA = GrepoAlerts;
console.log('versión:', GA.VERSION);
console.log('dropdown visible:', document.getElementById('toolbar_activity_trades_list')?.style.display);
console.log('items en DOM:', document.querySelectorAll('div.item[data-id]').length);
console.log('campanas inyectadas:', document.querySelectorAll('.ga_bell').length);
```

---

## 5. Selectores CSS relevantes

```javascript
// CANDIDATE_SELECTORS — filas que reciben campana 🔔
'tr.trow1', 'tr.trow2',
'.command_list_entry', '.movement_slot', '.command_row',
'.js-command-item', '.building_order', '.order_item',
'.unit_order', '.troop_slot',
'div.item[data-id]'   // ← trades/attacks/supports en toolbar dropdown

// TIMER_SELECTOR — detecta si una fila tiene timer
'[data-end-at]', '[data-time-until]', '[data-countdown]',
'.timer_watch', '.countdown', '.eta',
'.slot_action_small_container',
'.time'   // ← clase usada en toolbar_activity_trades_list items
```

---

## 6. Historial de versiones

| Versión | Cambios |
|---------|---------|
| 0.1.0 | Versión inicial — arquitectura modular, observer sobre toolbar indicators |
| 0.1.1 | Agregado `div.item[data-id]` a CANDIDATE_SELECTORS, `.time` a TIMER_SELECTOR, `.time` a fromRow |
| 0.1.2 | `formatTime` usa `Game.player_timezone` (Intl.DateTimeFormat) en vez de `toLocaleTimeString`. Observer en `document.body` para `#toolbar_activity_trades_list` (elemento creado lazily por el juego) |
| 0.1.3 | Observer corregido: usa subtree en body para capturar el elemento aunque no exista al init |
| 0.1.4 | AudioContext creado en primer click del FAB (evita prompt de autoplay). Notificaciones del navegador: permiso solo al activar toggle en Config |
| 0.1.5 | `sound()`: si ctx suspended → `resume().then(play)` ← generaba prompt de autoplay, deprecado en 0.1.6 |
| 0.1.6 | Sonido: AudioContext inicializado en click del FAB, `sound()` solo toca si `_ctx` existe. Versión visible en header del panel |
| 0.1.7 | `browserEnabled` y `autoplayEnabled` OFF por defecto. Sonido: alarma repetitiva (8 beeps × 3 repeticiones, onda cuadrada 1050/880 Hz). Control de volumen (slider) en Config. Toggle Autoplay en Config |
| 0.1.8 | Panel muestra hora real de llegada ("Llega: HH:MM"). Control MM:SS en Config para avisar antes. Sonido repite 3 veces con pausa |
| 0.1.9 | Tipo `custom` agregado. Botón "＋ Alerta personalizada" en tab Activas. Formulario con texto libre + hora exacta (HH:MM, auto-rollover al día siguiente) o cuenta regresiva (HH:MM:SS) |

---

## 7. Configuración guardada en localStorage

```javascript
// Key: grepo_alerts_{worldId}_{playerId}
{
  alerts: [
    {
      id, type, icon, label, tsMs, status, trackedAt,
      source, modelId, townId, resources
    }
  ],
  settings: {
    soundEnabled:    true,
    visualEnabled:   true,
    browserEnabled:  false,   // OFF por defecto
    autoplayEnabled: false,   // OFF por defecto
    volume:          0.6,
    earlyMs:         0        // ms antes del evento para notificar
  }
}
```

---

## 8. Pendientes / próximos pasos

- [ ] Validar soporte a ataques entrantes (`toolbar_activity_attack_list` — investigar ID real)
- [ ] Validar soporte a apoyos (`toolbar_activity_commands_list` — investigar ID real)
- [ ] Investigar si attacks/supports usan la misma estructura `div.item[data-id]` + `div.time`
- [ ] Probar con múltiples trades simultáneos
- [ ] Soporte multi-ciudad (actualmente rastrea ciudad activa al momento del hook)
- [ ] Exportar/importar configuración

---

## 9. Gotchas y lecciones aprendidas

1. **`toLocaleTimeString()` sin timezone** → hora del OS, no del servidor. Siempre usar `Game.player_timezone`.
2. **`#toolbar_activity_trades_list` creado lazily** → no existe al init del script. Observer debe ser en `document.body` con subtree, no directamente sobre el elemento.
3. **`div.time` tiene countdown relativo** (texto "00:05:33") → NO usar para timestamp. Usar `arrival_at` del modelo Backbone.
4. **AudioContext y autoplay policy** → crear solo dentro de un gesto del usuario (click del FAB o toggle de Autoplay en Config). `resume()` sin gesto dispara prompt del navegador.
5. **`MM.getOnlyCollectionByName`** es la API real. `getCollectionType` es convención de bots externos, no funciona.
6. **El modelo Backbone está disponible sin hover** → `MM.getOnlyCollectionByName('Trade').models` siempre accesible, no necesitás abrir el dropdown.
7. **`data-id` del DOM = `model.id` del Backbone** → usar para lookup exacto del modelo sin iterar texto del DOM.
8. **`display:none` en el dropdown NO impide `querySelectorAll`** → los elementos son encontrables aunque el contenedor esté oculto.
