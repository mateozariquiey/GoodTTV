# Desarrollo y empaquetado

El repo es un monorepo con espacios de trabajo de bun (estructura en
[arquitectura.md](arquitectura.md#la-familia-y-el-monorepo)). Todos los comandos se lanzan desde la
raíz: los de la app de la tele delegan en `apps/tele`.

## Requisitos

- Linux x86_64 con sesión gráfica (Wayland o X11).
- Node.js 24 o posterior y **Bun 1.4.2**, las versiones fijadas en `package.json`.
- Para las pruebas e2e: `Xvfb` y `xdotool` (en Arch, `xorg-server-xvfb` y `xdotool`).

```bash
bun install --frozen-lockfile   # instala dependencias y descarga Electron
```

> Si lanzas comandos desde una terminal que hereda `ELECTRON_RUN_AS_NODE=1` (por ejemplo, la de
> otra app de Electron como T3 Code), Electron arrancará como Node y fallará con «bad option».
> Ejecuta `unset ELECTRON_RUN_AS_NODE` primero.

## Ejecutar

```bash
bun run build      # compila main, preload y renderer en apps/tele/out/
bun run start      # abre la app en una ventana
bun run start -- --fullscreen   # como en la tele
```

Hay que usar la app compilada (`build` + `start`). El servidor de desarrollo de electron-vite
sirve la interfaz por `http://`, y el embed de Twitch exige HTTPS. Producción usa un servidor
`https://localhost` con certificado fijado, heredado de VacuumStream.

## Comprobaciones

```bash
bun run verify     # Biome + TypeScript estricto + pruebas unitarias (Vitest) + build
bun run test -- apps/tele/src/main/input-router.test.ts   # una prueba concreta
```

### Pruebas e2e

Arrancan la app real en una pantalla virtual propia y pulsan teclas X11 reales con `xdotool`,
como lo haría un mando USB. Observan el resultado con Playwright.

```bash
bun run build
bun run test:e2e                                 # todas
bun run test:e2e -- navigation.spec.ts           # sin red ni cuenta
E2E_CHANNELS=canal1,canal2 bun run test:e2e -- critical-path.spec.ts
```

| Archivo | Qué comprueba | Necesita |
| --- | --- | --- |
| `navigation.spec.ts` | Foco inicial, pestañas, teclado en pantalla, probar el mando, preferencias | Nada |
| `critical-path.spec.ts` | Abrir canal → reproduce → pausa/reanuda → volver con la misma fila → otro canal; nada tapa el reproductor de Twitch (el propio admite la franja encima, modo cine) | Red y canales en directo |
| `recovery.spec.ts` | Fallo del reproductor propio → «Usar el reproductor de Twitch» enfocado → fallo de este → «Reintentar» enfocado → se recupera; Atrás mientras carga | Red |

Variables: `E2E_XVFB`, `E2E_XDOTOOL` y `E2E_LD_LIBRARY_PATH` si los binarios no están en el
`PATH`; `E2E_DISPLAY` (por defecto `:96`). El recorrido crítico prueba los canales de
`E2E_CHANNELS` en orden hasta encontrar dos en directo.

**Sin Xvfb ni xdotool:** `E2E_WAYLAND=<socket>` usa un compositor Wayland sin pantalla ya en
marcha (Weston con `kiosk-shell`, que da a la ventana toda la salida) y envía las teclas desde el
proceso principal con `sendInputEvent`. Pasan igualmente por `before-input-event`; solo se salta
X11. La tecla Atrás del navegador no se puede simular así y se envía Escape, que da la misma acción.

## Empaquetar (AppImage)

```bash
bun run package:appimage
sha256sum apps/tele/dist/GoodTTV-0.2.1-x86_64.AppImage
```

- El AppImage arranca a pantalla completa (`--fullscreen` va en su lanzador).
- Lleva los *fuses* de Electron de VacuumStream: sin modo Node, sin variables `NODE_OPTIONS`,
  sin inspector y carga solo desde el ASAR. El fuse de integridad del ASAR también está activado,
  pero Electron solo documenta esa validación en macOS y Windows; en Linux no se ha comprobado
  su efecto.
- La compilación es reproducible a partir de `bun.lock`. El binario no es idéntico byte a byte
  entre compilaciones; por eso se publica su SHA-256.

En el mini PC:

```bash
chmod +x GoodTTV-0.2.1-x86_64.AppImage
./GoodTTV-0.2.1-x86_64.AppImage                 # necesita libfuse2
APPIMAGE_EXTRACT_AND_RUN=1 ./GoodTTV-…AppImage   # alternativa sin FUSE
bash diagnostico.sh > diagnostico.txt           # apps/tele/scripts: GPU, VA-API, pantallas, audio, mando
```

Si el sistema no tiene almacén de secretos (GNOME Keyring o KWallet), la sesión de Twitch se
guarda sin cifrar en `~/.config/goodttv/oauth-token.json`, solo legible por tu usuario.
Ajustes lo avisa.

## Extensión de navegador

`apps/navegador` (D13) compila una sola carpeta para Chrome y Firefox. El botón de la extensión
abre GoodTTV, con pantallas para ratón y teclado (D14; los atajos están en Ajustes). En twitch.tv,
el menú contextual de un enlace o de la página de un canal tiene «Abrir en GoodTTV». Para vincular
la cuenta, el mismo código que en la tele.

```bash
bun run build:navegador   # apps/navegador/dist
bun run pack:navegador    # compila y empaqueta: apps/navegador/out/goodttv-<versión>.xpi
```

### Instalarla

No está firmada ni publicada en ninguna tienda (D15). Cada navegador la admite de una forma:

| Navegador | Cómo se instala | ¿Sigue al reiniciar? |
| --- | --- | --- |
| Chrome (y Chromium) | Descomprimida, desde `apps/navegador/dist` | Sí |
| Zen | El `.xpi` sin firmar, tras permitirlo en `about:config` | Sí |
| Firefox | Temporal, desde `about:debugging` | No |

- **Chrome:** `chrome://extensions` → «Modo de desarrollador» → «Cargar descomprimida» →
  `apps/navegador/dist`. El Chrome de marca ya no carga extensiones desde la línea de comandos.
  Para actualizarla, recompila y pulsa el botón de recargar en la tarjeta de GoodTTV.
- **Zen:**
  1. En `about:config`, pon `xpinstall.signatures.required` a `false`. Afecta a todo el perfil:
     Zen sigue pidiendo confirmación antes de instalar cualquier complemento, pero ya no exige que
     Mozilla lo haya firmado.
  2. Ejecuta `bun run pack:navegador`.
  3. En `about:addons`, abre el menú del engranaje → «Instalar complemento desde archivo…» → elige
     `apps/navegador/out/goodttv-<versión>.xpi` y confirma la instalación.

  Para actualizarla, repite los pasos 2 y 3. No hace falta cambiar la versión y se conservan la
  cuenta y los ajustes.
- **Firefox:** exige la firma de Mozilla y no deja desactivarla. Sin firma, solo admite la
  instalación temporal: `about:debugging` → «Este Firefox» → «Cargar complemento temporal…» →
  `apps/navegador/dist/manifest.json`. Se quita al cerrar Firefox; tras recompilar, se recarga
  desde la misma página.

### Prueba de la interfaz

Recorre la interfaz de escritorio en Chrome for Testing y en Firefox, sin ventana ni sonido y sin
cuenta:
- buscar con / y abrir con Enter un canal que reproduce;
- pausar con Espacio y con un clic en el vídeo;
- modo teatro (T, Esc), chat (C) y silencio (M);
- volver a Inicio con el canal en «Seguir viendo»;
- pedir el código de la cuenta y cancelarlo;
- un modo de retraso que se conserva al recargar;
- una sola pestaña abierta.

```bash
bun run build:navegador
bun run test:interfaz -- --canales canal1,canal2   # prueba los canales en orden hasta uno en directo
```

En Chrome, teclas, texto y clics son de verdad (CDP). En Firefox, WebDriver BiDi no admite
acciones de teclado ni de ratón en las páginas de una extensión: se simulan en la página, así que
siguen el mismo código, pero no son de confianza para el navegador.

La cuenta completa necesita a una persona: `node apps/navegador/test/humo/cuenta.mjs
[--navegador firefox]` muestra un código para autorizarlo en twitch.tv/activate. Usa un perfil
temporal que se borra al terminar, también si se corta con Ctrl+C.

### Prueba de los modos de retraso

Los mismos criterios que en la tele, en la interfaz de escritorio y en los dos navegadores. Usa las
pausas globales simuladas de la página: `goodttv.html?pausa=cada,duración[,arranque]`, como
`GOODTTV_PAUSA_SIMULADA`; `?registro` guarda los eventos del empalme sin datos sensibles.

```bash
bun run test:modos -- --canales canal1,canal2 --escenario arranque     # 0,20,1, 90 s
bun run test:modos -- --canales canal1,canal2 --escenario adaptativo   # 150,45, 400 s
bun run test:modos -- --canales canal1,canal2 --escenario sin-paradas  # 150,45, 400 s
```

- **`arranque`:** empieza en el VOD y vuelve con 0 s de salto, sin paradas.
- **`adaptativo`:** como mucho una parada, y en la primera pausa (antes de la segunda).
- **`sin-paradas`:** ninguna parada.
- **En todos:** cada pausa se rellena con trozos del VOD antes de la siguiente; el vídeo nunca está
  en pausa ni desaparece, y no hay errores del servidor. Las paradas se estiman con una muestra cada
  2 s, así que una de menos de 2 s puede pasar inadvertida.

Los canales deben tener el VOD público; si no, el veredicto muestra `vod-error` y no hay relleno.

### Prueba de rendimiento

Mide el reproductor en la interfaz de escritorio. Para cada canal toma el arranque por hitos, desde
que se abre el canal hasta el primer fotograma. Después mira unos segundos de reproducción:
- la latencia respecto al emisor y el búfer;
- las paradas y los fotogramas perdidos;
- el trabajo del hilo de la página (solo Chrome) y la CPU de todo el navegador.

```bash
bun run build:navegador
node apps/navegador/test/humo/rendimiento.mjs --canales auto:6 --rondas 2 --segundos 35 \
  --wayland goodttv-lab                      # en el Weston del laboratorio, con la GPU
node apps/navegador/test/humo/rendimiento.mjs --canales canal1 --detalle   # una muestra por segundo
```

- **Opciones:**
  - `--canales auto:N`: los N directos con más espectadores.
  - `--navegador chrome|firefox`: Firefox, o Zen con `HUMO_FIREFOX`.
  - `--modo`: como en Ajustes.
  - `--precalentar MS`: precalienta el canal MS ms antes de abrirlo, como al parar el ratón encima.
  - `--chat N`: un chat sintético de N mensajes por segundo, con una cuenta ficticia
    (`?chatsintetico=N`).
  - `--chatreal`: el chat real del canal, leído por IRC anónimo, con sus emotes (`?chatreal`).
  - `--extension otra/dist`: otra compilación, por ejemplo la de otra rama, para compararlas.
- **Sin ventana, el vídeo se decodifica por software:** los fotogramas perdidos solo cuentan con
  `--wayland <socket>`, en un Weston sin pantalla, que usa la GPU sin tocar tu pantalla.
- **Para comparar dos versiones,** lánzalas a la vez en dos Weston, con los mismos canales y en el
  mismo orden: así comparten red y anuncios.
- **La latencia** se mide como «ahora − hora (PDT) del fragmento en pantalla». Cada canal tiene su
  desfase, así que solo se compara canal a canal.
- **Datos que lee:** con `?registro`, la página expone el hls.js del reproductor (`hlsPrueba`) y sus
  hitos de arranque (`marcasPrueba`), sin datos sensibles (`src/lab.ts`).

### Prueba de humo

Abre la página de prueba del reproductor en Chrome for Testing y en Firefox, sin ventana, sin
sonido y con perfiles temporales. Comprueba que el vídeo avanza sin errores fatales y escribe una
línea JSON por muestra y un veredicto por navegador.

```bash
bun run build:navegador
bun run test:humo -- --canales canal1,canal2              # 60 s en los dos navegadores
bun run test:humo -- --canales canal1 --pausa 0,20,1      # arranque desde el VOD
bun run test:humo -- --canales canal1 --oculta 360 --como silenciado   # pestaña oculta 6 min
```

- **Opciones:**
  - `--navegador chrome|firefox|ambos`;
  - `--segundos`;
  - `--modo` (como en Ajustes);
  - `--pausa` (como `GOODTTV_PAUSA_SIMULADA`);
  - `--oculta S --como sonando|silenciado|pausado`.
- **Navegadores:**
  - **Chrome for Testing** se espera en `~/.cache/chrome-for-testing/chrome-linux64/chrome`; si
    está en otro sitio, indícalo con `HUMO_CHROME`. Se controla por CDP, sin Playwright
    (motivo en [verificacion.md](verificacion.md#extensión-de-navegador)).
  - **Firefox** es el del sistema; otra ruta, con `HUMO_FIREFOX`. Se controla por WebDriver BiDi
    con `--remote-allow-system-access`, que hace falta para leer las páginas de una extensión. Las
    pruebas también corren en Zen: `HUMO_FIREFOX=/usr/bin/zen-browser` y `--navegador firefox`.

## Client ID de Twitch

La app usa el Client ID público del proyecto (`PROJECT_CLIENT_ID` en
`packages/servicios/src/settings.ts`), registrado como cliente **Public** en
https://dev.twitch.tv/console/apps. No es un secreto y nunca hay que generar un secret para esta
app. Un fork debería registrar el suyo:

- **Al compilar:** `MAIN_VITE_TWITCH_CLIENT_ID=… bun run build`. Si prefieres un archivo `.env`, va en
  `apps/tele/` (electron-vite lo busca en la carpeta de la app, no en la raíz del monorepo).
- **Al arrancar:** `TWITCH_CLIENT_ID=… bun run start`.

Cambiar de Client ID invalida las sesiones guardadas. Cada persona puede revocar el acceso en
twitch.tv → Ajustes → Conexiones.

