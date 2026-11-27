# Bugs y pendientes — grepo-alerts

Última revisión: 2026-11-27 (estable 0.3.4, beta 0.3.4a).

## Pendientes

- [ ] **Verificar en el juego.** Lo siguiente está corregido en el código y cubierto por pruebas, pero no se ha probado en el juego:
  - Hora exacta en la zona horaria del juego (GA-003).
  - Registro del mismo movimiento desde la vista normal y la premium sin duplicados (GA-001).
  - Nombres Ataque, Espionaje y Conquista; recurso «plata» en los transportes.
  - Sonido tras recargar la página y botón «Limpiar historial» (GA-008).
  - Ventana de consentimiento europeo (GA-007).
- [ ] **Etiqueta «(retorno)» en transportes.** Depende de la clase `returning` del icono de la lista de comercio. Falta confirmar con filas reales qué significa en un transporte entre ciudades propias.
- [ ] **Retornos de tropas entre vistas.** La vista premium los llama `return_own_units` y la normal los ve como apoyo o ataque con `returning`, así que registrar el mismo retorno desde ambas vistas aún lo duplica.
- [ ] **Filas sin icono reconocido.** Caen en el registro genérico con id aleatorio: se etiquetan «Transporte» y no se deduplican.

## Cerrados

- [x] **Alarma personalizada 02:00 se mostraba como 14:00** (0.3.3a). La hora exacta se interpreta en la zona horaria del juego. Prueba: `test/custom-time-harness.js`.
- [x] **Campana de la lista de comercio sin «Ya registrado»** (0.3.3d). Id estable por transporte y tramo. Prueba: `test/trade-row-harness.js`.
- [x] **Ataque y espionaje etiquetados «Transporte»; «hierro» en vez de «plata»** (0.3.3e). Tipo leído de las clases del icono. Pruebas: `test/movement-icon-harness.js`, `test/trade-resources-harness.js`.
- [x] **Conquista con colono duplicada entre la vista normal y la premium** (0.3.3f y 0.3.3g). Etiqueta «Conquista» y coincidencia por hora (±3 s) y ciudad. Prueba: `test/cross-view-dedup-harness.js`.
- [x] **Mute (GA-004).** Decisión del dueño: 🔇 solo corta la alarma que suena y la configuración «Sonido» es el silencio permanente. Sin cambios de código; el botón 🔊❌ del toast ya no existe.
