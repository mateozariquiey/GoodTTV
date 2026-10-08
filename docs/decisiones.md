# Auditoría de VacuumStream y decisiones de la variante

> Estado: decisiones aplicadas en GoodTTV 0.1.0. Lo comprobado y lo pendiente están en
> [verificacion.md](verificacion.md).

Fecha: 8 de octubre de 2026. Base: VacuumStream 0.2.1 (`0427456`, MIT), con su historial
completo en este repositorio. Las pruebas citadas se hicieron en el sobremesa, en un escritorio
X11 virtual (Xvfb 1920×1080, sin GPU, audio silenciado por Chromium). No son garantías sobre el
mini PC, la TV ni un mando físico.

## 1. Auditoría breve

### Qué aporta VacuumStream

| Área | Estado en 0.2.1 | Valor para nosotros |
| --- | --- | --- |
| Proceso principal | `sandbox`, `contextIsolation`, IPC con remitente y origen verificados, servidor HTTPS en `localhost` con certificado fijado, navegación y ventanas nuevas bloqueadas, instancia única | Alto: se conserva casi intacto |
| Cuenta | Device Code Flow, tokens cifrados con `safeStorage` si hay almacén de secretos; si no, JSON sin cifrar con permisos `0600` y aviso | Alto: se conserva, y el aviso se muestra en Cuenta |
| Catálogo | Adaptador Helix con validación Zod (seguidos, directos, búsqueda, categorías, VOD) | Alto: se recorta a lo que usamos |
| Reproductor | Embed oficial (`embed/v1.js`) con calidad, subtítulos, VOD, reanudación | Medio: el cargador del SDK sirve; el arranque no (ver abajo) |
| Foco | Algoritmo espacial + enlaces explícitos `data-focus-*` en casi cada control; puente de mando (Gamepad API) | Bajo: el algoritmo espacial sirve, el grafo explícito es caro de mantener |
| Chat | iframe oficial del chat de Twitch; modo de interacción con depurador CDP restringido | Bajo para el chat (no muestra 7TV); alto como patrón para la puerta de contenido |
| Pruebas | 802 pruebas unitarias en verde, 21 fallos esperados documentados; e2e con Playwright | Las de main/preload se conservan; las de la interfaz, ligadas a pantallas que cambian, no |
| Empaquetado | electron-builder (AppImage), manifiesto Flatpak, CI | Alto: se conserva |

Tamaño: unas 9.600 líneas de código, 16.800 de pruebas unitarias y 6.000 de e2e.

### Qué no encaja con nuestra experiencia

1. **Arranque del vídeo por inyección.** `window-controls.ts` ejecuta JavaScript dentro del iframe
   de Twitch con gesto de usuario simulado, pulsa selectores privados (incluida la puerta de
   contenido para audiencias concretas, que exige consentimiento) y llama a `video.play()`.
   Contradice «APIs documentadas» y, según nuestras pruebas, no es necesario (sección 2).
2. **El chat no puede mostrar emotes de 7TV, BTTV ni FFZ**: es el iframe oficial. Además muestra
   el diálogo de cookies de Twitch, que solo se maneja con Tab.
3. **Volver del reproductor lleva siempre a Inicio** (`onBack={controller.navigateHome}`) y la
   vista anterior se desmonta: se pierde la posición.
4. **Foco con enlaces explícitos en cada control**: `PlayerView.tsx` (550 líneas) calcula vecinos
   según el estado (VOD, error, chat, subtítulos…). Cada control nuevo obliga a recablear vecinos y
   pruebas (`PlayerView.test.tsx` tiene 2.933 líneas).
5. **Alcance mayor del que queremos**: VOD, reanudación, «Seguir viendo», subtítulos, categorías,
   favoritos, Steam Deck y mando de consola.

### Recomendación: mantener una variante

- **Conservar** proceso principal, preload, contratos y empaquetado, recortando lo que no usamos.
- **Sustituir el renderer** por uno más pequeño pensado para mando a distancia: Inicio, Buscar,
  Reproducción con chat propio y Cuenta. Reutiliza el algoritmo de foco espacial y el cargador del
  SDK de Twitch.
