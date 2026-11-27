# Alertas para Grepolis (grepo-alerts)

Userscript que avisa con alarma sonora, aviso visual y notificación del navegador cuando termina un movimiento, una construcción, un reclutamiento o un temporizador propio en Grepolis. No automatiza ninguna acción del juego.

## Instalación

1. Instala [Tampermonkey](https://www.tampermonkey.net/) en tu navegador.
2. Abre el enlace de uno de los dos canales; Tampermonkey ofrecerá instalarlo:
   - **Estable** (recomendado): [grepo-alerts.user.js](https://raw.githubusercontent.com/KratosDES/KGTools/main/grepo-alerts/grepo-alerts.user.js)
   - **Beta** (prueba de novedades, puede tener errores): [grepo-alerts.user.js](https://raw.githubusercontent.com/KratosDES/KGTools/beta/grepo-alerts/grepo-alerts.user.js)
3. Las actualizaciones se aplican solas vía `@updateURL`. Para forzarlas: Tampermonkey → Utilidades → Buscar actualizaciones de userscripts.

Instala **un solo canal**. Si están los dos, el segundo en cargar se detiene y avisa cuál está activo.

## Uso

- **Botón flotante** en la pantalla del juego: abre el panel con tus alertas, el historial y la configuración.
- **Registro automático** de ataques y apoyos que llegan a tus ciudades.
- **Campanas 🔔** junto a la hora de cada movimiento, para registrarlo a mano. Funcionan en la lista de movimientos de la barra, en la lista de comercio y en el visor de órdenes premium. Ataque, espionaje, apoyo, conquista con colono, transporte y retornos se muestran con su nombre. Si el movimiento ya estaba registrado, la campana lo indica con «Ya registrado».
- **Alertas personalizadas** por cuenta regresiva o por hora exacta. La hora exacta se interpreta en la zona horaria del juego, no en la de tu navegador.
- **Aviso al cumplirse:** alarma sonora, aviso visual y, si lo activas, notificación del navegador. Por defecto avisa 3 segundos antes; el margen se cambia en la configuración.
- **Silenciar:** el botón 🔇 del botón flotante corta solo la alarma que está sonando; las siguientes sonarán normalmente. El interruptor «Sonido» de la configuración desactiva el sonido de forma permanente.
- **Historial:** el botón «Limpiar historial» elimina solo las alertas que ya avisaron.

## Estadísticas anónimas

La herramienta cuenta, de forma anónima, qué funciones se usan (sin tu id de jugador y sin guardar tu IP). En usuarios de Europa se pide consentimiento la primera vez; hasta aceptar, no se envía nada. Se puede detener desde la configuración. Detalle en la [política de privacidad](https://kratosdes.github.io/KGTools/privacy/).

## Versión

La versión vigente está en el `@version` de [grepo-alerts.user.js](grepo-alerts.user.js) y se muestra en el encabezado del panel. Las versiones en desarrollo llevan una letra (`0.3.4a`, `0.3.4b`…); al publicarse como estables, la pierden.

## Desarrollo

Pruebas, desde esta carpeta:

```
node --check grepo-alerts.user.js
node test/telemetry-harness.js
node test/channel-guard-harness.js
node test/history-clear-harness.js
node test/custom-time-harness.js
node test/trade-row-harness.js
node test/trade-resources-harness.js
node test/movement-icon-harness.js
node test/cross-view-dedup-harness.js
```
