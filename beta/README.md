# Aqua Guard Beta

Versión de pruebas de Aqua Guard, separada de la app estable. Se instala **junto a ella**
(tiene otro identificador: `com.litium.aquaguard.beta`).

Funciona en **Android, iPhone, Windows, macOS, Linux y en el navegador**.

## Nombres de los depósitos

| En pantalla | Qué es | En el código |
|---|---|---|
| **Cisterna** | depósito de arriba (la que abastece la casa) | `tinaco` |
| **Aljibe** | depósito de abajo (recibe el agua de la red) | `cisterna` |

Los nombres internos del código no se han cambiado para no romper la comunicación con los ESP32.

## Novedades respecto a la versión estable

- Interfaz más simple: esquinas rectas y bordes finos.
- **Menú de tres rayas** con: tamaño de letra, color de app, acerca de este proyecto, tema claro/oscuro,
  opciones de la simulación, forma de leer los datos (%, litros o cm; cada cuánto; desde qué ESP32),
  versión de la app, Yailywai y «...» (Vincular al WhatsApp, Tutorial y Aqua guard, aún sin funcionar).
- Sin emojis y con vocabulario de España (móvil, ordenador, fontanero, pulsar…).
- **Detección automática** de: fuga de agua, sensor averiado, aljibe lleno, aljibe vacío
  y bomba averiada (con bloqueo de la bomba cuando hace falta).
- **Modo noche** (apagado / encendido / automático de 22:00 a 06:00): la app actúa sola,
  llena la cisterna al 100 %, bloquea la bomba si detecta una fuga y solo avisa lo urgente.
- **Simulación** con 8 situaciones reproducibles. Usa el mismo “cerebro” (`engine.js`) que el Panel real.
- Créditos al final de la pestaña **Conexión**.

## Estructura

```
beta/
  www/                 ← la app (aquí se edita todo)
    index.html         ← pantallas, menú de tres rayas y créditos
    styles.css         ← diseño y colores (claro/oscuro, colores de app)
    settings.js        ← ajustes guardados en el dispositivo
    menu.js            ← menú de tres rayas y versión de la app
    engine.js          ← motor de detección (fugas, sensores, aljibe, bomba)
    scenarios.js       ← escenarios de la simulación (textos y eventos)
    sim.js             ← dibujo y controles de la simulación
    app.js             ← panel, modo noche y conexión con los ESP32
  android/  ios/       ← proyectos nativos (Capacitor)
  desktop/             ← versión de ordenador (Electron)
```

### Qué archivo tocar para…

- **Textos o pasos de una situación de la simulación** → `www/scenarios.js`
- **Sensibilidad de las alertas** (ej. cuánto debe bajar la cisterna para considerarlo fuga) → `DEFAULTS` en `www/engine.js`
- **Créditos, «Acerca de», «Yailywai» o las opciones de «...»** → `www/index.html`
- **Colores** → `www/styles.css` (al inicio)
- **Número de versión** → `APP_VERSION` en `www/menu.js`

## Probar en tu ordenador

- **Navegador:** abre `beta/www/index.html` con Live Server en VS Code.
- **Como app de escritorio:**
  ```bash
  cd beta/desktop
  npm install
  npm start
  ```

## Descargar e instalar

GitHub la compila sola en cada cambio dentro de `beta/` y la publica en
**Releases → “Aqua Guard Beta (última versión)”**:

| Archivo | Para |
|---|---|
| `AquaGuardBeta.apk` | Android |
| `AquaGuardBeta-sin-firmar.ipa` | iPhone (se firma con Sideloadly, igual que la estable) |
| `AquaGuardBeta-win.exe` | Windows (portable: no se instala, solo se abre) |
| `AquaGuardBeta-mac.zip` | macOS (clic derecho → Abrir la primera vez) |
| `AquaGuardBeta-linux.AppImage` | Linux (dale permiso de ejecución) |

Los avisos de "Windows protegió su PC" / "desarrollador no identificado" salen porque la app
no está firmada. Se abren con **Más información → Ejecutar de todas formas** (Windows) o
**clic derecho → Abrir** (macOS).