- **No es una reescritura completa**: lo que se sustituye es lo que cambian a la vez el alcance,
  el chat, el modelo de foco y la dirección visual. Arreglos localizados no resolverían los
  puntos 2–5.
- **Contribuir aguas arriba** algún arreglo genérico (por ejemplo, la observación de que el
  arranque no necesita inyección) queda como opción posterior; no se publica nada en esta entrega.

### ¿Otro lenguaje?

La reproducción tiene que ser el embed oficial de Twitch, así que necesitamos un motor web con
H.264/AAC. Electron trae Chromium completo con esos códecs. La decodificación de vídeo ocurre en
Chromium y la GPU, no en el código de la interfaz: reescribir la interfaz en Rust, Go o Python no
haría el vídeo más fluido. Tauri en Linux usa WebKitGTK (más riesgo con el reproductor de Twitch y
con la aceleración por hardware) y las ruedas de Qt WebEngine de PyPI no incluyen H.264. Por eso se
mantiene TypeScript + React, con un renderer pequeño y legible.

## 2. Evidencia del laboratorio

Prototipo mínimo en `.lab/spike/` (ignorado por Git): Electron 44, embed oficial, rutas de
teclado en el proceso principal y una sonda **solo de laboratorio** que lee el `<video>` del
iframe para medir. El producto no ejecuta código en marcos de Twitch.

| Prueba | Resultado observado | Registro |
| --- | --- | --- |
| Política de autoplay por defecto, nada encima del iframe | Arranca sin silenciar en el reproductor (`muted: false`, volumen 0,5), `currentTime` avanza, 1280×720 y 1920×1080 según ABR. La salida de audio estaba silenciada por Chromium: **sonido audible no comprobado** | `e5-default-nostatus` |
| Un texto de depuración tapando parte del iframe | Twitch registra «Autoplay disabled… requirements were not met: style visibility» y pausa | `e1-default`, `e2-switch` |
| Lo mismo con `--autoplay-policy=no-user-gesture-required` | Igual. Electron ya usa esa política por defecto, así que no es una comparación entre políticas: solo muestra que el flag es redundante | `e2-switch` |
| `pause()`, `play()` y `setChannel()` de la API oficial, sin gesto | Funcionan; `setChannel` cambia de canal sin recrear el reproductor | `e5-default-nostatus` |
| Foco DOM dentro del iframe (programático) y flechas pulsadas | `before-input-event` del proceso principal las recibe y puede impedir que lleguen a Twitch | `e6-iframe-focus` |
| Clic dentro del embed | Twitch abre twitch.tv en una ventana nueva; hay que denegar `window.open` | `e6-after-click.png` |
| Puerta «contenido para determinadas audiencias» (xQc, juego para adultos) | Tab real recorre la puerta; las flechas no; `sendInputEvent` no llega al iframe; `Input.dispatchKeyEvent` por CDP sí | `e7-gate`, `e8-cdp` |
| Tras aceptar la puerta una vez | No vuelve a aparecer al volver al canal ni al reiniciar con el mismo perfil | `e8-restart` |
| `PLAYING` con la puerta visible | Se emite igualmente (vídeo silenciado detrás): no prueba que se vea | `e7-gate` |
| La página pasa a oculta (`visibilityState: hidden`) unos 30 s en el Xvfb | Twitch pausa con el mismo aviso de visibilidad y **no reanuda** al volver a ser visible | `e8-restart` |

Conclusión: retiramos la inyección y el flag porque este laboratorio arranca sin ellos. Que algo
tapara el reproductor o la puerta de contenido explica bien el «hizo falta un clic» de la
evaluación anterior, pero no demuestra que todos los fallos de entonces tuvieran esa causa.

## 3. Decisiones

**D1. Reproductor.** `Twitch.Player` oficial, una instancia por visita a la pantalla de
reproducción, `setChannel` para cambiar de canal, `autoplay: true`, `muted: false`. Se elimina
`activateEmbeddedPlayer`: sin inyección, sin selectores privados, sin tocar el `<video>`.

