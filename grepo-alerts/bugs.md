# Bugs y pendientes — grepo-alerts

## Pendientes

- [ ] Confirmar si el botón silenciar 🔊❌ ya está disponible en producción (implementado en v0.2.3, toast de alarma).
  - Si falta: revisar si es un tema de auto-update no propagado.
  - Si está: ver si el usuario quiere un mute PERMANENTE (toggle en settings) en lugar del botón por-toast.

- [ ] **BUG: Alarma personalizada 02:00 se muestra como 14:00**
  - `_addCustomAlert()` crea el timestamp EN HORA LOCAL DEL BROWSER, pero `formatTime()` lo muestra usando `Game.player_timezone` (timezone del servidor).
  - Si la timezone del juego difiere de la del browser (ej. browser UTC-5, juego UTC+7), la hora mostrada no coincide con la ingresada.
  - Fix propuesto: en `_addCustomAlert()`, convertir HH:MM ingresada a la timezone del juego al crear el timestamp, en lugar de usar hora local del browser. O forzar `formatTime()` sin timezone para custom alarms.
  - Archivo: `grepo-alerts.user.js` — `formatTime()` línea ~106, `_addCustomAlert()` línea ~1639.

---

## Cerrados

*(ninguno por ahora)*
