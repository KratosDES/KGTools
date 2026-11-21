# Gestión de alianzas para Grepolis (grepo-alliance)

Herramienta hermana de [grepo-alerts](../../../Grepo-Smart-dev/tools/grepo-alerts/). Pensada para llevar el control de los miembros de una alianza y su participación (por ejemplo, la respuesta a los boletines), sin hojas de cálculo intermedias.

**Estado:** prototipo, canal beta (rama `beta`). Hay un script beta y uno estable independientes; no instales los dos a la vez. La lógica está probada con `test/core-harness.js`; la captura y el panel aún no se han probado dentro del juego.

## Instalación

El repositorio es privado, así que no hay enlace de instalación ni actualización automática. Copia el contenido de `grepo-alliance.user.js` en un script nuevo de Tampermonkey.

## Uso

La herramienta no pide nada al juego: solo lee las vistas de Mensajes cuando las abres.

1. Escribe el asunto en «Próximo boletín» y pulsa «Crear boletín» antes de enviarlo (primero actualiza los miembros de tus alianzas y guarda la lista de destinatarios). El registro de boletines muestra una fila por boletín; el último creado tiene activo el botón 📄 para copiar esa lista, una sola vez, aunque cierres y vuelvas a abrir la ventana. El registro tiene tamaño fijo y se pagina (5 por página). Al tocar una fila, el detalle del boletín (estados y ajustes manuales) se abre sobre la ventana principal; tocar la fila de nuevo o la ✕ lo recoge. Después abre Mensajes → Correo masivo y pulsa «Destinatario» en cada envío del boletín. Eso captura quién lo recibió, leyó o respondió. Un correo masivo cuyo asunto no se creó así se ignora (no cuenta como boletín).
2. Abre la carpeta Boletines (o la bandeja de entrada). Cada hilo de correo masivo con el asunto del boletín valida la respuesta de su remitente.
3. Pulsa el botón 🏛️ para ver la tabla por boletín, con su resumen.

En la tabla puedes fijar a mano el estado de un miembro; `Auto` vuelve al estado calculado. Los envíos con el mismo asunto se unen en un solo boletín. Los datos se guardan en el navegador, por mundo y jugador.

## Pruebas

```
node test/core-harness.js
```

## Alcance previsto

- Rol y postura de cada miembro (ofensiva, defensiva o mixta).
- Más funciones de gestión de la alianza.

Las reglas de participación están en [docs/participacion.md](docs/participacion.md) y la estructura observada del juego en [docs/evidencia-mensajes.md](docs/evidencia-mensajes.md).

## Reglas

Heredadas de Grepo-Smart (`AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`):

- Commits conventional, sin `Co-Authored-By` ni atribución a IA.
- Versión `0.X.Y` con letra de iteración durante el desarrollo; al release se quita la letra.
- `@version` y `GA.VERSION` siempre sincronizados.
- Cambios sustanciales con OpenSpec (`openspec/changes/<change>/`).
- LAB-FIRST: todo acceso a Grepolis cita su fuente del lab.
- Sin DOM extra con clases que el juego no conozca.
- Telemetría solo nivel B (ID de instalación aleatorio + mundo; sin ID de jugador ni IP).
- Se promueve a KGTools solo cuando esté lista (ver `CONTRIBUTING.md`).

## Versión

v0.1.1a