**D2. Nada encima del vídeo.** El diseño garantiza que ningún elemento corta el rectángulo del
iframe: controles, información y chat van al lado o debajo, y el foco no se dibuja sobre él. El
iframe nunca baja de 400×300 px CSS, tampoco durante transiciones. La e2e del recorrido crítico lo
comprueba con geometría y con `IntersectionObserver` v2 desde la página con chat visible, con el
selector de calidad abierto y con el chat oculto; los avisos solo se han revisado en capturas. Señales: READY = API lista; ONLINE/OFFLINE = canal; `PLAYBACK_BLOCKED` = bloqueo; PAUSE
solo cuenta como pausa voluntaria si la pidió la persona. Si hay bloqueo, «Reproducir» intenta
`player.play()` (sin garantía si la política exigiera un gesto real) y «Controles de Twitch»
queda como vía manual. Al volver la página a visible, si la persona no había pausado, se consulta
el estado y se reanuda. Durante la reproducción se impide que la pantalla se apague
(`powerSaveBlocker`).

**D3. Una sola ruta de teclado.** El proceso principal intercepta en `before-input-event` las
teclas del mando, impide que lleguen a la página o a Twitch y envía al renderer una acción
semántica por IPC. Así da igual dónde esté el foco DOM *dentro de la ventana*. Si la ventana
pierde el foco del sistema, las teclas no llegan: la app no abre navegadores externos (la
autorización se hace con el móvil), enfoca su ventana al arrancar y se recomienda una sesión de
quiosco en el mini PC. OK, Atrás y reproducir/pausar actúan una vez por pulsación (se ignora la
repetición); solo las flechas repiten. La tecla que cambia de modo consume también su
liberación. Las vistas ocultas son `inert` y solo la pantalla activa recibe acciones. Mapeo
inicial:

| Acción | Teclas |
| --- | --- |
| Mover | Flechas |
| OK | Enter, Intro del teclado numérico, Select |
| Atrás | Escape, BrowserBack, GoBack, Retroceso (fuera de un campo de texto) |
| Reproducir/pausar | MediaPlayPause y Espacio (fuera de un campo de texto) alternan; MediaPlay y MediaPause son idempotentes |

Con un campo de texto activo, las letras, Retroceso y el espacio pasan al campo.

**D4. «Controles de Twitch» (puerta de contenido).** Modo explícito: el renderer da el foco al
iframe y el proceso principal traduce ↑/← a Mayús+Tab, ↓/→ a Tab y OK a Enter con
`Input.dispatchKeyEvent` por CDP, solo hacia el marco actual de `player.twitch.tv`. Atrás sale y
devuelve el foco a la interfaz. El modo termina al cambiar de canal, salir, perder el foco de la
ventana o navegar. Se adapta `chat-input.ts` de VacuumStream con todas sus comprobaciones antes de cada
envío: ventana activa, marco hijo directo con origen exacto `https://player.twitch.tv`, mismo
marco y URL que al entrar, marco con el foco y sesión vigente. La sesión se invalida **antes** de
`setChannel` y se descarta su cola; ante cualquier fallo vuelve el foco a la interfaz. Queda una
carrera residual: una pareja de eventos ya enviada no se puede retirar. Si Twitch informa
`muted: true` sin pedirlo, se sugiere el modo (es una pista, no una detección). Es la persona
quien pulsa «Start Watching»: no se acepta nada automáticamente.

**D5. Volver conserva la posición.** Pila de pantallas; Inicio y Buscar siguen montadas (ocultas)
durante la reproducción. Al volver se enfoca el último elemento por su id estable. Las listas se
refrescan en segundo plano; si el canal enfocado desaparece, el foco vuelve al primer canal de la
lista (pasar al vecino queda como mejora).

