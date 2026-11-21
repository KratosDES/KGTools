# Bugs y pendientes — grepo-alliance

## Pendientes

- [ ] Probar la 0.1.1a dentro del juego: icono en Tampermonkey, captura de «Destinatario», captura de la carpeta Boletines, panel y estado manual.
- [ ] Probar en el juego el bloque «Próximo boletín» (0.1.1a): descarga de `/data/players.txt` y `alliances.txt`, lista separada por `;`, y que el campo «Para» del correo masivo la acepte.
- [ ] Enemigos y miembros sin capturar se añaden a mano; falta leer pactos y enemigos del juego (no hay evidencia del lab).
- [ ] Crear el cambio OpenSpec inicial (`openspec/changes/grepo-alliance-foundation/`); la 0.1.0b se hizo solo con `docs/`.
- [ ] Contrastar con `lab/investigacion` si algún bot analizado lee el módulo de mensajes (LAB-FIRST).
- [ ] Un miembro que sale de la alianza sigue en la lista: no hay forma de quitarlo.
- [ ] Una respuesta se cuenta por asunto y marca de correo masivo. Un correo masivo de otro jugador con el mismo asunto se contaría como respuesta.
- [ ] Probar en el juego (0.1.1a) que un envío masivo con otro asunto ya no aparece como boletín, y que los boletines guardados antes (B1, B2) siguen completándose.
- [ ] Probar en el juego (0.1.1a) que «Crear boletín» actualiza los miembros antes de copiar la lista (nota «Boletín creado (N miembros cargados)») y que, si la descarga falla, usa la última lista guardada.
- [ ] Probar en el juego (0.1.1a) el registro de boletines: botón 📄 solo en el último creado, copia la lista guardada, se desactiva tras copiar, sigue igual al cerrar y reabrir la ventana, y no se desactiva si el portapapeles falla.
- [ ] Probar en el juego (0.1.1a) el registro y el detalle: el registro tiene tamaño fijo (5 por página) con paginación ◀ ▶; los asuntos no se parten (se cortan con «…» y el título completo sale al pasar el cursor); no hay ningún boletín seleccionado al abrir; tocar una fila abre el detalle sobre la ventana principal, y tocarla de nuevo o la ✕ lo recoge; el detalle sigue a la ventana al arrastrarla.
- [ ] Tras probar la 0.1.1a, subir a v0.1.3 estable y beta como GrepoAlerts (pendiente de la prueba del usuario).
- [ ] Rol y postura por miembro.
- [ ] Puntos sin confirmar de `docs/evidencia-mensajes.md`.

---

## Cerrados

- [x] 0.1.1a: registro de tamaño fijo con paginación, asuntos sin partir, sin selección por defecto, y detalle que se abre hacia dentro de la ventana (no al costado) y se recoge al tocar la fila o la ✕. Reemplaza el detalle lateral de la 0.1.0q. Falta confirmarlo en el juego.
- [x] 0.1.0q: el detalle del boletín sale como ventana a la derecha de la principal (con ✕), en vez de alargar la vista hacia abajo. Falta confirmarlo en el juego (que no tape el juego, que siga a la ventana al arrastrarla y que se cierre bien).
- [x] 0.1.0p: registro de boletines tipo grilla; «Crear boletín» guarda los destinatarios y el botón 📄 del último boletín los copia una vez. Falta confirmarlo en el juego.
- [x] 0.1.0o: «Crear boletín» ahora actualiza los miembros de las alianzas (descarga de players.txt y alliances.txt, si lo guardado tiene más de 1 minuto) antes de armar la lista de destinatarios. Falta confirmarlo en el juego.
- [x] 0.1.0n: todo correo masivo capturado se tomaba como boletín. Ahora solo cuentan los creados con «Crear boletín» y los ya guardados; el resto se ignora. Falta confirmarlo en el juego.
