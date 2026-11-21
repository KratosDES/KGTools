# Evidencia: módulo de mensajes de Grepolis

Estructura observada en el HTML que el usuario copió de su sesión en ar107 el 2026-11-13. Leída del HTML; **nada de esto se ha probado en vivo desde un script**. No se guardan aquí nombres ni IDs de jugadores.

## 1. Lista de correos masivos

Pestaña `#message-massmail` de la ventana Mensajes.

- Contenedor: `ul#massmail_list`, un `li` por envío.
- Asunto: `.message_subject a`, con `onclick="w(this).sendMessage('messageView', <id>, 'view_massmail')"`.
- Destinatarios: `.message_date a`, con `onclick="w(this).sendMessage('messageView', <id>, 'view_massmail_recipients')"`.
- Fecha de envío: texto de `.message_date` (formato `el DD/MM/AA a la/s HH:MM`).
- ID del envío: también en `input[name="mass_mails[]"]`.
- Paginación: `controller: 'message'`, `action: 'massmail'`, `limit: 25`.

Un mismo boletín puede aparecer como varios envíos con el mismo asunto (uno por grupo).

## 2. Destinatarios de un envío

Vista que abre `view_massmail_recipients`. Es la fuente principal de participación.

- Contenedor: `#message_message_list`.
- Asunto del envío: texto de `.game_header`.
- Un `li` por destinatario dentro de `.message_post_container ul.game_list`.
- Estado: `div.message_status` con una segunda clase: `new` (no leído), `read` (leído) o `answered` (respondido).
- Jugador: `a.gp_player_link`. El texto es el nombre; el `href` es `#` seguido de un JSON en base64 con `name` e `id`.

Observaciones:

- El remitente no aparece en la lista de destinatarios.
- El ID del envío no aparece en esta vista; solo el asunto.
- El atributo `id` del `div` de estado se repite en cada fila, así que no sirve como selector único: usar la clase.
- El ID del jugador permite cruzar por ID en lugar de por nombre.

## 3. Bandeja de entrada

Pestaña `#message-index`. Sirve solo de contraste.

- Contenedor: `ul#message_list`, un `li.message_item` por hilo.
- Asunto: `.message_subject a`, con `sendMessage('messageView', <id>, 'view')`.
- Correo masivo: el hilo lleva `span.massmail` dentro del icono del asunto.
- Remitente: `.message_date a.gp_player_link` (mismo formato base64).
- Cada fila tiene dos iconos `span.message_icon` con clase `status_new`, `status_read` o `status_answered`: uno junto al asunto y otro junto a la fecha.
- Paginación: `controller: 'message'`, `action: 'index'`, `limit: 25`, `es_args.folder_id: 0`.
- Cada destinatario de un correo masivo genera un hilo propio con el mismo asunto.

### Carpetas

El usuario creó la carpeta `Boletines` para guardar las respuestas a los boletines.

- Carpeta abierta: su nombre es el texto de `#folder_toggle_menu .folder_icon_text`; su ID está en `input#message_form_folder_id` (`0` es la bandeja de entrada; `Boletines` tiene el `1` en esta cuenta y mundo).
- Otras carpetas: `#folder_menu_messages span.folder[name="folder_<id>"]`, con `onclick="w(this).sendMessage('messageChangeFolder', <id>)"`.
- La lista de hilos de una carpeta usa el mismo `ul#message_list` y las mismas filas que la bandeja de entrada.
- El ID de carpeta puede cambiar entre cuentas y mundos: identificar la carpeta por nombre, no por ID.

### Contraste con la vista de destinatarios

En la muestra del 2026-11-13, los remitentes de los hilos de la bandeja con el asunto del boletín y marca `span.massmail` coinciden exactamente con los destinatarios en estado `answered` del envío de ese grupo (10 de 10). Ningún destinatario en estado `read` tiene hilo en la bandeja. Es una sola muestra.

Hipótesis sin confirmar sobre los dos iconos: el del asunto sería el estado propio y el de la fecha el de la otra parte. Encaja con las filas observadas, pero no se ha comprobado.

## Pendiente de confirmar

- [ ] Qué significa cada uno de los dos iconos de estado de la bandeja de entrada (ver hipótesis arriba).
- [ ] Si un hilo de correo masivo solo llega a la bandeja cuando el destinatario responde, o también por otra causa.
- [ ] Qué significa el color de fondo de cada fila de la bandeja.
- [ ] Si estas vistas se pueden pedir con `gpAjax` (controlador `message`) y qué devuelven. En la red solo se observó `GET /game/message?action=default`.
- [ ] Contrastar con `lab/investigacion` si algún bot analizado lee el módulo de mensajes (regla LAB-FIRST).
