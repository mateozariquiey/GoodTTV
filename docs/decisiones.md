# Auditoría de VacuumStream y decisiones de la variante

> Este documento empezó como la auditoría de VacuumStream, la app de la que nació GoodTTV, y siguió como el registro de
> sus decisiones. Cuál vale hoy lo dice [el índice](#índice-de-decisiones). Lo comprobado está en
> [verificacion.md](verificacion.md).

Fecha: 8 de octubre de 2026. Base: VacuumStream 0.2.1 (`0427456`, MIT), con su historial
completo en este repositorio. Las pruebas citadas se hicieron en el sobremesa, en un escritorio
X11 virtual (Xvfb 1920×1080, sin GPU, audio silenciado por Chromium). No son garantías sobre el
mini PC, la TV ni un mando físico.

## Índice de decisiones

Una fila por decisión, en orden. Las decisiones no se reescriben, porque cuentan lo que se decidió entonces, así que el
estado dice si lo que cuenta sigue valiendo: «vigente», «cambiada en parte por» otra posterior (lo demás sigue valiendo, y
para saber qué cambió hay que leer las dos) o «sin efecto desde» la que la retiró. Las versiones son las que la decisión
afecta hoy. De D19 a D29 hay un resumen y un detalle que no se publica, y el índice enlaza al resumen.

| Decisión | De qué va | Versiones | Estado |
| --- | --- | --- | --- |
| [D1](#d1) | La TV reproduce con el reproductor oficial incrustado de Twitch, sin inyectar código en él. | TV | sin efecto desde [D51](#d51) |
| [D2](#d2) | Nada tapa el reproductor oficial, se leen sus señales y la pantalla no se apaga mientras suena. | TV | cambiada en parte por [D11](#d11) y [D51](#d51) |
| [D3](#d3) | El proceso principal de la TV recoge las teclas del mando y las manda a la interfaz como acciones. | TV | vigente |
| [D4](#d4) | Un modo «Controles de Twitch» manda las teclas al reproductor oficial para pasar su puerta de contenido. | TV | sin efecto desde [D51](#d51) |
| [D5](#d5) | Al volver del reproductor, Inicio y Buscar siguen como se dejaron y el foco vuelve a donde estaba. | TV | vigente |
| [D6](#d6) | El chat es propio, por EventSub, con los emotes de Twitch, 7TV, BTTV y FFZ, y solo de lectura. | todas | cambiada en parte por [D24](#d24) y [D31](#d31) |
| [D7](#d7) | La cuenta se vincula con el código de dispositivo de Twitch y un Client ID propio. | todas | vigente |
| [D8](#d8) | Fuera del alcance quedan los VOD, las categorías, los subtítulos y los favoritos, y dentro, los canales recientes. | todas | cambiada en parte por [D24](#d24) y [D49](#d49) |
| [D9](#d9) | La TV se empaqueta como AppImage, sin Flatpak. | TV | vigente |
| [D10](#d10) | No se fuerzan flags de VA-API, y el diagnóstico separa el reproductor, la GPU y el audio. | TV | vigente |
| [D11](#d11) | Un reproductor propio sin anuncios empalma varias sesiones de invitado y rellena las pausas con el VOD, con tres modos de retraso. | todas | cambiada en parte por [D18](#d18) y [D51](#d51) |
| [D12](#d12) | Las versiones viven en un monorepo privado, con el código común en `packages/`. | todas | cambiada en parte por [D18](#d18) |
| [D13](#d13) | La versión de navegador es una extensión de Chrome y Firefox con el reproductor propio. | extensión | cambiada en parte por [D24](#d24) y [D49](#d49) |
| [D14](#d14) | La extensión tiene pantallas propias para ratón y teclado, con la identidad visual de la TV. | extensión | vigente |
| [D15](#d15) | La extensión se instala sin firmar, descomprimida en Chrome y como `.xpi` en Zen. | extensión | cambiada en parte por [D18](#d18) y [D30](#d30) |
| [D16](#d16) | El reproductor propio arranca antes, pierde menos fotogramas y suma `mobile_feed` como cuarta sesión. | todas | vigente |
| [D17](#d17) | Con el zoom, el vídeo conserva su espacio, y la columna, el chat y los controles se adaptan. | extensión | cambiada en parte por [D41](#d41) |
| [D18](#d18) | Lo terminado se publica en el repo público, con el reproductor sin anuncios y sin tiendas. | todas | cambiada en parte por [D29](#d29) y [D30](#d30) |
| [D19](#d19) (resumen) | Android usa una WebView para la interfaz, otra oculta para el empalme y Media3 para el vídeo, para que suene en segundo plano. | Android | vigente |
| [D20](#d20) (resumen) | Android es un proyecto de Gradle fuera de los espacios de trabajo de bun, firmado con una clave propia. | Android | cambiada en parte por [D29](#d29) y D46 |
| [D21](#d21) (resumen) | Media3 se confirma midiendo en el teléfono, porque gasta menos y suena con la pantalla apagada. | Android | vigente |
| [D22](#d22) (resumen) | La cuenta de Android corre en la página, y la sesión la guarda la app cifrada con el Keystore. | Android | vigente |
| [D23](#d23) (resumen) | Android tiene pantallas propias para el dedo, con Media3 bajo una WebView transparente, la esquina y el PiP. | Android | cambiada en parte por [D43](#d43) |
| [D24](#d24) (resumen) | Lo nuevo va a la extensión y a Android, y los arreglos de reproducción, a las tres. | todas | cambiada en parte por [D44](#d44) y [D50](#d50) |
| [D25](#d25) (resumen) | Android recibe los VOD, retroceder el directo y los emotes, adaptados al dedo. | Android | vigente |
| [D26](#d26) (resumen) | Inicio llega antes al abrir, porque la cuenta se guarda con el token y lo guardado viejo no se enseña. | todas | vigente |
| [D27](#d27) (resumen) | En Android, lo que suena se ve y se pausa desde la notificación, la pantalla de bloqueo y los auriculares. | Android | vigente |
| [D28](#d28) (resumen) | En Android, deslizar hacia abajo sobre el vídeo vuelve atrás. | Android | vigente |
| [D29](#d29) (resumen) | Android se publica desde la 0.3.0 como experimental, y la TV se sigue publicando sin probarla en una TV. | Android y TV | vigente |
| [D30](#d30) | La extensión se prepara para la Chrome Web Store sin listar y para AMO firmada sin ficha. | extensión | vigente |
| [D31](#d31) | El chat de la extensión y de Android se pinta con mucha menos CPU. | extensión y Android | vigente |
| [D32](#d32) | Android pasa a solo audio con la pantalla apagada, y la extensión recuerda la calidad y tiene imagen en imagen. | extensión y Android | cambiada en parte por [D33](#d33) |
| [D33](#d33) | Android pasa a solo audio sin corte con un relevo, y la extensión tiene un chat aparte a pantalla completa. | todas | vigente |
| [D34](#d34) | El reproductor propio salta en vez de acelerar, no ofrece los VOD de suscriptores y numera bien el directo tras un anuncio. | todas | vigente |
| [D35](#d35) | La extensión y Android se pueden poner en inglés, con el texto en español como clave en el código. | extensión y Android | cambiada en parte por [D44](#d44) |
| [D36](#d36) | En Adaptativo, el retraso que añade una parada de 1 a 12 s se conserva como margen. | extensión y TV | vigente |
| [D37](#d37) | El empalme abre la conexión de los fragmentos en cuanto ve un host nuevo en una lista. | extensión y Android | vigente |
| [D38](#d38) | Android reconecta sola tras un fallo, con un límite, y un canal solo «no emite» si lo dice Twitch. | todas | vigente |
| [D39](#d39) | Las conexiones a gql, usher y los hosts de las listas se abren por adelantado. | todas | vigente |
| [D40](#d40) | Android no cuenta una VPN como red, y vuelve a abrir el canal si cambia la red o se acumula retraso. | Android | vigente |
| [D41](#d41) | La interfaz de la extensión y de Android se pule sin colores nuevos, con «Populares ahora» sin cuenta. | extensión y Android | cambiada en parte por [D44](#d44) y [D47](#d47) |
| [D42](#d42) | La extensión puede ver hasta 4 canales en una cuadrícula, con uno grande. | extensión | cambiada en parte por [D48](#d48) |
| [D43](#d43) | El título de Inicio elige entre «En directo» y «Vídeos». | extensión y Android | vigente |
| [D44](#d44) | La TV vuelve a recibir lo nuevo que tenga sentido con un mando, empezando por el idioma y buscar sin cuenta. | TV | cambiada en parte por [D50](#d50) |
| [D45](#d45) | La versión para la televisión se llama «TV» en todo el repo. | TV | vigente |
| [D47](#d47) | La columna de seguidos enseña la categoría a cualquier ancho, con la cifra abreviada. | extensión | vigente |
| [D48](#d48) | Cada pestaña de la extensión suena por su cuenta, y lo que se abre sin verse espera a que se mire. | extensión | vigente |
| [D49](#d49) | Hay un directorio de las categorías más vistas, con sus directos. | todas | vigente |
| [D50](#d50) | La TV deja de recibir funciones nuevas, aunque sigue compilando con el código común. | TV | vigente |
| [D51](#d51) | La TV pierde el reproductor oficial de respaldo, y su servidor local pasa a HTTP en `127.0.0.1`. | TV | vigente |
| [D52](#d52) | Lo ya visto del directo se suelta a los 30 s, el chat de Android se desconecta oculto y las fotos se piden a su tamaño. | todas | vigente |
| [D53](#d53) | En la extensión, los fragmentos del directo no se guardan en la caché de red. | extensión | vigente |
| [D54](#d54) | Un directo que se queda parado de verdad ofrece «Reintentar», y los errores de medios se recuperan con tope. | extensión y TV | vigente |
| [D55](#d55) | «Populares» sale por un solo camino, también con cuenta, y Esc con un menú del reproductor abierto solo lo cierra. | todas | vigente |

## 1. Auditoría breve

> Del 8 de octubre de 2026, sobre VacuumStream 0.2.1. Es historia. Cuenta de dónde salió esta variante, y lo que vale
> hoy está en las decisiones.

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

> Del 8 de octubre de 2026, con el reproductor oficial incrustado. Es historia, porque la app ya no lo usa desde
> [D51](#d51).

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

<a id="d1"></a>**D1. Reproductor.** `Twitch.Player` oficial, una instancia por visita a la pantalla de
reproducción, `setChannel` para cambiar de canal, `autoplay: true`, `muted: false`. Se elimina
`activateEmbeddedPlayer`: sin inyección, sin selectores privados, sin tocar el `<video>`. (Sin efecto desde
[D51](#d51). Desde [D11](#d11) solo era el respaldo.)

<a id="d2"></a>**D2. Nada encima del vídeo.** El diseño garantiza que ningún elemento corta el rectángulo del
iframe: controles, información y chat van al lado o debajo, y el foco no se dibuja sobre él. El
iframe nunca baja de 400×300 px CSS, tampoco durante transiciones. La e2e del recorrido crítico lo
comprueba con geometría y con `IntersectionObserver` v2 desde la página con chat visible, con el
selector de calidad abierto y con el chat oculto; los avisos solo se han revisado en capturas. Señales: READY = API lista; ONLINE/OFFLINE = canal; `PLAYBACK_BLOCKED` = bloqueo; PAUSE
solo cuenta como pausa voluntaria si la pidió la persona. Si hay bloqueo, «Reproducir» intenta
`player.play()` (sin garantía si la política exigiera un gesto real) y «Controles de Twitch»
queda como vía manual. Al volver la página a visible, si la persona no había pausado, se consulta
el estado y se reanuda. Durante la reproducción se impide que la pantalla se apague
(`powerSaveBlocker`). (Cambiada en parte por [D11](#d11) y [D51](#d51). Sin el reproductor oficial, lo que dice de su
marco y de sus señales ya no se aplica.)

<a id="d3"></a>**D3. Una sola ruta de teclado.** El proceso principal intercepta en `before-input-event` las
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

<a id="d4"></a>**D4. «Controles de Twitch» (puerta de contenido).** Modo explícito: el renderer da el foco al
iframe y el proceso principal traduce ↑/← a Mayús+Tab, ↓/→ a Tab y OK a Enter con
`Input.dispatchKeyEvent` por CDP, solo hacia el marco actual de `player.twitch.tv`. Atrás sale y
devuelve el foco a la interfaz. El modo termina al cambiar de canal, salir, perder el foco de la
ventana o navegar. Se adapta `chat-input.ts` de VacuumStream con todas sus comprobaciones antes de cada
envío: ventana activa, marco hijo directo con origen exacto `https://player.twitch.tv`, mismo
marco y URL que al entrar, marco con el foco y sesión vigente. La sesión se invalida **antes** de
`setChannel` y se descarta su cola; ante cualquier fallo vuelve el foco a la interfaz. Queda una
carrera residual: una pareja de eventos ya enviada no se puede retirar. Si Twitch informa
`muted: true` sin pedirlo, se sugiere el modo (es una pista, no una detección). Es la persona
quien pulsa «Start Watching»: no se acepta nada automáticamente. (Sin efecto desde [D51](#d51).)

<a id="d5"></a>**D5. Volver conserva la posición.** Pila de pantallas; Inicio y Buscar siguen montadas (ocultas)
durante la reproducción. Al volver se enfoca el último elemento por su id estable. Las listas se
refrescan en segundo plano; si el canal enfocado desaparece, el foco vuelve al primer canal de la
lista (pasar al vecino queda como mejora).

<a id="d6"></a>**D6. Chat propio.** EventSub por WebSocket desde el proceso principal (`channel.chat.message`,
`message_delete`, `clear`, `clear_user_messages`, ámbito `user:read:chat`); el token no sale del
proceso principal. Emotes de Twitch (fragmentos del mensaje) y de 7TV, BTTV y FFZ (globales y del
canal), validados con Zod y en caché; emotes de anchura cero apilados; máximo de 150 mensajes y
actualizaciones agrupadas. Una sola conexión: cambiar de canal sustituye las suscripciones; se
descartan mensajes de otro canal o sesión; welcome, keepalive, reconnect y revocación tienen
tratamiento propio y la cola es acotada. Sin cuenta vinculada, el panel invita a vincularla. No
se envían mensajes en esta versión. Descartados: IRC anónimo (no documentado) e iframe oficial
(sin 7TV). IRC autenticado también estaría documentado; se prefiere EventSub porque Twitch lo
recomienda y entrega los emotes ya separados. (Cambiada en parte por [D24](#d24) y [D31](#d31).)

<a id="d7"></a>**D7. Cuenta.** Device Code Flow con `user:read:follows` y `user:read:chat`. El Client ID
identifica a la *aplicación*, no a quien la usa: se registra una vez, se incluye al compilar y no
se escribe con el mando. No reutilizamos el de VacuumStream. Vincular la cuenta exige otro
dispositivo (el móvil lee un QR o escribe un código): es la única excepción al uso solo con mando. El inicio de sesión de Helix **no** inicia sesión en el reproductor: no se prometen Turbo
ni ventajas de suscriptor.

<a id="d8"></a>**D8. Alcance.** Fuera: VOD, reanudación, «Seguir viendo», subtítulos, categorías, favoritos,
Steam Deck y Gamepad API. Dentro: Recientes (historial local de canales vistos). (Cambiada en parte por [D24](#d24) y
[D49](#d49).)

<a id="d9"></a>**D9. Empaquetado.** AppImage con electron-builder (`io.github.mateozariquiey.GoodTTV`, a
pantalla completa). El manifiesto Flatpak de VacuumStream se retiró: tenía otra identidad y no
se iba a validar en esta entrega.

<a id="d10"></a>**D10. Hardware.** No se fuerzan flags de VA-API. El diagnóstico separa tres cosas: el
reproductor (estadísticas documentadas, muestreadas tras estabilizarse), la GPU
(`app.getGPUInfo` de Electron) y el audio (herramientas del sistema, fuera de la app). Un vídeo
que avanza no demuestra que la TV reciba imagen fluida ni sonido.

<a id="d11"></a>**D11. Reproductor propio sin anuncios (de uso personal; se publica desde D18).** En lugar del embed
oficial, un `<video>` con hls.js lee un directo que prepara el proceso principal
(`packages/sin-anuncios`, servido por `apps/tv/src/main/stream`): varias sesiones de invitado del mismo canal (`site`, `embed`, `popout` y, desde D16, `mobile_feed` con `platform: android`), que
reciben los anuncios por separado, se empalman por la numeración común de Twitch
(`LIVE-SEQUENCE`), y las pausas en todas a la vez se rellenan con el VOD que Twitch graba del
directo. Usa la API privada del reproductor web y bloquear anuncios incumple las condiciones de
Twitch: es solo para uso personal. Sustituye a D1, D2 (nada tapa un `<video>` propio, pero ya no
es requisito) y D4 cuando se usa; el embed oficial queda como alternativa si el propio falla. (Cambiada en parte por [D51](#d51), que quita ese
respaldo.)
Tres modos de retraso en Ajustes → Reproducción:
- **Adaptativo** (por defecto): pocos segundos de retraso; en las pruebas, la primera pausa
  global del canal fue una sola parada de 12–22 s y, desde ahí, se conserva ese margen (unos 16 s)
  y las siguientes no se notaron.
- **Sin paradas:** unos 22 s por detrás desde el principio; en las pruebas, ninguna pausa global
  se notó.
- **Directo:** el mínimo retraso y sin relleno con el VOD; en una pausa global la imagen se
  congela mientras dura y luego salta al directo.
En los dos primeros, el relleno necesita que el canal tenga el VOD público y que llegue a tiempo;
si no, la imagen se queda quieta durante la pausa. Con el reproductor propio, el chat se retrasa
lo que la imagen va por detrás de lo que ve un espectador normal de Twitch (unos 3 s): la
sincronización es aproximada, y el pie del chat dice cuánto se retrasa. Si al abrir un canal las
sesiones traen anuncio de entrada, se empieza en el VOD (salvo en *Directo*) en vez de esperar
a que acabe alguno.
Investigación, mediciones y límites: `investigacion/informe/informe.md`.

<a id="d12"></a>**D12. Familia GoodTTV en un monorepo privado (11 oct).** GoodTTV pasa a ser una familia de
versiones: la TV, el navegador y, más adelante, Android. Todas viven en un solo repo privado,
`goodttv-privado`, con espacios de trabajo de bun: `apps/` (una carpeta por versión) y `packages/`
(código común). Así, cuando Twitch cambie algo, se arregla una vez para todas. El código común se
extrae cuando lo necesita una segunda versión, no antes; de momento solo `packages/sin-anuncios`.
Es privado porque incluye lo sin anuncios (D11). El repo público `GoodTTV` (0.1.0, embed oficial;
etiqueta `v0.1.0` aquí) no cambia, hasta D18. Descartado: un repo por versión, porque cada arreglo
habría que repetirlo en todos.

<a id="d13"></a>**D13. Versión de navegador: GoodTTV como extensión de Chrome y Firefox (11 oct).** Una página
propia de la extensión con la interfaz de GoodTTV, adaptada a sobremesa (ratón y ventana), y el
reproductor propio sin anuncios. Las páginas de extensión con `host_permissions` no están sujetas a
CORS, así que piden usher, las listas y los trozos del VOD como hoy el proceso principal. Comprobado
en Chrome y Firefox: directo a 1080p con hls.js y trozo del VOD leído. Se descartó el enfoque A
(enganchar el worker del reproductor de twitch.tv) porque no aprovecha el relleno con el VOD ni el
reproductor de GoodTTV, y depende del reproductor interno de twitch.tv, cuyos cambios de 2026 ya han roto
varias veces a los bloqueadores que lo usan.
Alcance: el de GoodTTV (directos, seguidos, búsqueda y chat de lectura); para lo demás, twitch.tv. (Cambiada en parte
por [D24](#d24) y [D49](#d49), que amplían el alcance.)
Investigación: `investigacion/navegador/informe.md`.

<a id="d14"></a>**D14. La extensión tiene su propia interfaz de escritorio (11 oct).** La de la TV está hecha para
un mando a 3 m: botones grandes, foco que se mueve con flechas, teclado en pantalla. Con ratón y
teclado se maneja de otra forma, así que la extensión tiene pantallas propias
(`apps/navegador/src/escritorio`):
- columna de seguidos y miniaturas;
- búsqueda siempre arriba;
- controles sobre el vídeo y modo teatro;
- ajustes con interruptores y selectores;
- atajos de teclado.

Conserva la esencia: fondo casi negro, Atkinson Hyperlegible, el blanco como única marca de
selección y el rojo solo para «en directo». Comparte con la TV toda la lógica (reproductor sin
anuncios, chat con su retraso, cuenta, datos), no las pantallas. Descartado: adaptar con CSS la
interfaz de la TV (a escala de escritorio), que el usuario vio en prototipos y prefirió no seguir.
Se eligió sobre una maqueta interactiva con datos reales.

<a id="d15"></a>**D15. La extensión se instala sin firmar (11 oct, cambiada en parte por [D18](#d18) y [D30](#d30)).** Es de uso personal y no se publica:
- **Chrome:** se carga descomprimida.
- **Zen:** el navegador diario de la familia Firefox. Instala el `.xpi` sin firmar de forma
  permanente si se pone `xpinstall.signatures.required` a `false`. Comprobado: sigue al reiniciar
  y conserva los datos al actualizarla.
- **Firefox:** exige la firma, así que solo admite la instalación temporal.

Para que Firefox la cargue de forma permanente, habría que firmarla en AMO como «unlisted»: Mozilla
la firma sin publicarla. Eso pide una cuenta de desarrollador en AMO y subir cada versión a Mozilla,
a mano en su web o, si se automatiza, con claves de API. No hace falta mientras Zen acepte
complementos sin firmar. `out/goodttv-<versión>.xpi`
sirve para ambas vías. Consecuencia: la preferencia afecta a todo el perfil de Zen, que seguirá
pidiendo confirmación antes de instalar cualquier complemento, pero ya no exigirá la firma de
Mozilla.

<a id="d16"></a>**D16. Rendimiento del reproductor propio (12 oct).** Medido con una prueba nueva
(`apps/navegador/test/humo/rendimiento.mjs`) en Chrome con la GPU del laboratorio, comparando a la vez
la versión anterior y la nueva con los mismos canales. Lo que había y lo que se cambió:
- **Arranque lento por el empalme:** abría la primera sesión, luego las otras dos, y solo entonces
  consultaba las listas; `info` miraba cada 250 ms si había algo publicado. Ahora las sesiones se
  abren a la vez, cada una consulta en cuanto abre, publica la primera que da directo e `info`
  contesta al momento. Solo se arranca desde el VOD si todas, ya abiertas, traen anuncio.
- **Fotogramas perdidos al abrir cada canal:** hls.js no empieza más cerca del final de la lista que
  `TARGETDURATION` (13 s con relleno), así que arrancaba ~1,5 s más atrás de lo pedido y aceleraba a
  1,05× unos 30 s: un vídeo de 60 fps a 1,05× pide 63 fotogramas por segundo y se descartaba ~1 de
  cada 20. Ahora empieza a cargar en el objetivo y, durante los 10 primeros segundos, el margen que
  sobre se salta (un salto de ~1-2 s hacia el segundo 3) en vez de acelerar.
- **Latencia:** el último fragmento de Twitch (PREFETCH) se descarga a la vez que se codifica, durante
  ~2 s, y hls.js esperaba a tenerlo entero; por eso hacía falta un margen de 3 fragmentos. Con la
  carga progresiva se añade a medida que llega, y el margen baja a 2,5 fragmentos con más búfer que
  antes.
- **Esperas evitables tras una lista sin novedades:** hls.js deja entonces de bloquear y vuelve a
  preguntar cada 6,5 s, lo que podía retrasar hasta 6,5 s la llegada de un trozo del VOD. El directo
  retiene ahora la petición hasta 20 s, también la que llega sin `_HLS_msn`.
- **Precalentar:** con el ratón parado sobre un canal (extensión) o el foco quieto en él (TV), el
  directo abre ya ese empalme, aparte del que suena.
- **Una cuarta sesión, `mobile_feed` con `platform: android`, de respaldo:** el 12 de octubre, en las cuatro
  pausas globales reales que hubo en 100 min (16-44 s, en `trymacs`, con anuncio en `site`, `embed` y
  `popout` a la vez), siguió dando el directo,
  y no tuvo ningún anuncio en unos 5000 sondeos (6 canales, 100 min). Da 1080p60 y los mismos fragmentos que las demás, así que
  se empalma igual. Es la única fuente gratuita vista que cubre una pausa global: si sigue así, esas
  pausas ya no paran la imagen ni obligan a rellenar con el VOD, que queda de respaldo por si las
  cuatro coinciden. Lo afirmaba un bloqueador (scamorza) y nadie lo había comprobado
  (`investigacion/navegador/estado-del-arte.md`). Cuatro pausas en un canal no prueban que siempre sea así.
- **El chat:** cada lote volvía a pintar los 150 mensajes, y cada mensaje nuevo recolocaba toda la
  pantalla. Ahora se pintan solo los nuevos y la lista está contenida (`contain: strict`). Con un chat
  de 40 mensajes por segundo, lo primero baja el JavaScript del 1,5-1,9 % al 0,8-1,2 %, y la
  contención, el hilo de la página del 7,6 % al 5,3 % ocupado.

Resultado (12 arranques por versión, mediana): primer fotograma de 1,36 a 1,12 s, y ~0,52 s si se
precalienta medio segundo antes; latencia de 3,5 a 1,9 s; fotogramas perdidos del 5 % al 0,1 %, y búfer
mínimo de 1,0 a 1,5 s, sin paradas. En Firefox, latencia de 3,1 a 1,7 s y el vídeo avanzando a los 2,1 s
en vez de 4,0 s. En la TV, el primer fotograma pasa de 1,64 a 1,08 s. La primera
pausa global simulada en Adaptativo para 10-12 s, como antes (12 s). Detalle y límites en
[verificacion.md](verificacion/hasta-0.2.0.md#rendimiento-del-reproductor-propio).

Descartado:
- **El worker de hls.js:** con un directo a 1080p60, el hilo de la página está ocupado un 1-1,5 % del
  tiempo; no hace falta sacar el demultiplexado de él.
- **Acortar la primera parada de Adaptativo** más allá de las esperas evitables: el VOD llega en
  trozos de ~10 s y ninguna fuente gratuita da el directo en esa pausa. Lo que la evita es el margen
  de «Sin paradas».
- **Consultar las listas en fase con Twitch.** Twitch añade cada fragmento a las listas de todas las
  sesiones a la vez (con menos de 50 ms de diferencia entre ellas, y periodos de 1941 a 2064 ms con
  fragmentos de 2 s). Estimando esa hora y consultando justo después, el retraso de publicación bajó
  de 286-572 ms a 128-153 ms de mediana, con las mismas consultas. Pero en el reproductor no se nota
  (15 sesiones emparejadas: latencia igual en la mediana, búfer mínimo de 1,31 a 1,13 s y una parada
  más): publicar antes solo acerca la posición al borde y quita búfer en la misma medida, como bajar
  el margen.

Codex (`gpt-6.1-sol`, razonamiento xhigh) propuso mejoras por su cuenta y después revisó el diff. De la
revisión se aceptaron y corrigieron cuatro fallos, con una prueba cada uno:
- `info` podía bloquear la página hasta 20 s si su empalme se paraba mientras esperaba;
- con las aperturas a la vez, dos sesiones que fallan y reintentan podían dar el canal por
  desconectado mientras la tercera abría;
- una sola sesión con anuncio podía arrancar desde el VOD sin esperar a las otras;
- una apertura lenta con la emisión anterior podía deshacer el cambio de emisión.

<a id="d17"></a>**D17. La interfaz de escritorio escala con el zoom sin saltos (12 oct).** El usuario no entendía cómo
escalaba con Ctrl +: a veces la veía más grande con menos zoom. Ctrl + agranda el píxel CSS, así que la
ventana mide menos px CSS. La columna de seguidos (240 px) y el chat (340 px) tenían un ancho fijo, así
que crecían en pantalla y encogían el vídeo. Por debajo de 980 px CSS, el chat bajaba y el vídeo saltaba
a todo el ancho, más alto que la ventana. En una ventana de 1904 × 980, con el chat, el vídeo pasaba de
1324 px a 802 px entre el 100 y el 190 %, y a 1746 px al 200 %. Entre propuestas con capturas y
medidas de 100 a 200 %, eligió:
- **El vídeo conserva todo el espacio posible y nunca crece al subir el zoom.** La columna de seguidos
  y el chat encogen en px CSS con la ventana (`clamp(180px, 12.5vw, 240px)` y
  `clamp(280px, 17.7vw, 340px)`), así que en pantalla miden lo mismo hasta su mínimo. Nunca es más
  alto que la ventana. Con el chat debajo, también en modo teatro, ocupa como mucho media ventana de
  alto y deja la otra mitad para la ficha y el chat. Ese alto no cambia con el zoom, así que al bajar
  el chat el vídeo no crece. El mismo caso: 1329 px al 100 y al 110 %, 1214 al 150 %, 1029 al 190 %
  y 871 del 200 % en adelante.
- **Los controles se adaptan al ancho del vídeo** (container queries sobre `.stage`, también a
  pantalla completa). Por debajo de 700 px CSS se quita «x s por detrás» y, por debajo de 580 px,
  «En directo»: solo informan. La barra de volumen y los botones se quedan. (Esos umbrales cambiaron en D41.)
- **Las tarjetas de Inicio siguen rellenando la fila.** Como la columna de seguidos ya no crece en
  pantalla, entre un número de columnas y otro encogen como mucho un 3 %, y al caber una menos
  crecen. Antes retrocedían hasta un 18 %.
- **Coste aceptado:**
  - con zoom, el chat tiene líneas más cortas (al 150 %, 280 px CSS en vez de 340);
  - en ventanas de menos de 1920 px, las columnas ya son algo más estrechas sin zoom, porque el CSS no
    distingue el zoom de una ventana más estrecha;
  - con el chat debajo, el vídeo encoge de golpe: del 190 al 200 % pasa de 1029 a 871 px, y en modo
    teatro, de 1372 a 871.

Descartado:
- **Tarjetas de ancho fijo:** crecen igual que el texto, pero dejan hasta un tercio de la fila vacío.
- **El chat a 340 px CSS con cualquier zoom:** el vídeo bajaba a ~800 px al 190 % y crecía al pasar el
  chat debajo.

Codex (`gpt-6.1-sol`, razonamiento alto) revisó el diff y encontró dos fallos, corregidos:
- **Con el chat debajo, el vídeo aún podía crecer.** Dejaba 160 px fijos para la ficha y, en ventanas
  16:10, al bajar el chat crecía: un 37 % en una de 1440 × 900. Ahora ocupa como mucho media ventana
  de alto. Medido en ventanas de 1904 × 980, 1680 × 990 y 1440 × 900: ya no crece en ningún paso de
  zoom.
- **Se ocultaba la barra de volumen cuando el vídeo era estrecho.** Se suponía que ↑ ↓ cambiaban el
  volumen, pero cambian de canal: solo quedaba el silencio. Ahora se oculta «En directo».

Medidas en [verificacion.md](verificacion/hasta-0.2.0.md#barra-de-volumen-y-zoom).

<a id="d18"></a>**D18. Lo terminado se publica en el repo público GoodTTV (12 oct).** GoodTTV se enseña como proyecto
personal. Este repo sigue siendo el de trabajo, con la investigación, el laboratorio y lo que está a medias. Lo
terminado se copia al repo público `mateozariquiey/GoodTTV` con un commit por versión, como ya se hizo con la 0.1.0. (Cambiada en parte por [D29](#d29) y [D30](#d30).)
- **Qué se publica:** las apps, los paquetes, la documentación y la configuración, con el reproductor sin anuncios.
  La extensión no funciona sin él, porque Manifest V3 no deja cargar el reproductor oficial (D13), así que publicar
  las tres versiones obliga a publicarlo. El README avisa de que incumple las condiciones de Twitch.
- **Qué no:** la investigación, los scripts del laboratorio y sus datos, las notas de trabajo, las ramas sin terminar
  y el historial de este repo.
- **Cómo:** un script del repo de trabajo copia solo una lista de rutas y quita de los documentos las partes que solo
  tienen sentido aquí. Después comprueba que no se cuelan secretos, correos personales ni rutas de un equipo. Nada se
  sube sin revisar el resultado.
- **Sin tiendas:** ni Chrome Web Store ni AMO. Se instala desde las releases, como en D15. Lo cambia D30.
- **Versiones:** la 0.2.0, con la TV y la extensión, sale como pre-release porque la TV no se ha probado en el
  mini PC. Android se publicará cuando esté terminada.

Descartado:
- **Hacer público este repo:** expondría todo lo anterior, y quitar el correo de los commits obligaría a reescribir
  su historial.
- **Publicar sin el reproductor sin anuncios:** el público se quedaría en la TV con el reproductor oficial, sin
  extensión.

<a id="d19-d29"></a>**D19-D29. Las decisiones de Android, en resumen.** El detalle completo no se publica, porque está lleno de datos de los
equipos con los que se desarrolla:
- <a id="d19"></a>**D19. Una WebView con la interfaz y Media3 para el vídeo.** El objetivo es que siga sonando con la pantalla apagada o
  en segundo plano. La interfaz web va en una WebView, el empalme en JavaScript (`sin-anuncios`) en otra oculta, el
  «motor», y el vídeo con Media3, con un servicio en primer plano. Así hay una sola implementación del empalme (D12).
  Descartadas: todo en la WebView, porque Chromium pausa el vídeo en segundo plano y Android corta la red de la app a los
  ~2 s; una app nativa con Compose, que obliga a reescribir las pantallas y a portar los servicios; y portar el empalme a
  Kotlin, que serían dos implementaciones. No hay versión para Android TV.
- <a id="d20"></a>**D20. El proyecto.** Gradle en Kotlin en `apps/android`, con `minSdk` 33. No es un espacio de trabajo de bun: Gradle
  compila la página con el `tsc` y el Vite de la raíz, y `bun run verify` no necesita el SDK de Android. Las versiones
  publicadas se firman con una clave propia que vive fuera del repo.
- <a id="d21"></a>**D21. Media3 confirmado midiendo en el teléfono.** Frente a reproducir en la WebView, gastó un 16 % menos de energía en
  12 parejas de visitas (121 frente a 155 % de un núcleo de CPU), sin paradas detectadas, y es la única opción que suena
  con la pantalla apagada. En fotogramas perdidos no ganó: 18 de ~40 000, frente a 0.
- <a id="d22"></a>**D22. La cuenta.** Corre en la página, con el mismo `window.api` que la extensión (`createPageApi`). La sesión la guarda
  la app, cifrada con una clave del Keystore que no sale del teléfono, y lo demás va en el `localStorage` de la WebView.
  Nada va a copias de seguridad. Hay una sola `MainActivity`, porque el token de renovación solo vale una vez.
- <a id="d23"></a>**D23. La interfaz.** Pantallas propias para el dedo, sin barra de pestañas, con Media3 debajo de una WebView transparente
  en el sitio del vídeo, de modo que hay una sola página y girar el teléfono no recarga nada. Como en la app de Twitch, el
  canal que se deja sigue en una esquina, y al salir de la app, en imagen en imagen.
- <a id="d24"></a>**D24. Funciones nuevas sin paridad obligatoria.** Los arreglos y las mejoras de reproducción, del empalme y del
  rendimiento siguen yendo a las tres versiones, con el código común en `packages/`. Lo nuevo va a la extensión y a Android,
  y a la TV solo si se decide. Seguir y dejar de seguir canales queda descartado: la API oficial lo quitó en 2021, y la
  única vía conocida pide una sesión con mucho más poder sobre la cuenta. Desde el 6 de noviembre, lo nuevo también va a
  la TV cuando tiene sentido con un mando (D44). (Lo deshace [D50](#d50) el 18 de noviembre.)
- <a id="d25"></a>**D25. Los VOD, retroceder el directo y los emotes en el teléfono.** Lo mismo que la extensión, adaptado al dedo. Un VOD
  va con Media3 y sin el motor. Se retrocede dentro de la lista del empalme y, más atrás, en el VOD de la emisión. Los saltos
  van al fotograma clave (0,05-0,2 s frente a 0,4-1,5 s), a cambio de hasta 1 s de precisión en un VOD y 2 s en directo.
- <a id="d26"></a>**D26. Inicio al abrir, sin esperas en cadena (en las tres versiones).** La cuenta se guarda con el token, así que lo que
  se pide a Twitch ya no espera a validar la sesión: lo de ahora llega en ~0,2 s en vez de ~0,7 s. Lo guardado solo se
  enseña tal cual si es de hace menos de 5 min; si no, se pinta la forma de las listas, vacía, que no enseña nada falso.
- <a id="d27"></a>**D27. Los mandos del sistema.** Lo que suena se ve en la notificación y en la pantalla de bloqueo, y se pausa desde ahí y
  con los auriculares. Va con una sesión de medios sobre el reproductor de la app, sin `MediaSessionService`, porque este sale
  del primer plano como mucho a los 10 min de pausa, y sin primer plano Android corta la red a la app.
- <a id="d28"></a>**D28. Deslizar hacia abajo sobre el vídeo para volver,** como en la app de Twitch, solo con el dedo.
- <a id="d29"></a>**D29. Android se publica desde la 0.3.0, como experimental,** y la TV se sigue publicando sin comprobarla en una TV de
  verdad, solo con las pruebas automáticas.

<a id="d30"></a>**D30. La extensión, en las tiendas (24 oct).** Para que la instale y la actualice cualquiera sin el modo de
desarrollador de Chrome ni `about:config`. El usuario asume que una tienda la rechace o la retire. Cambia D18 («sin
tiendas»), y se prepara sin publicar: se subirá cuando el usuario lo diga.
- **Chrome Web Store, «no listada»:** se instala con el enlace y se actualiza sola. Es la única forma de instalarla
  firmada en Chrome en Windows y macOS. Su política prohíbe facilitar «the unauthorized access, download, or streaming
  of copyrighted content», y un revisor podría aplicárnosla: otras para quitar los anuncios de Twitch siguen
  publicadas (Purple, TTV LOL PRO), y otra ya no está (Alternate Player), sin que se sepa por qué.
- **Firefox: firmada en AMO sin ficha** y distribuida desde las releases. Firefox, también el normal, y Zen la instalan
  sin cambiar nada, y se actualiza sola con `updates.json` del repo público (`gecko.update_url`), como la versión de
  desarrollo de uBlock Origin. La firma pasa una validación automática (`web-ext lint --self-hosted`: sin errores), y
  Mozilla puede revisarla después.
- **Lo que sale hacia Twitch se declara:** a Firefox, el token de la cuenta (`authenticationInfo`) y los mensajes que
  se escriben en el chat (`personalCommunications`), como obligatorios. Su guía no aclara si cuenta lo que se manda al
  servicio que se está usando, y así no se queda corto. La política de privacidad está en `PRIVACY.md`.
- **Dos paquetes:** el `.xpi` y un `-chrome.zip` sin lo de Firefox en el manifiesto, que también ahorra cambiarle la
  extensión al descargarlo para Chrome. La compilación es reproducible, también en arm64, como pide AMO para revisar
  el código.

Descartado:
- **AMO con ficha:** más visible, con la revisión de la ficha y sin `update_url`, para lo mismo que ya dan las
  releases con las actualizaciones automáticas.
- **Chrome fuera de la tienda (un CRX propio):** Chrome solo lo instala en Linux.

Investigación: `investigacion/navegador/tiendas.md`.

<a id="d31"></a>**D31. El chat, barato de pintar en la extensión y en Android (24 oct).** Medido en Chrome con la GPU, el chat real de
un canal con mucho movimiento costaba casi lo mismo que el vídeo: el navegador pasaba del 25 % de un núcleo sin chat al
48 % con él. Una traza dio cuatro causas, todas de cómo se pintaba, no de cuánto se recibe:
- **Cada lote de mensajes rehacía la maquetación de la página entera** (~1250 elementos, 3-5 ms, unas 10 veces por
  segundo). La lista lleva `contain: strict` (D16) para que no pase, pero Chrome no maqueta aparte a una hija de una
  rejilla o de un flex, y la lista lo era. Ahora va dentro de un bloque: solo se maqueta ella (0,2 ms).
- **Cada lote volvía a pintar el canal entero en React:** el chat vivía en la vista del canal, con los controles, la
  ficha y los vídeos de debajo. Además, cada tarjeta de vídeo leía y parseaba entero lo guardado de los VOD
  (`vods-vistos`, hasta 100) en cada pintado: unas 275 veces por segundo con 25 tarjetas. Ahora el chat va en su propio
  componente, la lista de vídeos está memoizada y lo guardado solo se vuelve a parsear si ha cambiado.
- **Cada mensaje nuevo quitaba el más antiguo,** y todos los demás se movían y se volvían a pintar. Ahora se quitan
  por tandas de 50: la lista guarda entre 150 y 200, también en el chat de un VOD.
- **En pantallas a 1x, Chrome no componía aparte el desplazamiento del chat,** para no perder los subpíxeles del
  texto, así que cada lote volvía a dibujar todo el chat visible. Con un fondo opaco en la lista (el mismo del panel)
  lo compone sin perderlos. Solo en la extensión: en el teléfono, a más de 1x, ya lo hacía.

Resultado en Chrome, con las dos versiones a la vez leyendo el mismo chat: con 15 mensajes por segundo idénticos, la CPU
del navegador baja del 39,5 al 29,3 % de un núcleo (−26 %) y el hilo de la página, del 14,1 al 7,0 % (−50 %); con el
chat real de `xqc` (4-12 mensajes por segundo), el hilo de la página baja un 22-33 %. En Zen, el proceso de la página
baja un 22 % (Firefox no tenía el problema de la maquetación). En Android, en el emulador, el proceso de la WebView baja
un 21 %. Ir de canal en canal no acumula memoria, nodos ni listeners. Detalle en
[verificacion.md](verificacion/0.4.0.md#el-chat-barato-de-pintar-d31).

Descartado:
- **`content-visibility: auto` en los mensajes,** para no pintar los que no se ven: sale peor (el hilo de la página,
  del 6,9 al 9 %), porque el navegador decide en cada fotograma cuáles entran y salen de la vista.
- **`will-change: scroll-position`** en vez del fondo opaco: ahorra lo mismo, pero el texto del chat pierde los
  subpíxeles.

<a id="d32"></a>**D32. Solo audio con la pantalla apagada, la calidad recordada e imagen en imagen (24 oct).** El usuario eligió cuatro
de las propuestas del repaso antes de la 1.0, y descartó los avisos de directo y el formato corto de los espectadores
en la columna. La imagen en imagen, solo si no costaba rendimiento.
- **Android: con la pantalla apagada, solo audio.** Al dejar de verse la app (la pantalla apagada, otra app delante, o
  el PiP con la pantalla apagada), el canal se vuelve a abrir en la variante de solo audio de Twitch, y al volver a
  verse, con vídeo. Solo si suena en el directo, sin pausa ni retroceder (si no, se perdería dónde estaba). Pasa por el
  empalme, que admite `audio_only@0` como una calidad más: pedir a Twitch su lista de solo audio directamente traería
  los anuncios. Sin el relleno con el VOD, cuyos trozos son de vídeo y se sitúan por la imagen: en una pausa de anuncios
  de todas las sesiones, silencio, como en el modo *Directo*. Si el canal no da solo audio, el vídeo que menos gasta.
  Medido en el emulador: con la pantalla apagada, de 8,3 a 0,39 Mbit/s (unos 175 MB por hora en vez de ~3,7 GB). El
  precio: cambiar era volver a abrir el canal, con un corte de sonido al apagarla y una carga al encenderla (en el S25,
  el vídeo a los 0,92 s de desbloquear). Lo quita el relevo (D33). Los VOD siguen igual.
- **La extensión: la calidad del directo, como el volumen.** Se guarda en el `localStorage` de la página (una pestaña
  nueva, o al volver a abrir, empieza con la última que se eligió), y el menú tiene «Auto» (la mejor que dé el canal:
  «Auto (1080p60)»). Sin calidad pedida, el directo ya no reutiliza un empalme abierto con otra: al volver a «Auto»
  tras 720p, se quedaba en 720p.
- **La extensión: al retroceder al VOD, la calidad del directo.** Empieza y se queda en ella (la misma, la de la misma
  altura o la mejor que no pase de ella): quien la bajó para ahorrar no ve el VOD en 1080p. Los VOD que se abren por su
  cuenta siguen en automática.
- **La extensión: imagen en imagen,** con un botón en el directo y en un VOD, donde el navegador la admite (Chrome,
  Firefox 158 y Zen 1.23 la tienen), y no con el vídeo estrecho, para que quepan los controles. Mientras no se usa, no
  hace nada. Usándola, la CPU del navegador, igual (+0,1-0,5 puntos en tres medidas). Se cierra al cambiar de canal o
  retroceder al VOD (cada uno tiene su `<video>`).

<a id="d33"></a>**D33. Sin corte al pasar a solo audio, y el chat a pantalla completa, aparte (24 oct).** Probando D32 en el S25, el
usuario notó un corte de sonido de ~0,5 s al apagar la pantalla y una carga al encenderla. Y en la extensión, la
pantalla completa con el chat dependía de dos botones a la vez (el modo teatro y el chat de la ventana), y no se
entendía.
- **Android: el relevo.** Pasar a solo audio o volver al vídeo ya no es volver a abrir el canal. El reproductor nuevo se
  prepara callado mientras el de antes suena, y se coloca en la misma hora de los fragmentos (PDT), 1,5 s por delante.
  Cuando el de antes llega ahí, suena el nuevo y se suelta el de antes. En el emulador quedan a 1-5 ms uno del otro, la
  página no ve ninguna carga y la sesión de medios sigue en «PLAYING». Si algo falla, o no está en 12 s, se cambia como
  antes. Al encenderse la pantalla, aún bloqueada, el vídeo ya empieza a volver, y al desbloquear está (en el emulador, a
  los 40-50 ms; sin esto, ~2,3 s). Si se apaga sin desbloquearla, otra vez solo audio. Lo retrocedido sigue
  retrocedido.
- **El motor: el empalme de antes sigue un rato.** Si otro reproductor (otra visita) pide otra calidad del mismo canal,
  el empalme de antes no se para: sirve al suyo (su lista y sus trozos del VOD) hasta 10 s después de su última
  petición. El relevo lo necesita: si no, cada petición del de antes pararía el del nuevo, y al revés. En las tres
  versiones, además, una petición tardía del reproductor de antes ya no para el nuevo al cambiar de calidad. Con otro
  canal se paran los dos, como siempre.
- **La extensión: la pantalla completa, con su propio chat.** Ahí solo cuenta C (o su botón). Empieza oculto, como en
  Twitch, YouTube y Android en horizontal, y se recuerda en el `localStorage` de la página, aparte del chat de la
  ventana. El modo teatro es solo de la ventana: a pantalla completa, su botón no sale y T no hace nada. Antes eran tres
  mandos que se cruzaban (ocho combinaciones para cuatro vistas, y C no hacía nada a pantalla completa sin el modo
  teatro). El usuario la eligió entre tres opciones. Las otras: un solo chat para todo (quitarlo a pantalla completa lo
  quitaba también de la ventana) y que el modo teatro llevara siempre el chat (lo que se ve seguiría dependiendo de dónde
  se pulsara F).
- **Android: el chat en horizontal también se recuerda siempre,** en cualquier canal o VOD y al volver a abrir la app.
  Antes valía mientras se veía el mismo canal.

<a id="d34"></a>**D34. Saltar en vez de acelerar, y lo que salió del audio desincronizado (29 oct).** El usuario notó el audio
desincronizado en el canal de `jaimemellado_` con la 0.4.0, y pidió ← → para retroceder y avanzar 10 s, como en YouTube.
- **El reproductor propio ya no acelera para recuperar el margen.** Con margen de más (una parada, o en *Adaptativo*
  antes del primer relleno) aceleraba a 1,05× hasta recuperarlo. En Zen, como en Firefox, cada cambio de velocidad deja
  el sonido algo más atrás de la imagen, y ahí se queda: con un directo sintético de pitidos y destellos, 2,9 s tras
  5 min alternando 1,05× y 1×, y a velocidad fija nada que se acumule. En Chrome, nada. Es un fallo abierto de Firefox
  ([1762617](https://bugzilla.mozilla.org/show_bug.cgi?id=1762617)). Los VOD de `jaimemellado_` son solo para
  suscriptores, así que su canal nunca tiene relleno y *Adaptativo* no dejaba de acelerar, y tras una pausa de 40 s
  aceleraba unos 13 min. Ahora lo que sobra se salta de una vez, como ya se hacía al arrancar, y lo pausado (más de 1 s)
  se conserva como lo retrocedido, con «Ir al directo» (en *Directo* y en la TV, que no tiene ese botón, se salta). La velocidad
  que se elige en un VOD no cambia: es un cambio, no uno cada pocos segundos. Android no cambia: Media3 no ajusta la
  velocidad.
- **Los VOD solo para suscriptores no se ofrecen para retroceder.** ← más allá de la lista, la barra o reanudar tras
  más de un minuto en pausa abrían ese VOD, que solo dice «Este vídeo es solo para suscriptores». `liveArchive` mira el
  token de invitado del VOD: si restringe calidades (`chansub.restricted_bitrates`), como si no hubiera VOD. En la
  extensión y en Android.
- **El empalme numera bien el directo alrededor de un anuncio.** Al acabar un anuncio a mitad de emisión, la lista de
  la sesión lleva dos `LIVE-SEQUENCE`: la del directo de antes y la del de después. Se leía la última y se aplicaba al
  primer fragmento en directo, el de antes, que quedaba 10-15 índices desplazado: en cada fin de anuncio, unos 30 s de
  paradas y un salto atrás con contenido repetido, y después minutos acelerando (en Zen, más desfase de audio). Ahora
  cuenta la que va delante de él. Y una lista que acaba en anuncio con
  `LIVE-SEQUENCE` muy por debajo de lo publicado ya no es una emisión nueva: con `LIVE-SEQUENCE` 0 al entrar una sesión
  en anuncio, el empalme reiniciaba la línea de tiempo, se saltaba miles de índices y el vídeo daba un salto de
  30-40 s (visto en `opoartstudy` en dos vigías a la vez). En las tres versiones.
- **← → tras tocar el volumen con el ratón.** Desde la 0.3.0 retroceden y avanzan 10 s en el directo y en un VOD, pero
  el volumen tocado con el ratón se quedaba con el foco, y ← lo bajaba un 1 %, que ni se nota. Ahora ← → son de un
  control solo si se llegó a él con el teclado, como Espacio; ↑ ↓ siguen moviendo el volumen.

<a id="d35"></a>**D35. El idioma a mano, en la extensión y en Android (3 nov).** Lo pidió el
[issue #1](https://github.com/mateozariquiey/GoodTTV/issues/1) del repo público, de alguien que no lee español. Todo el
texto estaba escrito en español en el código, así que hacía falta traducir (al inglés) además del selector:
- **Sistema, Español o English, en los ajustes.** «Sistema» es español si el del navegador o el teléfono lo es, y si no,
  inglés. Es lo que trae por defecto, así que quien tenga el sistema en inglés pasa a verla en inglés sin tocar nada.
- **El español sigue en el código, y es la clave de su traducción:** `t("Ajustes")` da «Settings» (`idioma.ts`,
  `idioma-en.ts`). Las pantallas se siguen leyendo igual, y los tipos no dejan usar una frase sin traducir. Una prueba
  avisa si queda texto en una pantalla sin pasar por `t()`, porque eso los tipos no lo ven.
- **Se guarda en el `localStorage` de la página, y no en las preferencias:** se lee sin esperar, para no pintar Inicio primero
  en el otro idioma, el evento `storage` avisa a las demás pestañas, y no cambia nada en el contrato que comparte la TV.
- **Se aplica sin recargar:** la raíz vuelve a pintar todo, y el vídeo sigue sonando. Los componentes con `memo` piden
  `useIdioma()`. Lo que no pasa por la página se lo dice ella: el menú contextual del fondo, por `chrome.storage`, y lo poco que
  pinta la app de Android (la esquina, la imagen en imagen, el nombre del canal de notificaciones), por el puente.
- **«Populares» va en el idioma elegido;** con «Sistema», en el del sistema, aunque la interfaz no esté traducida a él.
- **La TV sigue en español:** no llama a `activarIdioma`, y hasta entonces `t()` devuelve la frase tal cual (D24). Desde
  el 6 de noviembre también está en inglés (D44).

- **Los mensajes de `@goodttv/servicios` (4 nov) también van en español en el código,** y la pantalla los traduce al pintarlos
  con `tMensaje`, porque servicios no conoce el idioma: en la TV corre en el proceso principal. Llegan como texto, así que los
  tipos no los ven, y una prueba los busca en el código de servicios. Lo que no es nuestro (el motivo que da Twitch para no enviar
  un mensaje, los errores de red) se queda como viene. Antes llegaban en inglés con la interfaz en español (AND-2).
- **La descripción del manifest (4 nov) va en `_locales`,** con `en` por defecto: un navegador en alemán la ve en inglés, como
  «Sistema» en la interfaz.

Sin traducir: los nombres de categoría, que los da Twitch.

Descartado:
- **i18next o similares:** una dependencia para `t()`, que aquí son pocas líneas.
- **Claves abstractas** (`t("ajustes.titulo")`): obligan a ir al diccionario para saber qué dice una pantalla.
- **Recargar al cambiar:** cortaría el vídeo en las demás pestañas.

<a id="d36"></a>**D36. Adaptativo conserva lo que añade una parada de unos segundos (REN-2, 4 nov).** Algunos canales entregan a trompicones: su
lista se queda quieta 4-7 s de vez en cuando, y con 1-2 s de búfer eso es una parada. Subir el margen a todos cuesta 3 s en los
canales regulares, que son casi todos, para nada ([verificación](verificacion/0.5.0.md#las-paradas-el-margen-y-el-dns-de-los-fragmentos-rep-2-rep-5-ren-2-ren-3)).
Así que, en Adaptativo, tras una parada de 1 a 12 s en pleno directo, el retraso que ha añadido se conserva durante esa visita,
en vez de saltárselo: es justo el margen que le faltaba al canal, sin elegir ninguna cifra, igual que tras el primer relleno con el
VOD (`keepMargin`). Por debajo de 1 s es un tropiezo. Por encima de 12 s es una pausa global sin VOD, o que la emisión se ha caído,
y dejaría un retraso enorme para siempre. No cuentan la espera del arranque, las de un salto ni las de una pausa. En *Directo* y
*Sin paradas*, nada cambia. La visita siguiente vuelve a empezar con el margen corto; recordarlo por canal se deja hasta ver si hace falta.
Android no lo necesita: Media3 va a velocidad fija y no salta tras una parada, así que ya conserva ese retraso (`sinAcelerar` en
`Reproductor.kt`, leído en el código). Por encima de 12 s, sí: D40.

<a id="d37"></a>**D37. La conexión de los fragmentos se abre al ver la lista (REN-3, 4 nov).** Lo que tarda el primer fragmento de un host nuevo es
casi todo DNS: ~310 ms, con cualquier resolvedor, porque Twitch da TTL 0. La vía no era otra red, como se suponía
(la diferencia de ~0,4 s de Android era más probablemente esto, aunque ya no se puede comprobar: hoy los fragmentos los baja
Media3 por la red nativa). Así que el empalme, al ver un host nuevo en una lista, le pide un `HEAD` de un fragmento ya hecho, sin usar la
respuesta y por la misma red que el reproductor: en la extensión, el `fetch` de la página; en Android, `RedNativa`, que usa
`HttpURLConnection`, como Media3 (`red-nativa.ts` le pasa los `HEAD`). Baja ~300 ms el primer fotograma si se ha precalentado
~0,5-0,9 s antes, y sin precalentar no cambia.
- **La TV no gana:** su empalme corre en el proceso principal y hls.js en la página, con redes distintas. Haría falta
  `session.preconnect`, y la TV está retirada, así que se queda como está; el `HEAD` no le hace daño.
- **Descartado, `<link rel="preconnect">`:** va igual de rápido, pero solo existe en una página, y el empalme no siempre está en ella.
- **Descartado, abrir conexiones por adelantado a los hosts de otras veces:** cambian con cada emisión, y sería adivinar.

<a id="d38"></a>**D38. Tras un fallo, Android reconecta sola y con un límite; «no emite» solo si lo dice Twitch (AND-6, 4 nov).** En el
emulador, un corte de red dejaba el canal en error para siempre, también con la pantalla apagada, y un 500 de Twitch o
abrir sin red decían que el canal «no está en directo», sin forma de reintentar. La extensión aguantaba porque hls.js
reintenta solo.
- **Reconectar (`Reproductor.fallo`):** se vuelve a abrir tras 2, 4, 8, 15, 30 y 60 s. Con Twitch fallando, 4:40
  hasta el aviso con «Reintentar», medido. Lo que lleva 30 s seguidos sonando empieza la cuenta de nuevo.
- **Sin red, sin sondear:** ni se intenta ni se cuenta. Android avisa cuando hay red (`AvisoDeRed`), como mucho durante
  30 min, y si cambia la red principal se intenta sin esperar.
- **Con un empalme nuevo:** el de antes tiene el hueco del corte, que con la hora contada daba 30-40 s de latencia de
  mentira (y retrasaría el chat), y sus sesiones, esperas de hasta 30 s. Vuelve en menos de 3 s con ~3 s de latencia.
- **Despierto solo mientras reconecta:** un wake lock parcial con plazo, porque con la pantalla apagada y sin sonar el
  teléfono se dormiría con la espera a medias. Esperando la red, no: despierta el aviso.
- **Al rendirse o si terminó la emisión:** se sueltan el servicio y los mandos, y la esquina se quita. Antes seguían la
  notificación y un tic por segundo a la página.
- **«No emite» (`NotLiveError`, común):** usher lo rechaza con un 4xx salvo 408 y 429, el canal no existe o no hay vídeo.
  La red y los 5xx no dicen nada del canal. Vale también con lo ya publicado, para enterarse del fin de la emisión.
- **Fin de la emisión en la extensión y la TV:** la lista se queda como estaba, sin error, y hls.js no salía de la
  espera. Parado 20 s sin pausa, `useHlsPlayer` pregunta si sigue.
- **Si el sistema mata la app** parada, vuelve a la misma dirección. Tras caerse la página, no: si fue por lo que había
  en ella, se caería sin fin.

Descartado: subir los reintentos de Media3 como hls.js, porque no cubre la lista atascada ni el empalme con hueco, y
reintentar sin fin, que gastaría batería sin nadie mirando.

<a id="d39"></a>**D39. Las conexiones de gql, usher y las listas se abren por adelantado (4 nov).** Abrir un canal encadena tres hosts con TTL 0: gql,
luego usher y luego los `*.playlist`, y cada uno que no tenga la conexión hecha pierde ~310 ms en DNS, uno tras otro. Por eso el
primer canal tardaba ~1,4 s hasta `info` y los siguientes ~0,42. Las conexiones ociosas se cierran entre los 30 y los 60 s, así que
también lo pagaba cambiar de canal tras un rato viendo otro. Ahora `conexiones.ts` pide un `HEAD` sin usar su respuesta, como en D37:
- **Al abrir la página (o la app):** a gql, usher y los hosts de listas de otras veces. Es lo que más gana: el primer clic baja
  de ~1,93 a ~0,98 s hasta el primer fotograma ([verificación](verificacion/0.5.0.md#la-primera-apertura-d39)).
- **Al crear un empalme,** también al precalentar: a usher y a esas listas, en paralelo a gql, si no se han usado en los últimos 30 s.
  Gana ~320 ms tras más de un minuto viendo otro canal.
- **Los hosts de listas sí se recuerdan** (hasta 3, en `localStorage`), a diferencia de los de los fragmentos que descartó D37: son unos
  pocos por región (`eus21` a `eus23` en las 9 aperturas medidas). Si cambian, se pierde un `HEAD`.
- **La TV** no los recuerda (su proceso principal no tiene `localStorage`) ni abre al arrancar, porque está retirada; sí adelanta usher al
  crear el empalme, y como allí la red es una sola, debería ganar igual.
- **Descartado, mantener las conexiones abiertas con un `HEAD` cada 25 s:** quitaría los ~310 ms que le quedan a gql al cambiar de
  canal, a cambio de tráfico constante a Twitch para algo que el precalentado con el ratón ya tapa en parte.

<a id="d40"></a>**D40. Android: una VPN no es red, y una parada no se queda para siempre (4 nov).** En el S25, con Tailscale, salió lo que el emulador no
podía enseñar ([verificación](verificacion.md)): en modo avión la app no decía «sin conexión», reintentaba con el móvil despierto, y un VOD
tardó 60 s en volver con la red ya de vuelta. Y de wifi a datos, con la 0.4.1 y la 0.5.0, ~30 s parado y ~30 s por detrás del directo el resto de la visita, sin botón.
- **Una VPN no cuenta (`AvisoDeRed`):** sin nada debajo sigue siendo la red activa y dice tener internet. Ahora mira las redes que no son VPN.
- **Avisa si aparece una red o si se pierde una y queda otra.** `registerDefaultNetworkCallback` sigue a la VPN, y `registerBestMatchingNetworkCallback` da `onLost` del wifi
  y nada de los datos, que ya estaban conectados (en el emulador, con un registro temporal). De wifi a datos no «llega» ninguna red: solo se pierde una.
- **Si cambia la red con el vídeo parado, o se para en los 30 s siguientes, se vuelve a abrir ya** (`reconectarYa`), con un empalme nuevo, sin esperar a que se agoten los plazos de
  las conexiones de antes. Si no se para, no se toca: de wifi a datos sin corte sigue sin corte, y volver al wifi no corta.
- **Si cambia mientras ya vuelve a abrir, se abre otra vez en la red nueva.** Si no, con una red lenta empezaba ~25 s por detrás y se quedaba así (en el S25, 3 de 6 veces).
- **Si las paradas han añadido más de 12 s de retraso en directo, al volver a avanzar se vuelve a abrir:** Media3 no lo recorta, y es el mismo límite de D36. Corta ~2 s una sola vez, frente a quedarse
  20 s detrás. Hasta 12 s se conserva como margen. Cuenta el retraso y no lo que dura cada parada: mirando la duración, una parada que se partió en dos dejó 20 s de latencia sin reabrir. Se prefirió a un botón porque quien lo sufre suele llevar el móvil en el bolsillo.
- **No aplica** a lo retrocedido o pausado (se perdería dónde iba) ni a `ReproductorActivity`, que mide sin recuperar. **Paridad (D24):** solo Android, porque hls.js ya salta y reintenta en
  la extensión y en la TV. Allí no se ha probado con una VPN.
- **La causa exacta del atasco en el S25 es una suposición:** con la VPN, Android no cerraría los sockets al perder el wifi. En el emulador, sin VPN, sí los cierra, y de wifi a datos no hay corte.
  Se reprodujo el mecanismo con `iptables` (`datos-colgado` y `parada`), no el caso del S25.

<a id="d41"></a>**D41. La interfaz de la extensión y de Android, tras una subida con jueces (4 nov).** Lo pidió el usuario: comparar con Twitch,
Kick y Xtra, puntuar a ciegas con dos modelos, y no copiar a nadie. Sigue valiendo D14 (casi negro, Atkinson Hyperlegible, el
blanco como única marca de selección y el rojo solo para «en directo»): no se añade ningún color. (Cambiada en parte por
[D44](#d44) y [D47](#d47).)
- **La columna de seguidos:** el nombre entero y debajo los espectadores. A 1440 px, el nombre tenía 41 px y hacía falta recortar
  26 textos. La categoría sale por debajo de 1760 px de ventana («Just…» no decía nada) y sigue en el `title`.
- **La tarjeta de un directo:** primero quién emite, como ya hacía Android, luego el título y la categoría. Sin foto (está en la
  columna) y, en la imagen, solo el punto rojo y los espectadores.
- **Tipografía:** cuerpo a 15 y titulares grandes con el espaciado ajustado, sin medios puntos.
- **Sin cuenta, «Populares ahora»** en la extensión y en Android (`catalog.popularSinCuenta`, por el GraphQL público, como la
  búsqueda). Va aparte de `loadHome`, así que no retrasa la bienvenida ni toca la ruta con cuenta. En la extensión, el primero
  va como cartel. La TV no: no pasa `channels`.
- **Controles del reproductor:** con más fondo, botones de 40 px, y las flechas de canal a los lados del vídeo, como en Android
  (fuera de la fila: son hijas de `.stage`, centradas a cualquier proporción, y se ocultan con ella).
  **Cambia lo que decía D17:** «por detrás» se quita por debajo de 860 px de vídeo y «En directo» por debajo de 780. Los saltos de
  10 s, por debajo de 620. La barra de volumen se queda, por lo que explica D17. Antes la fila se salía (41 px con una ventana de
  1100 y chat, cortando pantalla completa), y ahora no se sale a ningún ancho.

Descartado:
- **El cartel en la lista de seguidos:** a los jueces les da unas décimas, pero a 1440×900 deja a la vista 9 canales en vez de 12,
  en la lista que más se usa. Es un solo `poster` en `HomeView.tsx`, si el usuario lo prefiere.
- **Miniaturas grandes en Android:** las piden los jueces, pero es la opción C que el usuario rechazó (D23).
- **Iconos «bold» en Android:** hundieron esa categoría (de 7,2 a 6,0 y 5,9). En la extensión se quedan.
- **Un color de marca:** es lo que más subiría «carácter», según los propios jueces, pero contradice D14. Lo decide el usuario.

<a id="d42"></a>**D42. Varios canales en una cuadrícula, con uno grande (EXT-6, 4 nov).** Hasta 4 canales en una pestaña, con una opción de
Ajustes, sin que cambie nada para quien no la active. El usuario eligió «uno grande» entre las maquetas: el que suena arriba, con
su chat, y los demás debajo. Un clic en una celda la hace la grande, y el vídeo no se corta porque solo cambia dónde la coloca el CSS. (Cambiada en parte por
[D48](#d48).)
- **Sin «todos iguales»:** el prototipo tenía los dos repartos, con la misma CPU (52 y 54 %). Quitarlo elimina un botón, el cálculo de
  columnas y su CSS, y nadie lo iba a usar teniendo «uno grande». Si un día se quiere, está en el historial del repo de trabajo.
- **Un directo por celda** (`directo-huecos.ts`): cada `createDirecto` sigue atendiendo un canal más uno precalentado, sin saber nada
  de esto. Una petición sin `?hueco=` va al principal, así que sin cuadrícula todo va como antes. Las pausas globales se rellenan
  cada una con su VOD, y sus trozos los atiende el directo que los publicó.
- **Entrar y salir sin cortar:** `useHlsPlayer` deja el reproductor esperando al desmontar, y la pantalla que se monta lo recoge en el
  mismo commit de React, en la misma tarea. El navegador solo pausa un `<video>` que sigue fuera del documento al terminar la tarea.
  Va en un efecto de layout, porque el de después de pintar llegaría tarde, y todo lo que el reproductor toca de la pantalla pasa
  por `visit.owner`, que cambia al recogerlo. Lo que nadie recoge se destruye en la tarea siguiente. Solo con la cuadrícula activada:
  sin ella, `grid` no llega al hook y al desmontar se destruye como siempre. Un canal visto solo sigue en su hueco
  (`huecoOf`), porque es el mismo reproductor y al volver no debe pisar el del que se ha quedado con el principal.
- **Cuando termina o falla una celda:** su aviso se queda en ella y los demás siguen. Si era la grande, pasa a serlo otra en marcha,
  con su sonido y su chat, para no quedarse mirando un aviso. Una sin directo se vuelve a mirar cada minuto, sin enseñar el giro, y si
  vuelve, sigue sola; no pasa a ser la grande, porque no hay por qué quitarle el sonido a lo que ya suena. Elegida a mano, se queda.
- **Con varias pestañas (EXT-5),** la cuadrícula es una pestaña más: suena o espera entera, por los mismos escalones, con los empalmes
  calientes como en el canal. Además, oculta más de un minuto, aunque sea la que suena, solo sigue la celda que se oye: seguir descargando
  tres vídeos que nadie ve no compensa, y al volver tardan lo de abrir un canal.
- **Se recuerda:** los canales están en la dirección, así que sobreviven a recargar y a reabrir la pestaña. Por pestaña, en
  `sessionStorage`, la última cuadrícula, para volver de «Ver solo», y el que suena.
- **Las miniaturas van a la misma calidad.** Con menos se ahorraría algo (38 % de un núcleo con tres a 720p60, frente a 47 %, en el banco), pero el
  empalme sirve una sola calidad por lista, así que pasar a grande sería recrear el reproductor: justo el corte que este diseño evita.
- **Sin selector de calidad, retroceder al VOD ni imagen en imagen:** para eso está «Ver solo», que además no corta el vídeo. ← → y
  Fin sí, dentro de la lista del directo.
- **Paridad (D24):** solo la extensión. En un móvil no cabe (la pantalla apenas da para dos, sin chat) y la TV está retirada. Lo que
  va en `packages/` (`useHlsPlayer`, `directo-huecos.ts`) no hace nada sin `grid` ni `?hueco=`.
- **Descartado, un `<video>` único que se mueve con una capa propia por encima de las pantallas:** obligaba a tocar `ChannelView` para
  todo el mundo. También, dejar `ChannelView` montado debajo de la cuadrícula: gastaba lo mismo y no resolvía salir de ella.

<a id="d43"></a>**D43. En Inicio, «En directo» o «Vídeos» (5 nov).** Lo pidió el usuario: para seguir un vídeo hacía falta recorrer toda la lista de canales. Con algún vídeo a medias, el título de Inicio es el selector
(«En directo 12», «Vídeos 3», el elegido en blanco), y los vídeos ya no van debajo de los canales. Sin vídeos a medias queda el título de siempre. Empieza en «En directo», y lo elegido se mantiene al volver
de un vídeo, pero no al recargar. En Android, el orden de los seguidos pasa a ser un icono, como en la columna del escritorio, para que todo quepa en una fila.
- **Descartado:** una fila de dos botones encima del título, que era lo primero que se hizo: el usuario vio que repetía «En directo». Pestañas como las de un canal, que dejaban el orden en otra fila. Y los vídeos en una fila encima de los canales: un toque menos, pero bajaba los canales siempre.
- **Paridad (D24):** extensión y Android, que tenían el mismo problema. La TV, no: está retirada y no tiene esa lista.

<a id="d44"></a>**D44. La TV vuelve a recibir lo nuevo que tenga sentido con un mando (6 nov).** Lo pidió el usuario: quien abrió el
[issue #1](https://github.com/mateozariquiey/GoodTTV/issues/1) usa el AppImage, que seguía solo en español y sin buena parte de
lo que tienen las otras dos. Cambia D24: lo nuevo ya no se queda fuera de la TV por defecto. Va también a ella lo que tenga
sentido con un mando a distancia, adaptado a sus pantallas (D14), y lo que no, se dice con su motivo. Los arreglos y el
rendimiento siguen yendo a las tres, como siempre. (Cambiada en parte por [D50](#d50).)
- **El idioma (D35), en toda la TV:** Inicio, Buscar, Ajustes, el reproductor, el chat, los avisos, los errores de la cuenta y
  de Twitch (`tMensaje`) y el aviso si no arranca. La ventana no tiene menú, y su título es el nombre del canal. El ajuste es una
  fila más de Ajustes, como las demás de la TV: cada OK pasa de «Sistema (English)» a English, Español y otra vez Sistema, sin
  recargar y sin cortar el vídeo. Ajustes pasa a dos columnas para que quepa: la cuenta, el idioma y el mando a la izquierda;
  el chat, la reproducción y «Acerca de», a la derecha. → desde la cuenta sigue llevando a los ajustes de la derecha.
  - **Lo elegido va en `idioma.json`, en la carpeta de datos de la app,** y no en el `localStorage` de la página: su origen cambia
    de puerto en cada arranque (`listen(0)`). Lo lee el proceso principal al abrir, y la página lo pide sin esperar
    (`sendSync`, en el preload) antes de pintar nada, para que la primera imagen ya salga en su idioma. `activarIdioma` admite
    otra fuente (`FuenteIdioma`): la extensión y Android siguen con la de la página.
  - **«Sistema» es el primero de los idiomas preferidos del sistema** (`app.getPreferredSystemLanguages()`: en Linux,
    `LANGUAGE`, `LC_ALL`, `LC_MESSAGES` y `LANG`), y si no hay ninguno, el de Chromium. Comprobado en el AppImage: inglés con
    `LANG` en inglés, en alemán o `C`; español con `es_ES` o con `LANGUAGE=es:en`.
  - **La entrada del AppImage en el menú del escritorio** va en inglés, con su versión en español (`Comment[es]`).
- **Buscar, Populares y abrir un canal por su nombre, sin cuenta,** como en la extensión y Android: lo hace el proceso principal
  como invitado (`guestCatalog`, en `@goodttv/servicios`, con `canales.ts` de `@goodttv/sin-anuncios`), por IPC. Antes, sin
  cuenta, la TV solo abría un canal por su nombre exacto, sin su foto ni su id, y la primera pantalla estaba vacía.
- **Fuera, porque no tienen sentido con un mando o en la TV:** escribir en el chat (D24), las pestañas, la cuadrícula (D42),
  la imagen en imagen, el modo teatro y la pantalla completa (la TV ya ocupa toda la pantalla), solo audio con la pantalla
  apagada (D32) y deslizar para volver (D28).
- **Aparcado, con su motivo:** los VOD y retroceder el directo tendrían sentido en la TV, pero
  piden un reproductor de VOD manejado con el mando, la lista de vídeos de cada canal y guardar por dónde va cada vídeo fuera del
  `localStorage`, por lo mismo que el idioma. Es grande, y no se puede probar en una TV de verdad. Lo pequeño (si sigues el canal,
  SEG-1, y el orden «Recomendado para ti», que también guarda en `localStorage`) queda para cuando se decida si compensa.
- **Descartado:** el idioma en `Preferences`, porque cambiaría el contrato que comparte la extensión, que no lo usa, y pasarlo
  por la línea de órdenes de la página (`additionalArguments`), que obligaría a recargar para cambiarlo.

<a id="d45"></a>**D45. La versión para la televisión se llama «TV», nunca «tele» (10 nov).** Lo pidió el usuario, para que el nombre sea el mismo
en los dos idiomas, empezando por los README que lee quien abrió el issue #1. Se cambió en todo el texto del repo (los README,
la documentación, los comentarios y la entrada del AppImage), y la carpeta pasó de `apps/tele` a `apps/tv`.
- **Sin cambiar:** los identificadores y los archivos del prototipo de `investigacion/android/prueba` (`tele.html`,
  `createTeleApi`), que no se compila desde entonces, y los nombres de las carpetas de `.lab/` que citan las medidas antiguas.
  Tampoco cambian la carpeta de datos de la app (`~/.config/goodttv`, por el `name` del `package.json`) ni el AppImage.

<a id="d47"></a>**D47. La categoría, en la columna de seguidos a cualquier ancho (18 nov).** Lo pidió el usuario: la veía en las tarjetas de
Inicio y no en la columna, que es donde elige canal. Estaba, pero D41 la quitaba por debajo de 1760 px de ventana, y la suya mide
1742 (1916 px con el zoom al 110 %). Pidió que la fila no creciera. Cambia lo que decía D41 de la columna:
- **Dos líneas, como antes:** el nombre entero y, debajo, la categoría a la izquierda con los espectadores a la derecha. La
  categoría se queda con lo que deja la cifra y se recorta ella, nunca el nombre. La fila mide 50,6 px (antes 52).
- **La cifra, abreviada** («262K», en español «262 mil»; `Intl`, como los seguidores del buscador): la exacta ocupaba media línea
  y es lo que dejaba la categoría en «Just…». Sigue exacta en las tarjetas de Inicio y al pasar el ratón por la fila (`title`).
- **Por debajo de 1600 px de ventana** (la columna, a menos de 200 px), la cifra va sin el punto rojo: en esa lista todos emiten,
  y sus 12 px son dos letras más de categoría.
- **Con la cuadrícula (D42),** al salir el + se aparta también la línea de debajo, no solo el nombre, para que no tape la cifra.
- **Medido** con 13 categorías, de «IRL» a «Call of Duty: Black Ops 7»: a 1742 px, la categoría tiene 93 px y se recortan 4; a
  1920, 1; a 1440, 9, con 68 px («Grand Th…», «Just Chatti…»), que ya se reconocen. En español, con «mil», unos 14 px menos.
- **Paridad (D24, D44):** solo la extensión. Android y la TV no tienen esa columna, y sus listas ya llevan la categoría.

Descartado, con capturas de las seis disposiciones a 1440, 1600 y 1920 px:
- **Como Twitch** (la cifra junto al nombre y la categoría debajo, a todo el ancho): es lo que había antes de D41. A 1440 px
  recorta 8 de 14 nombres, y el nombre importa más que la categoría.
- **Tres líneas** (nombre, categoría y cifra exacta): la categoría casi nunca se recorta, pero la fila sube a 60 px, y en una
  ventana de 1050 px de alto se ven 3 canales menos (15 enteros en vez de 18).
- **La cifra exacta con la categoría al lado,** lo que había por encima de 1760 px: a 1440 px le quedan 20 px a la categoría.
- **La cifra delante de la categoría:** cabe lo mismo, pero cada categoría empieza en un sitio distinto.

<a id="d48"></a>**D48. Cada pestaña suena por su cuenta, como en twitch.tv (18 nov).** Lo pidió el usuario: desde EXT-5 (21 oct) sonaba una
sola pestaña, la última que se miraba, y las demás callaban y, ocultas, se paraban por escalones para gastar menos. Con el
uso prefiere lo que hace twitch.tv: que cada pestaña siga con su sonido, aunque se solapen, y que cada uno lo gestione como
quiera (con el silencio, la pausa o cerrando la pestaña). Era la alternativa que EXT-5 dejaba apuntada.
- **Se quita todo lo de «suena una sola»** (`sonido.ts`): el aviso entre pestañas (`BroadcastChannel`), el silencio y la parada
  de las que esperaban, el empalme caliente de las paradas, «Suena en otra ventana · clic para oír esta», el clic que daba el
  sonido sin pausar y «Escuchar aquí» en la cuadrícula. Unas 400 líneas menos, contando sus pruebas.
- **Una pestaña oculta sigue sonando,** el tiempo que sea. Coste aceptado: cada pestaña con un canal descarga y decodifica su
  directo, también sin verse, como en twitch.tv.
- **Lo que se abre sin verse espera a que se mire** (`visibilidad.ts`): con el clic central en varios canales no deben empezar
  a sonar todos a la vez sin haberlos visto. Los navegadores hacen algo parecido con las páginas normales. Es de la pestaña,
  no de cada pantalla: una vez mirada, lo que abra sola sin verse (un VOD que alcanza al directo y vuelve al canal) empieza ya.
  Ya no mantiene el empalme caliente mientras espera: al mirarla tarda lo de abrir un canal.
- **Se queda lo que no se oye:** el chat solo se conecta a la vista, porque EventSub admite tres conexiones por cuenta, y una
  cuadrícula (D42) oculta más de un minuto solo sigue con la celda que suena.
- **Los minutos de «Recomendado para ti»** cuentan en toda pestaña que reproduce, no solo en la que sonaba.
- **Paridad (D24, D44):** solo la extensión. Android y la TV no tienen pestañas.

Descartado:
- **Una opción en Ajustes** para elegir entre los dos comportamientos: dos caminos que mantener y probar, y el usuario prefiere
  uno. El anterior está en el historial (`sonido.ts`, hasta el commit de D47).

<a id="d49"></a>**D49. El directorio de categorías (18 nov).** Lo pidió el usuario: a veces echa de menos ver qué se está viendo en Twitch,
como el día que salió GTA VI, cuando quería saber cuántos espectadores tenía. Cambia D8 y el alcance de D13, que dejaban las
categorías fuera: GoodTTV sigue siendo de tus seguidos, e Inicio no cambia, pero explorar deja de obligar a ir a twitch.tv.
- **«Categorías», arriba,** abre la lista de las 60 con más espectadores ahora, de más a menos: su puesto, la carátula pequeña,
  el nombre, los espectadores y cuántos canales la emiten. Se refresca cada minuto mientras se ve.
- **Una categoría** (`#/categoria/<nombre de twitch.tv>`) enseña sus cifras y sus 60 directos más vistos, de todos los idiomas,
  con las tarjetas de Inicio sin la línea de la categoría. Un directo se abre como cualquier otro, y atrás vuelve.
- **Una lista de cifras, no un escaparate de carátulas:** lo que se viene a mirar es cuánto se ve cada cosa. Cabe más en
  pantalla (40 categorías en una ventana de 1742 × 954) y sigue D14.
- **Como invitado, también con cuenta:** el GraphQL público, como la búsqueda y «Populares ahora» (`topCategories` y
  `categoryStreams`, en `canales.ts` de `@goodttv/sin-anuncios`; `catalog.categories` y `catalog.category`). Helix da las
  categorías más vistas, pero sin sus espectadores, que es justo lo pedido.
- **El nombre, sin traducir** (`name`): Twitch traduce `displayName` («Charlando»), y el resto de GoodTTV enseña el de Helix
  («Just Chatting»).
- **Paridad (D24, D44):** primero la extensión, y con la forma aprobada por el usuario, el mismo día, Android y la TV.
  - **Android:** un botón en la barra de Inicio, entre la búsqueda y la cuenta, y dos pantallas con la misma lista en una
    columna. Siguen montadas debajo de lo que se abre desde ellas, como Inicio: al volver de un canal, la lista de su
    categoría está donde se dejó, y al volver de una categoría, el directorio también. Debajo no se refrescan.
  - **La TV:** una pestaña «Categorías» entre Buscar y Ajustes. A la izquierda la lista y a la derecha la categoría
    enfocada, con la carátula en grande y sus cifras; OK abre sus directos, con las filas y la vista previa de Inicio, y
    Atrás vuelve a la lista, a la categoría de la que se salió. Mientras llega una lista, el foco se queda en la pestaña.
    Es lo último que recibe la TV de momento (D50).

Descartado:
- **Solo hacer pulsable la categoría de cada tarjeta,** que fue la primera propuesta: lleva a los directos de una categoría que
  ya ves, pero no enseña cuáles son las más vistas. Puede añadirse encima; Helix no da el nombre de dirección de la categoría,
  así que haría falta pedirla por su id.
- **Una tercera opción en el título de Inicio** («En directo», «Vídeos», «Categorías»): ese selector solo sale con vídeos a
  medias, y desde un canal habría que pasar por Inicio.

<a id="d50"></a>**D50. La TV deja de recibir funciones nuevas, de momento (18 nov).** Lo decidió el usuario: no la usa, y desde octubre no hay
una TV de verdad donde probarla. El directorio de categorías (D49) es su última función. Cambia D44, que le llevaba todo lo que
tuviera sentido con un mando: lo nuevo va a la extensión y a Android, como decía D24. El código común sigue llegándole solo,
porque lo comparte, y se sigue compilando y pasando sus e2e mientras el usuario no diga otra cosa.

<a id="d51"></a>**D51. La TV, sin reproductor de respaldo y con el servidor local en HTTP (19 nov).** Lo decidió el usuario en la
auditoría de noviembre, con la TV ya en pausa (D50). Se van el reproductor oficial de Twitch incrustado, que
entraba si el propio fallaba, su modo «Controles de Twitch» con el depurador que le mandaba las teclas (D4), el SDK remoto
de `player.twitch.tv` y el permiso de pantalla completa de su marco: unas 1.800 líneas, 760 de ellas de pruebas.
- **Si el reproductor propio falla,** sale el mismo error que en la extensión, con «Reintentar» enfocado. Es lo que ya
  pasaba en la extensión y en Android, que nunca tuvieron respaldo: si Twitch rompe la API privada, no hay vídeo hasta
  publicar un arreglo.
- **El servidor local sigue,** porque sirve en un mismo origen la interfaz y `/stream/`, pero en HTTP. El TLS con su
  certificado por instalación solo existía por el `parent` que exigía el reproductor oficial. Sigue escuchando solo en
  `127.0.0.1`, con el `Host` exacto y las comprobaciones de origen del IPC y de la navegación. En las instalaciones
  antiguas queda un `localhost-certificate.json` sin uso.
- **El origen es `http://127.0.0.1:<puerto>`, no `localhost`.** Lo encontraron los dos revisores del cambio (Codex
  `gpt-6.2-sol` y Claude Opus 5.5): Chromium resuelve `localhost` primero a `::1`, donde la app no escucha, así que otro
  proceso de la máquina que abriera ese puerto en `::1` habría recibido la página y, con ella, el IPC de la cuenta. Con
  HTTPS lo impedía la huella del certificado. Chromium trata `127.0.0.1` como contexto seguro.
- **El servidor rechaza lo que pide otro sitio** (`Sec-Fetch-Site` distinto de `same-origin` o `none`, con un 403): una
  página de otro origen no podía leer la respuesta, pero sí pedir `/stream/` de otro canal y cortar el directo.
- **Cambia** D4, que queda sin efecto, y lo que D11 decía del respaldo.

<a id="d52"></a>**D52. Lo ya visto del directo se suelta a los 30 s, y dos ahorros pequeños (19 nov).** De la fase de rendimiento de la
auditoría de noviembre.
- **El búfer de atrás, a 30 s** (`backBufferLength` en `useHlsPlayer.ts`, como ya tenían los VOD). hls.js lo trae sin
  límite, y el navegador guardaba hasta que su propio tope lo paraba, unos 200 s por reproductor. Medido con
  `memoria.mjs`, las dos compilaciones a la vez y con los mismos canales a 1080p60, a los 10 min: la página pasa de
  1.066 a 437 MB con cuatro canales en la cuadrícula, y el navegador entero de unos 620 a 460 MB con uno. Vale para la
  extensión y para la TV, que comparten el reproductor. Android no cambia: Media3 ya guardaba solo 30 s por detrás (D25).
- **Lo que cuesta:** nada que se note. Los saltos de 10 s tardan lo mismo (10 ms hasta saltar y 90 hasta moverse, con
  `saltos.mjs`), y retroceder 50 s, fuera ya del búfer, una décima más (de 0,12 a 0,22 s tras la última tecla), porque los
  fragmentos siguen en la caché de red. La prueba de rendimiento, alternando las versiones en la sesión de escritorio
  (3 canales, 2 pasadas, 90 s por visita): ninguna parada, 22,9 y 22,6 % de CPU, 2,1 % del hilo de la página en las
  dos, y 0,47 y 0,42 % de fotogramas perdidos.
- **El chat de Android se desconecta con la página oculta** (la pantalla apagada o la app al fondo), como el de una
  pestaña oculta de la extensión, y vuelve al encenderla. El directo sigue sonando. En el emulador, oculta, el chat recibía
  y pintaba 150 mensajes en 10 s para nadie. `usePageVisible` pasa a `packages/interfaz`.
- **Las fotos de perfil se piden al tamaño al que se pintan** (`avatarAt`: la menor de las que da Twitch que cubre los
  píxeles de pantalla). La de la columna de la extensión, 50 px y 5,7 KB en vez de 300 px.
- **Corrige la medida de la cuadrícula del 4 de noviembre:** de sus 1,9 GB, unos 800 MB eran la caché de red de Chrome,
  que guarda todos los fragmentos en disco y los tiene mapeados cuando se llena. Cuentan como memoria del navegador, pero
  son archivos que el sistema suelta si hace falta. Con el búfer a 30 s y sin contar esa caché, cuatro canales ocupan
  unos 750 MB.

<a id="d53"></a>**D53. Los fragmentos del directo no se guardan en la caché de red (19 nov).** Solo en la extensión, que es donde hls.js
pide con `fetch` (`fetchSetup` con `cache: "no-store"`, en `goodttv.tsx`). El navegador guardaba en disco cada fragmento,
aunque cada uno se pide una sola vez: unos 3 GB por hora a 1080p60, hasta llenar su caché (unos 800 MB en el laboratorio,
1,3 GB en el Helium del usuario) y echar de ella lo de otras webs.
- **twitch.tv hace lo mismo que hacíamos:** su reproductor también los guarda (medido en un perfil limpio: 7 MB cada 15 s a
  720p). No era un fallo nuestro, pero no guardarlos no cuesta nada.
- **Medido:** en 80 s de directo, la caché pasa de 76 a 2 MB. Retroceder 50 s, que ya no cabe en el búfer de 30 s (D52),
  tarda lo mismo con la caché que pidiéndolo otra vez a Twitch (1,37 s en las dos, con las cinco teclas). La prueba de
  rendimiento alternando las versiones (3 canales, 2 pasadas, 60 s): ninguna parada, 24,9 y 24,4 % de CPU, 2,6 % del hilo
  de la página en las dos, y el primer fotograma en 1.034 y 943 ms.
- **Lo que puede costar:** con una conexión lenta, retroceder más de 30 s dentro del directo tardará lo que tarde en
  bajar un fragmento de 2 s. Más atrás ya se pasaba al VOD de la emisión.
- **La TV y los VOD no cambian:** la TV pide con XHR, que no deja elegirlo, y en un VOD sí se vuelve sobre lo ya visto.
- **De la misma tanda, medido y sin cambios:** una pestaña oculta que sigue sonando (D48) baja sola del 24 al 6 % de un
  núcleo, porque Chrome deja de decodificar y pintar el vídeo, aunque sigue bajando la calidad entera. Rehacer el mapa de
  emotes cuesta 53 µs por mensaje con los 1.058 emotes de un canal grande. La página pinta Inicio a los 88 ms de mediana,
  y ejecutar todo su código son unos 30: cargar hls.js solo al abrir un canal ahorraría como mucho 15.

<a id="d54"></a>**D54. Un directo que se queda parado ofrece «Reintentar» (19 nov).** En el reproductor de la extensión y de la TV
(`useHlsPlayer.ts`, con la decisión en `stuck.ts`). Antes, una vez reproduciendo, un vídeo parado sin estar en pausa solo
preguntaba si la emisión había terminado, y si seguía, la imagen quedaba congelada sin aviso: había que salir del canal y
volver a entrar. Lo vio un revisor al quitar el respaldo de la TV (D51).
- **Los errores fatales de medios** se recuperan hasta tres veces seguidas, y el cuarto enseña el error con «Reintentar».
  Con 30 s de vídeo reproducidos, la cuenta se olvida.
- **Parado con datos por delante,** el aviso «Twitch no responde» sale a los 30 s seguidos así. Ahí lo que para es el
  propio reproductor, y hls.js ya lo ha empujado.
- **Parado sin datos,** a los 4 min. La espera normal más larga es una tanda de anuncios entera sin relleno (el modo
  *Directo*, o un canal sin VOD público), de hasta 3 min. No se espera a que hls.js se rinda con las listas, porque
  las sirve la propia página y nunca llegan a fallar: con la red cortada, el vídeo seguía congelado y sin decir nada a
  los 5 min y medio, cuando se dejó de mirar.
- **El aviso es un dato aparte** (`state.stuck`), y la fase del reproductor sigue en «listo». No se para nada: la barra del
  directo, el chat y la cuadrícula siguen como estaban (la cuadrícula no cambia sola de canal grande), y si el directo
  vuelve, el aviso se va cuando ha reproducido 10 s, no al primer movimiento.
- **Se cuenta lo reproducido de verdad, no si el reloj del vídeo se mueve** (`playedMeter`): los saltos del propio
  reproductor al directo mueven el reloj aunque la imagen siga parada, y volver a ver un tramo ya visto sí es reproducir.
- **El tiempo parado se suma vuelta a vuelta** del vigilante y no por el reloj, para que suspender el equipo o una pestaña
  oculta con los temporizadores frenados no cuenten.
- **Un error o el fin de la emisión ya no vuelven a «listo»** si el vídeo sigue un momento con lo que le queda en el
  búfer: hace falta «Reintentar».
- **No cuenta como parado:** la pausa de la persona, el relleno con el VOD (reproduce) ni una pestaña oculta que sigue
  sonando (D48). Android no cambia: Media3 tiene su propia recuperación (D40).
- **Revisado** por Codex `gpt-6.2-sol` en cinco rondas, hasta aprobarlo. De ahí salieron que el aviso no cambie la fase,
  el medidor de lo reproducido y que un error no se borre solo.
- **Comprobado** con `herramientas/laboratorio/atasco.mjs`, que provoca cada caso en la extensión, y sin avisos falsos en la
  prueba de humo con sus variantes, el recorrido de la cuadrícula y la prueba de rendimiento. Esta, alternando con la
  versión anterior en los dos órdenes (3 canales, 60 s, 12 visitas por versión): 24,6 y 24,6 % de CPU, 2,5 % del hilo
  de la página en las dos y 0,5 % de fotogramas perdidos en las dos. Una parada de 3 s en una visita de la nueva, como
  la de 2 s que tuvo la anterior en otra tanda. La que corre segunda sale siempre con algo más de búfer y de latencia
  (unas 3 décimas), sea la que sea: al comparar hay que alternar también el orden.

<a id="d55"></a>**D55. «Populares» por un solo camino, y Esc con un menú abierto (20 nov).** Dos decisiones del usuario al cerrar la
auditoría de noviembre.
- **«Populares» de Inicio sale siempre del GraphQL público,** también con cuenta (antes, con cuenta, de Helix). Se van
  `catalog.live` y la consulta de Helix, y `popularSinCuenta` pasa a llamarse `popular`. Lo que cambia a la vista: si
  nadie emite en tu idioma, la lista enseña los de todos en vez de quedarse vacía, y la categoría sale sin traducir
  («Just Chatting», no «Charlando»), también sin cuenta y en los directos de una categoría, como en el resto de la app.
- **Con un menú del reproductor abierto, Esc solo lo cierra,** también en un VOD (`ControlsMenu`). En un VOD, ese Esc
  salía además del modo teatro o volvía a Inicio.

## 4. Revisión temprana

> Del 8 de octubre de 2026, sobre la primera versión de este documento. Es historia.

Codex (`gpt-6.1-sol`, razonamiento alto) revisó este documento, el prototipo y los registros el
8 de octubre. Se aceptaron sus 12 observaciones, ya incorporadas arriba: foco de ventana,
validación del marco antes de cada envío CDP, semántica de repetición, recorridos de texto y
cuenta, redacción sobre audio y flag, señales del reproductor, alcance del botón «Reproducir»,
aviso de almacenamiento sin cifrar, ciclo de vida del chat, tamaño mínimo en transiciones,
diagnóstico separado y vistas ocultas inertes. Además, su lectura de `e8-restart` reveló la pausa
por página oculta sin reanudación.

## 5. Revisión final

> Del 8 de octubre de 2026, sobre la primera versión de la app. Es historia.

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

## 6. Hardware real

Comprobado en el mini PC, la TV y el mando el 16 de octubre:
[verificacion.md](verificacion/0.2.1-0.2.3.md#en-el-mini-pc-la-tv-y-el-mando). Hacia el 19 de octubre se retiró esa configuración
(la TV usa ahora otro aparato), así que desde la 0.3.0 la app de la TV solo se comprueba con las pruebas
automáticas.
