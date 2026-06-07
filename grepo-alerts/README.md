# GrepoAlerts — Rastreador de Movimientos

> Versión: 0.1.0 (MVP)
> Tipo: TamperMonkey userscript
> Compatibilidad: Chrome, Firefox, Edge, Brave (con TamperMonkey)

---

## ¿Qué hace?

GrepoAlerts te notifica exactamente cuando un movimiento del juego finaliza.
Vos elegís qué rastrear — el sistema hace el resto.

**Sin automatización. Solo notificaciones.**

### Casos de uso

- Enviaste recursos a 5 ciudades distintas → notificarte cuando llegue el último
- Tenés un ataque saliendo en 2h y no querés tener Grepolis abierto mirando el reloj
- Construyendo un edificio con 45 min restantes → seguir con otra cosa y recibir el aviso

---

## Instalación

1. Instalá [TamperMonkey](https://www.tampermonkey.net/) en tu navegador
2. Abrí el dashboard de TamperMonkey → "Crear nuevo script"
3. Pegá el contenido de `grepo-alerts.user.js`
4. Guardá (`Ctrl+S`)
5. Entrá a Grepolis — el ícono 🔔 aparece en la esquina inferior derecha

---

## Uso

### Registrar un movimiento

1. Abrí el panel de movimientos/comandos en el juego
2. Cada fila con temporizador muestra un ícono 🔔 tenue
3. Hacé click en el 🔔 → queda activo (animación de campana)
4. GrepoAlerts notificará cuando ese movimiento termine

### Ver alertas activas

- Click en el FAB 🔔 (esquina inferior derecha)
- Tab **Activas**: movimientos pendientes con countdown en tiempo real
- Tab **Historial**: movimientos ya notificados
- Tab **Config**: activar/desactivar tipos de notificación

### Notificaciones disponibles

| Tipo | Descripción |
|------|-------------|
| 🔊 Sonido | Tono doble via Web Audio API |
| 📋 Visual | Toast overlay dentro del juego |
| 💬 Navegador | Notificación nativa del SO (requiere permiso) |

---

## Arquitectura

```
grepo-alerts.user.js (single file MVP)
│
├── Utils         — helpers (parseTimer, formatRelative, uid)
├── EventBus      — pub/sub interno desacoplado
├── Storage       — localStorage con expiración automática
├── GameAccess    — wrapper uw.MM (Backbone collections)
├── Parser        — extrae datos de modelos + fallback DOM
├── Tracker       — gestiona alertas, schedula timers
├── Notifications — visual / audio / browser
└── UI            — FAB, Panel, Bell buttons, MutationObserver
```

### Estrategia de detección de movimientos

**Prioridad 1 — Game models (uw.MM)**
```javascript
// Accede directamente a las colecciones Backbone del juego
uw.MM.getCollectionType('Commands')      // ataques, apoyos, retornos
uw.MM.getCollectionType('BuildingBuildDatas') // cola de construcción
uw.MM.getCollectionType('UnitOrders')    // reclutamiento
```
Los modelos tienen timestamps `arrive_at`/`finished_at` directos — más confiables que parsear texto.

**Prioridad 2 — DOM fallback**
Si el modelo no está disponible, parsea el timer del elemento DOM:
- Atributo `data-end-at` (timestamp Unix)
- Texto `HH:MM:SS` o `MM:SS` → calcula timestamp relativo

**Bell injection vía MutationObserver**
Observa `#main_area` para detectar nuevas filas con timers. Inyecta el botón 🔔 sin modificar el comportamiento del juego.

### Persistencia

```javascript
// Key: grepo_alerts_{world_id}_{player_id}
// Estructura:
{
  alerts: [
    {
      id: "cmd_12345",        // único por movimiento
      modelId: 12345,         // ID en colección Backbone (si disponible)
      type: "attack",
      source: "Commands",
      icon: "⚔️",
      label: "Ataque → Atenas",
      townId: 388,
      tsMs: 1748390400000,    // timestamp Unix en ms
      status: "pending"|"notified",
      trackedAt: 1748386800000
    }
  ],
  settings: {
    soundEnabled: true,
    visualEnabled: true,
    browserEnabled: true,
    earlyMs: 0
  }
}
```

Alertas se auto-limpian después de 24h.
Al recargar la página, los timers pendientes se restauran automáticamente.

---

## Roadmap

### v0.2 — Mejoras de detección
- [ ] Soporte explícito para Farm Town timers
- [ ] Soporte para ventana de apoyos/retornos
- [ ] Detección por Backbone events (no solo polling DOM)
- [ ] Label editable al registrar alerta

### v0.3 — Notificaciones avanzadas
- [ ] Notificación X minutos antes del evento
- [ ] Agrupación de alertas similares
- [ ] Discord webhook (opcional, por usuario)

### v0.4 — Multi-ciudad
- [ ] Vista por ciudad en el panel
- [ ] Auto-track all buildings/units (modo agresivo opt-in)

### v1.0 — Extensión Chrome nativa
- [ ] Migrar a Chrome Extension MV3 (igual que JamBot)
- [ ] `chrome.alarms` para timers más confiables que setTimeout
- [ ] Persistent background service worker

---

## Limitaciones conocidas (MVP)

- `setTimeout` en tab inactiva puede ser throttleado por el browser (hasta 1 min de delay)
  → Solución futura: `chrome.alarms` API en extensión MV3
- Si el juego actualiza sus selectores CSS, la bell injection puede fallar
  → Fallback DOM parser sigue funcionando si hay atributos `data-end-at`
- Permisos de Notificación del navegador requieren interacción del usuario para solicitarse

---

*GrepoAlerts no automatiza ninguna acción. Es una herramienta de monitoreo puro.*