**D6. Chat propio.** EventSub por WebSocket desde el proceso principal (`channel.chat.message`,
`message_delete`, `clear`, `clear_user_messages`, ámbito `user:read:chat`); el token no sale del
proceso principal. Emotes de Twitch (fragmentos del mensaje) y de 7TV, BTTV y FFZ (globales y del
canal), validados con Zod y en caché; emotes de anchura cero apilados; máximo de 150 mensajes y
actualizaciones agrupadas. Una sola conexión: cambiar de canal sustituye las suscripciones; se
descartan mensajes de otro canal o sesión; welcome, keepalive, reconnect y revocación tienen
tratamiento propio y la cola es acotada. Sin cuenta vinculada, el panel invita a vincularla. No
se envían mensajes en esta versión. Descartados: IRC anónimo (no documentado) e iframe oficial
(sin 7TV). IRC autenticado también estaría documentado; se prefiere EventSub porque Twitch lo
recomienda y entrega los emotes ya separados.

**D7. Cuenta.** Device Code Flow con `user:read:follows` y `user:read:chat`. El Client ID
identifica a la *aplicación*, no a quien la usa: se registra una vez, se incluye al compilar y no
se escribe con el mando. No reutilizamos el de VacuumStream. Vincular la cuenta exige otro
dispositivo (el móvil lee un QR o escribe un código): es la única excepción al uso solo con mando. El inicio de sesión de Helix **no** inicia sesión en el reproductor: no se prometen Turbo
ni ventajas de suscriptor.

**D8. Alcance.** Fuera: VOD, reanudación, «Seguir viendo», subtítulos, categorías, favoritos,
Steam Deck y Gamepad API. Dentro: Recientes (historial local de canales vistos).

**D9. Empaquetado.** AppImage con electron-builder (`io.github.mateozariquiey.GoodTTV`, a
pantalla completa). El manifiesto Flatpak de VacuumStream se retiró: tenía otra identidad y no
se iba a validar en esta entrega.

**D10. Hardware.** No se fuerzan flags de VA-API. El diagnóstico separa tres cosas: el
reproductor (estadísticas documentadas, muestreadas tras estabilizarse), la GPU
(`app.getGPUInfo` de Electron) y el audio (herramientas del sistema, fuera de la app). Un vídeo
que avanza no demuestra que la TV reciba imagen fluida ni sonido.

## 4. Revisión temprana

Codex (`gpt-6.1-sol`, razonamiento alto) revisó este documento, el prototipo y los registros el
8 de octubre. Se aceptaron sus 12 observaciones, ya incorporadas arriba: foco de ventana,
validación del marco antes de cada envío CDP, semántica de repetición, recorridos de texto y
cuenta, redacción sobre audio y flag, señales del reproductor, alcance del botón «Reproducir»,
aviso de almacenamiento sin cifrar, ciclo de vida del chat, tamaño mínimo en transiciones,
diagnóstico separado y vistas ocultas inertes. Además, su lectura de `e8-restart` reveló la pausa
por página oculta sin reanudación.

## 5. Revisión final

Codex (`gpt-6.1-sol`, razonamiento alto) revisó el resultado completo el 8 de octubre. No
encontró ninguna vía para que Twitch o los emotes accedan a tokens o a Node, y confirmó que la
documentación distingue bien laboratorio y hardware. Se aceptaron y corrigieron sus hallazgos:
- **Chat:** una reconexión pendiente podía revivirlo tras cerrarlo; las colas no tenían límite;
  las suscripciones parciales se perdían; un fallo transitorio se trataba como «sin sesión»;
  cambiar de canal cerraba la conexión en vez de reutilizarla.
- **Reproductor:** Play/Pausa no funcionaba con el selector de calidad abierto y «Reintentar» no
  relanzaba una descarga colgada del SDK.
- **Almacén local:** no se recuperaba de un JSON truncado.
- **Ajustes:** presentaba la *capacidad* de aceleración como decodificación efectiva.
- **Documentación:** varias afirmaciones iban más allá de lo medido.
- **Riesgo menor:** la pausa hecha desde los controles de Twitch se pierde; ahora se respeta.
- **Superficie sin uso:** se retiró.

Al ampliar la e2e apareció otro fallo: al cerrar el selector de calidad, el foco volvía a
«Pausa»; ahora vuelve a «Calidad».

## 6. Pendiente en hardware real

Lista de comprobaciones en [verificacion.md](verificacion.md#pendiente-en-el-mini-pc-la-tv-y-el-mando).
