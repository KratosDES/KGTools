# GrepoAlerts — Mejoras Pendientes

## M-001: Botón de silenciar alarma en toast

**Prioridad:** Alta
**Módulo:** `notifications` (toast + sound)
**Estado:** ✅ Implementado (v0.2.1)

### Descripción

Cuando suena una alarma (toast + sonido), agregar un **ícono pequeño de parlante 🔊 con una X roja ❌** sobre el toast para silenciar la alarma **inmediatamente** y evitar que el ciclo de sonido termine.

### Comportamiento actual

El sonido actual (`notifications.sound()`) reproduce 3 secuencias de 8 beeps con pausas intermedias:

```
[beep×8] → pausa 0.8s → [beep×8] → pausa 0.8s → [beep×8]
```

No hay forma de cancelar una vez que el ciclo de Web Audio comenzó. El usuario debe esperar a que termine (~3-4 segundos).

### Comportamiento propuesto

1. Al aparecer el toast, mostrar un ícono 🔊 + ❌ roja pequeña en la esquina superior derecha
2. Al hacer click en la ❌:
   - **Detener el sonido inmediatamente** (cancelar todos los `oscillator` pendientes)
   - **Cerrar el toast** (misma acción que la X actual)
   - **NO marcar la alerta como "notified"** — la alerta permanece en "pending" para que el usuario decida qué hacer
3. Si el usuario NO hace click, el ciclo de sonido continúa normalmente

### Implementación técnica

#### 1. Cancelación de sonido

El método `notifications.sound()` crea oscillators inline sin guardar referencias. Se necesita:

```javascript
// Agregar al módulo notifications
_soundTimers: [],    // handles de setTimeout pendientes
_oscillators: [],    // osciladores activos (para poder detener)

sound() {
  // ...existing code...
  // Guardar referencia a cada oscilador y su handle
  // para poder cancelar con this.stopSound()
},

stopSound() {
  // Cancelar todos los setTimeout pendientes
  this._soundTimers.forEach(h => clearTimeout(h));
  this._soundTimers = [];

  // Detener todos los osciladores activos
  this._oscillators.forEach(osc => {
    try { osc.stop(); } catch {}
  });
  this._oscillators = [];
}
```

#### 2. Toast con botón de silenciar

En `notifications.toast()`, modificar el HTML del toast:

```javascript
el.innerHTML = `
  <span class="ga_toast_icon">${GA.utils.esc(alert.icon)}</span>
  <div class="ga_toast_body">
    <div class="ga_toast_title">Movimiento completado</div>
    <div class="ga_toast_msg">${GA.utils.esc(alert.label)}</div>
  </div>
  <button class="ga_toast_mute" aria-label="Silenciar" title="Silenciar alarma">🔊❌</button>
  <button class="ga_toast_close" aria-label="Cerrar">×</button>
`;
```

#### 3. CSS del botón de silenciar

```css
.ga_toast_mute {
  background: none;
  border: 1px solid var(--ga-red);
  color: var(--ga-red);
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  padding: 2px 4px;
  border-radius: 3px;
  flex-shrink: 0;
  transition: background .15s;
}
.ga_toast_mute:hover {
  background: rgba(231, 76, 60, .2);
}
```

#### 4. Event handler

```javascript
el.querySelector('.ga_toast_mute').onclick = () => {
  GA.notifications.stopSound();   // Detener sonido inmediatamente
  el.remove();                     // Cerrar toast
  // NO cambiar status — la alerta queda "pending"
};
```

### Flujo de usuario

```
Timer llega a 0
  → Toast aparece con 🔊 + ❌ + ×
  → Sonido comienza a sonar

Opción A: Usuario NO hace nada
  → Ciclo de sonido termina (~4s)
  → Toast se cierra solo (8s)
  → Alerta pasa a "notified"

Opción B: Usuario hace click en ❌ (silenciar)
  → Sonido se detiene AL INSTANTE
  → Toast se cierra
  → Alerta permanece "pending" (puede re-schedulear o eliminar)
```

### Notas de implementación

- Web Audio API: `oscillator.stop()` es la forma correcta de detener un tono en curso
- No confundir con el botón × existente (cierra toast pero no detiene sonido)
- El botón 🔊❌ solo aparece cuando `soundEnabled` está activo
- Mantener la X roja como estilo consistente con la paleta de colores del módulo (`--ga-red: #e74c3c`)

---

*Documento creado: 2026-06-09*
*Versión GrepoAlerts actual: v0.2.0*
