# Auditoría de VacuumStream y decisiones de la variante

> Estado: decisiones aplicadas hasta GoodTTV 0.2.2. Lo comprobado y lo pendiente están en
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

**D11. Reproductor propio sin anuncios (de uso personal; se publica desde D18).** En lugar del embed
oficial, un `<video>` con hls.js lee un directo que prepara el proceso principal
(`packages/sin-anuncios`, servido por `apps/tele/src/main/stream`): varias sesiones de invitado del mismo canal (`site`, `embed`, `popout` y, desde D16, `mobile_feed` con `platform: android`), que
reciben los anuncios por separado, se empalman por la numeración común de Twitch
(`LIVE-SEQUENCE`), y las pausas en todas a la vez se rellenan con el VOD que Twitch graba del
directo. Usa la API privada del reproductor web y bloquear anuncios incumple las condiciones de
Twitch: es solo para uso personal. Sustituye a D1, D2 (nada tapa un `<video>` propio, pero ya no
es requisito) y D4 cuando se usa; el embed oficial queda como alternativa si el propio falla.
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

**D12. Familia GoodTTV en un monorepo privado (11 oct).** GoodTTV pasa a ser una familia de
versiones: la tele, el navegador y, más adelante, Android. Todas viven en un solo repo privado,
`goodttv-privado`, con espacios de trabajo de bun: `apps/` (una carpeta por versión) y `packages/`
(código común). Así, cuando Twitch cambie algo, se arregla una vez para todas. El código común se
extrae cuando lo necesita una segunda versión, no antes; de momento solo `packages/sin-anuncios`.
Es privado porque incluye lo sin anuncios (D11). El repo público `GoodTTV` (0.1.0, embed oficial;
etiqueta `v0.1.0` aquí) no cambia, hasta D18. Descartado: un repo por versión, porque cada arreglo
habría que repetirlo en todos.

**D13. Versión de navegador: GoodTTV como extensión de Chrome y Firefox (11 oct).** Una página
propia de la extensión con la interfaz de GoodTTV, adaptada a sobremesa (ratón y ventana), y el
reproductor propio sin anuncios. Las páginas de extensión con `host_permissions` no están sujetas a
CORS, así que piden usher, las listas y los trozos del VOD como hoy el proceso principal. Comprobado
en Chrome y Firefox: directo a 1080p con hls.js y trozo del VOD leído. Se descartó el enfoque A
(enganchar el worker del reproductor de twitch.tv) porque no aprovecha el relleno con el VOD ni el
reproductor de GoodTTV, y depende del reproductor interno de twitch.tv, cuyos cambios de 2026 ya han roto
varias veces a los bloqueadores que lo usan.
Alcance: el de GoodTTV (directos, seguidos, búsqueda y chat de lectura); para lo demás, twitch.tv.
Investigación: `investigacion/navegador/informe.md`.

**D14. La extensión tiene su propia interfaz de escritorio (11 oct).** La de la tele está hecha para
un mando a 3 m: botones grandes, foco que se mueve con flechas, teclado en pantalla. Con ratón y
teclado se maneja de otra forma, así que la extensión tiene pantallas propias
(`apps/navegador/src/escritorio`):
- columna de seguidos y miniaturas;
- búsqueda siempre arriba;
- controles sobre el vídeo y modo teatro;
- ajustes con interruptores y selectores;
- atajos de teclado.

Conserva la esencia: fondo casi negro, Atkinson Hyperlegible, el blanco como única marca de
selección y el rojo solo para «en directo». Comparte con la tele toda la lógica (reproductor sin
anuncios, chat con su retraso, cuenta, datos), no las pantallas. Descartado: adaptar con CSS la
interfaz de la tele (a escala de escritorio), que el usuario vio en prototipos y prefirió no seguir.
Se eligió sobre una maqueta interactiva con datos reales.

**D15. La extensión se instala sin firmar (11 oct).** Es de uso personal y no se publica:
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

**D16. Rendimiento del reproductor propio (12 oct).** Medido con una prueba nueva
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
- **Precalentar:** con el ratón parado sobre un canal (extensión) o el foco quieto en él (tele), el
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
en vez de 4,0 s. En la tele, el primer fotograma pasa de 1,64 a 1,08 s. La primera
pausa global simulada en Adaptativo para 10-12 s, como antes (12 s). Detalle y límites en
[verificacion.md](verificacion.md#rendimiento-del-reproductor-propio).

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

**D17. La interfaz de escritorio escala con el zoom sin saltos (12 oct).** El usuario no entendía cómo
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
  «En directo»: solo informan. La barra de volumen y los botones se quedan.
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

Medidas en [verificacion.md](verificacion.md#barra-de-volumen-y-zoom).

**D18. Lo terminado se publica en el repo público GoodTTV (12 oct).** GoodTTV se enseña como proyecto
personal. Este repo sigue siendo el de trabajo, con la investigación, el laboratorio y lo que está a medias. Lo
terminado se copia al repo público `mateozariquiey/GoodTTV` con un commit por versión, como ya se hizo con la 0.1.0.
- **Qué se publica:** las apps, los paquetes, la documentación y la configuración, con el reproductor sin anuncios.
  La extensión no funciona sin él, porque Manifest V3 no deja cargar el reproductor oficial (D13), así que publicar
  las tres versiones obliga a publicarlo. El README avisa de que incumple las condiciones de Twitch.
- **Qué no:** la investigación, los scripts del laboratorio y sus datos, las notas de trabajo, las ramas sin terminar
  y el historial de este repo.
- **Cómo:** un script del repo de trabajo copia solo una lista de rutas y quita de los documentos las partes que solo
  tienen sentido aquí. Después comprueba que no se cuelan secretos, correos personales ni rutas de un equipo. Nada se
  sube sin revisar el resultado.
- **Sin tiendas:** ni Chrome Web Store ni AMO. Se instala desde las releases, como en D15.
- **Versiones:** la 0.2.0, con la tele y la extensión, sale como pre-release porque la tele no se ha probado en el
  mini PC. Android se publicará cuando esté terminada.

Descartado:
- **Hacer público este repo:** expondría todo lo anterior, y quitar el correo de los commits obligaría a reescribir
  su historial.
- **Publicar sin el reproductor sin anuncios:** el público se quedaría en la tele con el reproductor oficial, sin
  extensión.

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
