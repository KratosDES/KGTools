# Lógica de participación en boletines

Especificación de referencia, tomada del método actual en Google Sheets (Apps Script). La herramienta debe reproducir este comportamiento sin hojas de cálculo.

## Datos de origen

Un registro por boletín: un asunto y, para cada destinatario, un estado.

| Asunto    | MiembroA   | MiembroB   | MiembroC | MiembroD |
| --------- | ---------- | ---------- | -------- | -------- |
| Boletín 1 | Leído      | Respondido | Leído    | Sin leer |

Estados posibles: `Respondido`, `Leído`, `Sin leer`.

## Reglas

1. Se consulta un boletín por su asunto (coincidencia exacta tras normalizar).
2. Para cada miembro de la alianza se devuelve su estado en ese boletín.
3. Si el miembro no está entre los destinatarios, el estado es `No recibido`.
4. Si el asunto no existe, el resultado es `Boletín no encontrado`.
5. El orden de los destinatarios no importa.
6. Normalización de nombres y asuntos: Unicode NFC, espacio de no ruptura a espacio normal, espacios múltiples colapsados, recorte y minúsculas.
7. Se pueden consultar varios asuntos a la vez.

## Requisitos añadidos por el usuario (2026-11-13)

1. **Un boletín puede tener varios envíos masivos.** La alianza se divide en dos grupos y cada grupo recibe su propio envío con el mismo asunto. Los envíos con el mismo asunto se tratan como un solo boletín.
2. **Estado manual por miembro y boletín.** El estado que muestra el juego es el último del hilo, no el historial: si el remitente contesta a una respuesta y el miembro solo la lee, el hilo vuelve a verse como leído aunque el miembro ya había respondido. Por eso el estado de cada miembro en cada boletín debe poder cambiarse a mano.
3. El estado manual tiene prioridad sobre el leído del juego y una nueva lectura no lo sobrescribe.
4. Solo cuentan los mensajes cuyo asunto coincide con el del boletín enviado.

5. **La bandeja de entrada valida la respuesta.** Un hilo de correo masivo en la bandeja de entrada, con el asunto del boletín y un miembro como remitente, prueba que ese miembro respondió. Esa prueba no se pierde aunque el estado del destinatario vuelva después a leído.

6. **Carpeta `Boletines`.** El usuario mueve a esa carpeta los hilos de respuesta a los boletines. La validación de respuestas lee esa carpeta y también la bandeja de entrada, porque una respuesta nueva puede estar aún sin mover. En ambas se aplica el mismo filtro: asunto del boletín y marca de correo masivo.

## Resumen por boletín (mejora prevista)

Total de destinatarios, respondidos, leídos, sin leer y no recibidos.
