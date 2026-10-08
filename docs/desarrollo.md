# Desarrollo y empaquetado

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
bun run build      # compila main, preload y renderer en out/
bun run start      # abre la app en una ventana
bun run start -- --fullscreen   # como en la tele
```

Hay que usar la app compilada (`build` + `start`). El servidor de desarrollo de electron-vite
sirve la interfaz por `http://`, y el embed de Twitch exige HTTPS. Producción usa un servidor
`https://localhost` con certificado fijado, heredado de VacuumStream.

## Comprobaciones

```bash
bun run verify     # Biome + TypeScript estricto + pruebas unitarias (Vitest) + build
bun run test -- src/main/input-router.test.ts   # una prueba concreta
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
| `critical-path.spec.ts` | Abrir canal → reproduce → pausa/reanuda → volver con la misma fila → otro canal; nada tapa el reproductor | Red y canales en directo |
| `recovery.spec.ts` | Fallo de carga del reproductor → «Reintentar» enfocado → se recupera; Atrás mientras carga | Red |

Variables: `E2E_XVFB`, `E2E_XDOTOOL` y `E2E_LD_LIBRARY_PATH` si los binarios no están en el
`PATH`; `E2E_DISPLAY` (por defecto `:96`). El recorrido crítico prueba los canales de
`E2E_CHANNELS` en orden hasta encontrar dos en directo.

## Empaquetar (AppImage)

```bash
bun run package:appimage
sha256sum dist/GoodTTV-0.1.0-x86_64.AppImage
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
chmod +x GoodTTV-0.1.0-x86_64.AppImage
./GoodTTV-0.1.0-x86_64.AppImage                 # necesita libfuse2
APPIMAGE_EXTRACT_AND_RUN=1 ./GoodTTV-…AppImage   # alternativa sin FUSE
bash scripts/diagnostico.sh > diagnostico.txt    # GPU, VA-API, pantallas, audio, mando
```

Si el sistema no tiene almacén de secretos (GNOME Keyring o KWallet), la sesión de Twitch se
guarda sin cifrar en `~/.config/goodttv/oauth-token.json`, solo legible por tu usuario.
Ajustes lo avisa.

## Client ID de Twitch

La app usa el Client ID público del proyecto (`PROJECT_CLIENT_ID` en
`src/main/settings-store.ts`), registrado como cliente **Public** en
https://dev.twitch.tv/console/apps. No es un secreto y nunca hay que generar un secret para esta
app. Un fork debería registrar el suyo:

- **Al compilar:** `MAIN_VITE_TWITCH_CLIENT_ID=… bun run build`.
- **Al arrancar:** `TWITCH_CLIENT_ID=… bun run start`.

Cambiar de Client ID invalida las sesiones guardadas. Cada persona puede revocar el acceso en
twitch.tv → Ajustes → Conexiones.

## Laboratorio local

`.lab/` (ignorado por Git) contiene las herramientas con las que se probó esta entrega:
Xvfb y xdotool extraídos de paquetes de Arch verificados, el prototipo del reproductor, los
registros y las capturas. Resultados y alcance en [verificacion.md](verificacion.md).
