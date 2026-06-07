# KGTools — Caja de herramientas para Grepolis

> Carpeta actual: `Grepo-Smart-coder/tools/`
> Nombre del proyecto: **KGTools** (Grepolis Knowledge Tools)
> Fecha: 2026-06-07

---

## 1. Concepto

**KGTools** es una caja de herramientas de calidad de vida (QoL) para jugadores de Grepolis.
Nace del laboratorio de análisis del ecosistema Grepolis dentro del proyecto Grepo-Smart.

La premisa central es simple: **el jugador siempre decide, la herramienta nunca actúa sola.**

Cada herramienta en KGTools es:
- **Independiente** — funciona sola, sin depender de otras herramientas del kit
- **Modular** — se instala y desinstala sin efectos colaterales
- **Local** — sin servidores externos, sin telemetría, sin cuentas
- **Auditables** — código abierto, legible, sin ofuscación

---

## 2. Filosofía

### Sin automatización
KGTools no ejecuta acciones en nombre del jugador. No envía tropas, no comercia recursos,
no confirma ventanas del juego. Solo observa, informa y notifica.

Esta línea es intencional y no negociable. La diferencia entre una herramienta QoL y un bot
es exactamente esa: el humano siempre tiene la última acción.

### Construido desde el laboratorio
Cada herramienta surge de un proceso de investigación real:
1. Análisis de extensiones existentes en el ecosistema (NaKamize, GrepoPlus, RealAdmin, etc.)
2. Laboratorio de tráfico de red (HAR, endpoints reales)
3. Inspección del DOM y APIs internas del juego (MM, Backbone)
4. Validación en consola antes de codificar
5. Desarrollo iterativo con tests en el juego real

### Stack técnico
- **Formato**: UserScript (TamperMonkey) — single-file IIFE, sin bundler
- **Lenguaje**: JavaScript ES2020+
- **Persistencia**: `localStorage` por mundo+jugador
- **Notificaciones**: Web Audio API + DOM toasts + browser Notification API
- **Acceso al juego**: `MM.getOnlyCollectionByName()` (Backbone collections)

---

## 3. Estructura de la caja de herramientas

```
tools/                          ← KGTools raíz
│
├── data.md                     ← este archivo — concepto y estado general
│
├── grepo-alerts/               ← Herramienta 1: rastreador de movimientos
│   ├── grepo-alerts.user.js    ← script TamperMonkey instalable
│   └── data.md                 ← documentación técnica completa
│
└── [próximas herramientas]/
```

---

## 4. Herramientas actuales

### GrepoAlerts — Rastreador de Movimientos
**Estado**: MVP funcional ✅ | **Versión**: 0.1.9

Rastrea movimientos del juego (tratos, ataques, apoyos, construcciones, reclutamientos)
y notifica al jugador cuando terminan mediante sonido, toast visual y/o notificación del navegador.

**Características**:
- Detección automática desde colecciones Backbone del juego
- Alarm type sound (8 beeps × 3 repeticiones, onda cuadrada)
- Control de volumen y aviso anticipado (MM:SS configurable)
- Hora de llegada real en timezone del servidor del juego
- Alertas personalizadas (texto libre + hora exacta o cuenta regresiva)
- Persistencia entre recargas via localStorage
- Panel flotante con tabs: Activas / Historial / Config

**Ver**: [grepo-alerts/data.md](./grepo-alerts/data.md)

---

## 5. Herramientas en radar (ideas / investigación pendiente)

| Nombre tentativo | Concepto | Prioridad |
|-----------------|----------|-----------|
| **KGMap** | Overlay en el mapa mundial con información de alianzas, distancias y rutas | Media |
| **KGFarm** | Visualizador de status de granjas — sin auto-colectar | Media |
| **KGSpy** | Historial de informes de espionaje con análisis de tendencias | Baja |
| **KGCulture** | Contador de puntos de cultura y predictor de próxima ranura | Baja |
| **KGBuild** | Calculadora de orden de construcción óptimo por objetivo | Baja |

> Estas son ideas en radar, no compromisos. Cada una requiere su propio laboratorio
> antes de comenzar el desarrollo.

---

## 6. Relación con el proyecto Grepo-Smart

**Grepo-Smart** es el proyecto paraguas de investigación e inteligencia sobre el ecosistema Grepolis.

```
Grepo-Smart/
├── lab/                    ← infraestructura de laboratorio (Playwright, proxy, cuentas)
├── Grepo-Smart-coder/
│   ├── lab-evidence/       ← análisis de extensiones existentes
│   ├── game-knowledge/     ← mecánicas del juego documentadas
│   └── tools/              ← KGTools (este proyecto)
```

KGTools es el output de producción de Grepo-Smart: lo que el laboratorio aprende,
KGTools lo convierte en herramientas concretas para jugadores reales.

---

## 7. Principios de desarrollo

1. **Test antes de codificar** — validar en consola que el DOM/API existe antes de escribir código
2. **Un archivo, sin dependencias** — cada herramienta es un `.user.js` autocontenido
3. **Versión visible** — el panel de cada herramienta muestra la versión activa
4. **Documentar lo aprendido** — cada descubrimiento no obvio va a `data.md`
5. **No romper lo que funciona** — cambios aditivos, no destructivos

---

## 8. Instalación general

Cada herramienta se distribuye como un archivo `.user.js` instalable en TamperMonkey:

1. Instalar TamperMonkey en el navegador
2. Abrir el archivo `.user.js` de la herramienta
3. TamperMonkey detecta el header `==UserScript==` y ofrece instalación
4. Recargar el juego

No se requiere configuración adicional. Cada herramienta lee sus propias preferencias
del `localStorage` del dominio `grepolis.com`.
