# Aqua Guard · Litium

App para monitorear y controlar por WiFi un sistema de agua con **2 ESP32**:

| ESP32 | Qué hace |
|---|---|
| **Cisterna** | Mide el nivel de la cisterna con un sensor ultrasónico y lo envía por WiFi. |
| **Bomba** | Controla la bomba con un relé, mide el tinaco con otro sensor ultrasónico y no enciende la bomba si la cisterna está casi vacía. |

La app se conecta automáticamente al ESP32 (o a los dos) que esté enviando datos.

## Estructura

```
app/                  ← la aplicación (HTML + CSS + JavaScript) — aquí se edita todo
  index.html          ← estructura de las pantallas
  styles.css          ← colores y diseño (azul marino / blanco)
  app.js              ← conexión WiFi con los ESP32 y panel
  simulation.js       ← simulación / tutorial paso a paso
firmware/
  esp32_cisterna/     ← código Arduino del ESP32 de la cisterna
  esp32_bomba/        ← código Arduino del ESP32 de la bomba
tools/
  simulador_esp32.py  ← finge ser los 2 ESP32 para probar la app sin hardware
android/  ios/        ← proyectos nativos generados por Capacitor (casi nunca hay que tocarlos)
assets/               ← icono y pantalla de inicio de la app
```

## Cómo abrir y editar el código

1. **Descarga el proyecto**: en GitHub pulsa **Code → Download ZIP** (o `git clone`), y descomprímelo.
2. **Instala [Visual Studio Code](https://code.visualstudio.com/)** (gratis).
3. En VS Code: **Archivo → Abrir carpeta…** y elige la carpeta `Aqua-guard`.
4. Instala la extensión **Live Server** (icono de cuadritos a la izquierda → busca “Live Server”).
5. Abre `app/index.html`, clic derecho → **Open with Live Server**. La app se abre en el navegador y **se recarga sola cada vez que guardas** un cambio.

> También funciona con doble clic en `app/index.html`, pero con Live Server es más cómodo.

### Qué archivo tocar para…

- **Cambiar colores** → `app/styles.css`, al inicio (`--navy-800`, `--accent`, etc.).
- **Cambiar textos del tutorial** → `app/simulation.js`, arreglo `STEPS`.
- **Cambiar pantallas/botones** → `app/index.html`.
- **Cambiar cómo se comunica con el ESP32** → `app/app.js`.

## Instalar la app en el celular

La app se empaqueta para **Android e iPhone** con [Capacitor](https://capacitorjs.com).
Cada vez que se sube un cambio, GitHub la compila sola (pestaña **Actions**) y deja los
instaladores en **Releases → “Aqua Guard (última versión)”**:

| Archivo | Para |
|---|---|
| `AquaGuard.apk` | Android |
| `AquaGuard-sin-firmar.ipa` | iPhone (hay que firmarlo, ver abajo) |

### Android
1. Desde el celular abre la página del repositorio → **Releases** → descarga `AquaGuard.apk`.
2. Ábrelo. Android pedirá permitir **“Instalar apps desconocidas”** para el navegador: acéptalo.
3. Listo, aparece “Aqua Guard” en tus apps.

### iPhone
Apple no deja instalar apps sin firmar. Opciones:
- **Gratis (renovar cada 7 días):** en una PC con Windows o Mac instala
  [Sideloadly](https://sideloadly.io), conecta el iPhone por cable, arrastra `AquaGuard-sin-firmar.ipa`
  e inicia sesión con tu Apple ID. En el iPhone: Ajustes → General → VPN y gestión de dispositivos → confiar.
  Después: Ajustes → Privacidad → **Modo de desarrollador** → activar.
- **Permanente / App Store:** cuenta Apple Developer (99 USD/año). Se firma desde Xcode (Mac)
  o se puede automatizar en GitHub Actions con el certificado.

La primera vez, el iPhone preguntará si Aqua Guard puede **acceder a la red local**: responde *Permitir*
(si no, no podrá ver los ESP32).

### Compilar tú mismo (opcional)
```bash
npm install
npx cap sync          # copia la carpeta app/ dentro de los proyectos nativos
npx cap open android  # abre Android Studio
npx cap open ios      # abre Xcode (solo en Mac)
```
Después de editar algo en `app/`, ejecuta `npx cap sync` antes de compilar.

## Editar el código desde el celular

- **Lo más fácil:** pídeselo a Claude desde la app de Claude (Claude Code) y él hace y sube los cambios.
- **GitHub en el navegador del celular:** abre un archivo del repositorio → icono de **lápiz ✏️** →
  edita → **Commit changes**. GitHub recompila la app sola.
- **Android:** la app [Acode](https://acode.app) (gratis) edita HTML/CSS/JS y tiene vista previa.
- **iPhone:** [Working Copy](https://workingcopy.app) (clona el repositorio y edita) o *Textastic*.

## Probar sin hardware

```bash
python tools/simulador_esp32.py
```

En la pestaña **Conexión** escribe `localhost:8081` (cisterna) y `localhost:8082` (bomba).

## Firmware de los ESP32

1. Instala el [Arduino IDE](https://www.arduino.cc/en/software) y el soporte para ESP32
   (Gestor de tarjetas → “esp32 by Espressif”).
2. Abre `firmware/esp32_cisterna/esp32_cisterna.ino`, escribe tu WiFi y medidas, y súbelo.
3. Haz lo mismo con `firmware/esp32_bomba/esp32_bomba.ino` (pon la IP del ESP32 Cisterna).
4. En el **Monitor Serie** (115200 baudios) cada ESP32 muestra su IP: escríbela en la app.

Conexiones por defecto: sensor ultrasónico `TRIG=GPIO5`, `ECHO=GPIO18`; relé `GPIO26`.

### API que entiende la app

| Petición | Respuesta |
|---|---|
| `GET /api/status` | JSON con `device` (`cisterna` o `bomba`) y sus datos |
| `GET /api/bomba?modo=on\|off\|auto` | Solo ESP32 Bomba: cambia el modo |
