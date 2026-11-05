# Auditoría de VacuumStream y decisiones de la variante

> Estado: decisiones aplicadas hasta GoodTTV 0.2.3. Lo comprobado y lo pendiente están en
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
- **Sin tiendas:** ni Chrome Web Store ni AMO. Se instala desde las releases, como en D15. Lo cambia D30.
- **Versiones:** la 0.2.0, con la tele y la extensión, sale como pre-release porque la tele no se ha probado en el
  mini PC. Android se publicará cuando esté terminada.

Descartado:
- **Hacer público este repo:** expondría todo lo anterior, y quitar el correo de los commits obligaría a reescribir
  su historial.
- **Publicar sin el reproductor sin anuncios:** el público se quedaría en la tele con el reproductor oficial, sin
  extensión.

**D19-D29. Las decisiones de Android, en resumen.** El detalle completo no se publica, porque está lleno de datos de los
equipos con los que se desarrolla:
- **D19. Una WebView con la interfaz y Media3 para el vídeo.** El objetivo es que siga sonando con la pantalla apagada o
  en segundo plano. La interfaz web va en una WebView, el empalme en JavaScript (`sin-anuncios`) en otra oculta, el
  «motor», y el vídeo con Media3, con un servicio en primer plano. Así hay una sola implementación del empalme (D12).
  Descartadas: todo en la WebView, porque Chromium pausa el vídeo en segundo plano y Android corta la red de la app a los
  ~2 s; una app nativa con Compose, que obliga a reescribir las pantallas y a portar los servicios; y portar el empalme a
  Kotlin, que serían dos implementaciones. No hay versión para Android TV.
- **D20. El proyecto.** Gradle en Kotlin en `apps/android`, con `minSdk` 33. No es un espacio de trabajo de bun: Gradle
  compila la página con el `tsc` y el Vite de la raíz, y `bun run verify` no necesita el SDK de Android. Las versiones
  publicadas se firman con una clave propia que vive fuera del repo.
- **D21. Media3 confirmado midiendo en el teléfono.** Frente a reproducir en la WebView, gastó un 16 % menos de energía en
  12 parejas de visitas (121 frente a 155 % de un núcleo de CPU), sin paradas detectadas, y es la única opción que suena
  con la pantalla apagada. En fotogramas perdidos no ganó: 18 de ~40 000, frente a 0.
- **D22. La cuenta.** Corre en la página, con el mismo `window.api` que la extensión (`createPageApi`). La sesión la guarda
  la app, cifrada con una clave del Keystore que no sale del teléfono, y lo demás va en el `localStorage` de la WebView.
  Nada va a copias de seguridad. Hay una sola `MainActivity`, porque el token de renovación solo vale una vez.
- **D23. La interfaz.** Pantallas propias para el dedo, sin barra de pestañas, con Media3 debajo de una WebView transparente
  en el sitio del vídeo, de modo que hay una sola página y girar el teléfono no recarga nada. Como en la app de Twitch, el
  canal que se deja sigue en una esquina, y al salir de la app, en imagen en imagen.
- **D24. Funciones nuevas sin paridad obligatoria.** Los arreglos y las mejoras de reproducción, del empalme y del
  rendimiento siguen yendo a las tres versiones, con el código común en `packages/`. Lo nuevo va a la extensión y a Android,
  y a la tele solo si se decide. Seguir y dejar de seguir canales queda descartado: la API oficial lo quitó en 2021, y la
  única vía conocida pide una sesión con mucho más poder sobre la cuenta.
- **D25. Los VOD, retroceder el directo y los emotes en el teléfono.** Lo mismo que la extensión, adaptado al dedo. Un VOD
  va con Media3 y sin el motor. Se retrocede dentro de la lista del empalme y, más atrás, en el VOD de la emisión. Los saltos
  van al fotograma clave (0,05-0,2 s frente a 0,4-1,5 s), a cambio de hasta 1 s de precisión en un VOD y 2 s en directo.
- **D26. Inicio al abrir, sin esperas en cadena (en las tres versiones).** La cuenta se guarda con el token, así que lo que
  se pide a Twitch ya no espera a validar la sesión: lo de ahora llega en ~0,2 s en vez de ~0,7 s. Lo guardado solo se
  enseña tal cual si es de hace menos de 5 min; si no, se pinta la forma de las listas, vacía, que no enseña nada falso.
- **D27. Los mandos del sistema.** Lo que suena se ve en la notificación y en la pantalla de bloqueo, y se pausa desde ahí y
  con los auriculares. Va con una sesión de medios sobre el reproductor de la app, sin `MediaSessionService`, porque este sale
  del primer plano como mucho a los 10 min de pausa, y sin primer plano Android corta la red a la app.
- **D28. Deslizar hacia abajo sobre el vídeo para volver,** como en la app de Twitch, solo con el dedo.
- **D29. Android se publica desde la 0.3.0, como experimental,** y la tele se sigue publicando sin comprobarla en una tele de
  verdad, solo con las pruebas automáticas.

**D30. La extensión, en las tiendas (24 oct).** Para que la instale y la actualice cualquiera sin el modo de
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

**D31. El chat, barato de pintar en la extensión y en Android (24 oct).** Medido en Chrome con la GPU, el chat real de
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
[verificacion.md](verificacion.md#el-chat-barato-de-pintar-d31).

Descartado:
- **`content-visibility: auto` en los mensajes,** para no pintar los que no se ven: sale peor (el hilo de la página,
  del 6,9 al 9 %), porque el navegador decide en cada fotograma cuáles entran y salen de la vista.
- **`will-change: scroll-position`** en vez del fondo opaco: ahorra lo mismo, pero el texto del chat pierde los
  subpíxeles.

**D32. Solo audio con la pantalla apagada, la calidad recordada e imagen en imagen (24 oct).** El usuario eligió cuatro
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

**D33. Sin corte al pasar a solo audio, y el chat a pantalla completa, aparte (24 oct).** Probando D32 en el S25, el
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

**D34. Saltar en vez de acelerar, y lo que salió del audio desincronizado (29 oct).** El usuario notó el audio
desincronizado en el canal de `jaimemellado_` con la 0.4.0, y pidió ← → para retroceder y avanzar 10 s, como en YouTube.
- **El reproductor propio ya no acelera para recuperar el margen.** Con margen de más (una parada, o en *Adaptativo*
  antes del primer relleno) aceleraba a 1,05× hasta recuperarlo. En Zen, como en Firefox, cada cambio de velocidad deja
  el sonido algo más atrás de la imagen, y ahí se queda: con un directo sintético de pitidos y destellos, 2,9 s tras
  5 min alternando 1,05× y 1×, y a velocidad fija nada que se acumule. En Chrome, nada. Es un fallo abierto de Firefox
  ([1762617](https://bugzilla.mozilla.org/show_bug.cgi?id=1762617)). Los VOD de `jaimemellado_` son solo para
  suscriptores, así que su canal nunca tiene relleno y *Adaptativo* no dejaba de acelerar, y tras una pausa de 40 s
  aceleraba unos 13 min. Ahora lo que sobra se salta de una vez, como ya se hacía al arrancar, y lo pausado (más de 1 s)
  se conserva como lo retrocedido, con «Ir al directo» (en *Directo* y en la tele, que no tiene ese botón, se salta). La velocidad
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

**D35. El idioma a mano, en la extensión y en Android (3 nov).** Lo pidió el
[issue #1](https://github.com/mateozariquiey/GoodTTV/issues/1) del repo público, de alguien que no lee español. Todo el
texto estaba escrito en español en el código, así que hacía falta traducir (al inglés) además del selector:
- **Sistema, Español o English, en los ajustes.** «Sistema» es español si el del navegador o el teléfono lo es, y si no,
  inglés. Es lo que trae por defecto, así que quien tenga el sistema en inglés pasa a verla en inglés sin tocar nada.
- **El español sigue en el código, y es la clave de su traducción:** `t("Ajustes")` da «Settings» (`idioma.ts`,
  `idioma-en.ts`). Las pantallas se siguen leyendo igual, y los tipos no dejan usar una frase sin traducir. Una prueba
  avisa si queda texto en una pantalla sin pasar por `t()`, porque eso los tipos no lo ven.
- **Se guarda en el `localStorage` de la página, y no en las preferencias:** se lee sin esperar, para no pintar Inicio primero
  en el otro idioma, el evento `storage` avisa a las demás pestañas, y no cambia nada en el contrato que comparte la tele.
- **Se aplica sin recargar:** la raíz vuelve a pintar todo, y el vídeo sigue sonando. Los componentes con `memo` piden
  `useIdioma()`. Lo que no pasa por la página se lo dice ella: el menú contextual del fondo, por `chrome.storage`, y lo poco que
  pinta la app de Android (la esquina, la imagen en imagen, el nombre del canal de notificaciones), por el puente.
- **«Populares» va en el idioma elegido;** con «Sistema», en el del sistema, aunque la interfaz no esté traducida a él.
- **La tele sigue en español:** no llama a `activarIdioma`, y hasta entonces `t()` devuelve la frase tal cual (D24).

- **Los mensajes de `@goodttv/servicios` (4 nov) también van en español en el código,** y la pantalla los traduce al pintarlos
  con `tMensaje`, porque servicios no conoce el idioma: en la tele corre en el proceso principal. Llegan como texto, así que los
  tipos no los ven, y una prueba los busca en el código de servicios. Lo que no es nuestro (el motivo que da Twitch para no enviar
  un mensaje, los errores de red) se queda como viene. Antes llegaban en inglés con la interfaz en español (AND-2).
- **La descripción del manifest (4 nov) va en `_locales`,** con `en` por defecto: un navegador en alemán la ve en inglés, como
  «Sistema» en la interfaz.

Sin traducir: los nombres de categoría, que los da Twitch.

Descartado:
- **i18next o similares:** una dependencia para `t()`, que aquí son pocas líneas.
- **Claves abstractas** (`t("ajustes.titulo")`): obligan a ir al diccionario para saber qué dice una pantalla.
- **Recargar al cambiar:** cortaría el vídeo en las demás pestañas.

**D36. Adaptativo conserva lo que añade una parada de unos segundos (REN-2, 4 nov).** Algunos canales entregan a trompicones: su
lista se queda quieta 4-7 s de vez en cuando, y con 1-2 s de búfer eso es una parada. Subir el margen a todos cuesta 3 s en los
canales regulares, que son casi todos, para nada ([verificación](verificacion.md#las-paradas-el-margen-y-el-dns-de-los-fragmentos-rep-2-rep-5-ren-2-ren-3)).
Así que, en Adaptativo, tras una parada de 1 a 12 s en pleno directo, el retraso que ha añadido se conserva durante esa visita,
en vez de saltárselo: es justo el margen que le faltaba al canal, sin elegir ninguna cifra, igual que tras el primer relleno con el
VOD (`keepMargin`). Por debajo de 1 s es un tropiezo. Por encima de 12 s es una pausa global sin VOD, o que la emisión se ha caído,
y dejaría un retraso enorme para siempre. No cuentan la espera del arranque, las de un salto ni las de una pausa. En *Directo* y
*Sin paradas*, nada cambia. La visita siguiente vuelve a empezar con el margen corto; recordarlo por canal se deja hasta ver si hace falta.
Android no lo necesita: Media3 va a velocidad fija y no salta tras una parada, así que ya conserva ese retraso (`sinAcelerar` en
`Reproductor.kt`, leído en el código). Por encima de 12 s, sí: D40.

**D37. La conexión de los fragmentos se abre al ver la lista (REN-3, 4 nov).** Lo que tarda el primer fragmento de un host nuevo es
casi todo DNS: ~310 ms, con cualquier resolvedor, porque Twitch da TTL 0. La vía no era otra red, como se suponía
(la diferencia de ~0,4 s de Android era más probablemente esto, aunque ya no se puede comprobar: hoy los fragmentos los baja
Media3 por la red nativa). Así que el empalme, al ver un host nuevo en una lista, le pide un `HEAD` de un fragmento ya hecho, sin usar la
respuesta y por la misma red que el reproductor: en la extensión, el `fetch` de la página; en Android, `RedNativa`, que usa
`HttpURLConnection`, como Media3 (`red-nativa.ts` le pasa los `HEAD`). Baja ~300 ms el primer fotograma si se ha precalentado
~0,5-0,9 s antes, y sin precalentar no cambia.
- **La tele no gana:** su empalme corre en el proceso principal y hls.js en la página, con redes distintas. Haría falta
  `session.preconnect`, y la tele está retirada, así que se queda como está; el `HEAD` no le hace daño.
- **Descartado, `<link rel="preconnect">`:** va igual de rápido, pero solo existe en una página, y el empalme no siempre está en ella.
- **Descartado, abrir conexiones por adelantado a los hosts de otras veces:** cambian con cada emisión, y sería adivinar.

**D38. Tras un fallo, Android reconecta sola y con un límite; «no emite» solo si lo dice Twitch (AND-6, 4 nov).** En el
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
- **Fin de la emisión en la extensión y la tele:** la lista se queda como estaba, sin error, y hls.js no salía de la
  espera. Parado 20 s sin pausa, `useHlsPlayer` pregunta si sigue.
- **Si el sistema mata la app** parada, vuelve a la misma dirección. Tras caerse la página, no: si fue por lo que había
  en ella, se caería sin fin.

Descartado: subir los reintentos de Media3 como hls.js, porque no cubre la lista atascada ni el empalme con hueco, y
reintentar sin fin, que gastaría batería sin nadie mirando.

**D39. Las conexiones de gql, usher y las listas se abren por adelantado (4 nov).** Abrir un canal encadena tres hosts con TTL 0: gql,
luego usher y luego los `*.playlist`, y cada uno que no tenga la conexión hecha pierde ~310 ms en DNS, uno tras otro. Por eso el
primer canal tardaba ~1,4 s hasta `info` y los siguientes ~0,42. Las conexiones ociosas se cierran entre los 30 y los 60 s, así que
también lo pagaba cambiar de canal tras un rato viendo otro. Ahora `conexiones.ts` pide un `HEAD` sin usar su respuesta, como en D37:
- **Al abrir la página (o la app):** a gql, usher y los hosts de listas de otras veces. Es lo que más gana: el primer clic baja
  de ~1,93 a ~0,98 s hasta el primer fotograma ([verificación](verificacion.md#la-primera-apertura-d39)).
- **Al crear un empalme,** también al precalentar: a usher y a esas listas, en paralelo a gql, si no se han usado en los últimos 30 s.
  Gana ~320 ms tras más de un minuto viendo otro canal.
- **Los hosts de listas sí se recuerdan** (hasta 3, en `localStorage`), a diferencia de los de los fragmentos que descartó D37: son unos
  pocos por región (`eus21` a `eus23` en las 9 aperturas medidas). Si cambian, se pierde un `HEAD`.
- **La tele** no los recuerda (su proceso principal no tiene `localStorage`) ni abre al arrancar, porque está retirada; sí adelanta usher al
  crear el empalme, y como allí la red es una sola, debería ganar igual.
- **Descartado, mantener las conexiones abiertas con un `HEAD` cada 25 s:** quitaría los ~310 ms que le quedan a gql al cambiar de
  canal, a cambio de tráfico constante a Twitch para algo que el precalentado con el ratón ya tapa en parte.

**D40. Android: una VPN no es red, y una parada no se queda para siempre (4 nov).** En el S25, con Tailscale, salió lo que el emulador no
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
  la extensión y en la tele. Allí no se ha probado con una VPN.
- **La causa exacta del atasco en el S25 es una suposición:** con la VPN, Android no cerraría los sockets al perder el wifi. En el emulador, sin VPN, sí los cierra, y de wifi a datos no hay corte.
  Se reprodujo el mecanismo con `iptables` (`datos-colgado` y `parada`), no el caso del S25.

**D41. La interfaz de la extensión y de Android, tras una subida con jueces (4 nov).** Lo pidió el usuario: comparar con Twitch,
Kick y Xtra, puntuar a ciegas con dos modelos, y no copiar a nadie. Sigue valiendo D14 (casi negro, Atkinson Hyperlegible, el
blanco como única marca de selección y el rojo solo para «en directo»): no se añade ningún color.
- **La columna de seguidos:** el nombre entero y debajo los espectadores. A 1440 px, el nombre tenía 41 px y hacía falta recortar
  26 textos. La categoría sale por debajo de 1760 px de ventana («Just…» no decía nada) y sigue en el `title`.
- **La tarjeta de un directo:** primero quién emite, como ya hacía Android, luego el título y la categoría. Sin foto (está en la
  columna) y, en la imagen, solo el punto rojo y los espectadores.
- **Tipografía:** cuerpo a 15 y titulares grandes con el espaciado ajustado, sin medios puntos.
- **Sin cuenta, «Populares ahora»** en la extensión y en Android (`catalog.popularSinCuenta`, por el GraphQL público, como la
  búsqueda). Va aparte de `loadHome`, así que no retrasa la bienvenida ni toca la ruta con cuenta. En la extensión, el primero
  va como cartel. La tele no: no pasa `channels`.
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

**D42. Varios canales en una cuadrícula, con uno grande (EXT-6, 4 nov).** Hasta 4 canales en una pestaña, con una opción de
Ajustes, sin que cambie nada para quien no la active. El usuario eligió «uno grande» entre las maquetas: el que suena arriba, con
su chat, y los demás debajo. Un clic en una celda la hace la grande, y el vídeo no se corta porque solo cambia dónde la coloca el CSS.
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
- **Paridad (D24):** solo la extensión. En un móvil no cabe (la pantalla apenas da para dos, sin chat) y la tele está retirada. Lo que
  va en `packages/` (`useHlsPlayer`, `directo-huecos.ts`) no hace nada sin `grid` ni `?hueco=`.
- **Descartado, un `<video>` único que se mueve con una capa propia por encima de las pantallas:** obligaba a tocar `ChannelView` para
  todo el mundo. También, dejar `ChannelView` montado debajo de la cuadrícula: gastaba lo mismo y no resolvía salir de ella.

**D43. En Inicio, «En directo» o «Vídeos» (5 nov).** Lo pidió el usuario: para seguir un vídeo hacía falta recorrer toda la lista de canales. Con algún vídeo a medias, el título de Inicio es el selector
(«En directo 12», «Vídeos 3», el elegido en blanco), y los vídeos ya no van debajo de los canales. Sin vídeos a medias queda el título de siempre. Empieza en «En directo», y lo elegido se mantiene al volver
de un vídeo, pero no al recargar. En Android, el orden de los seguidos pasa a ser un icono, como en la columna del escritorio, para que todo quepa en una fila.
- **Descartado:** una fila de dos botones encima del título, que era lo primero que se hizo: el usuario vio que repetía «En directo». Pestañas como las de un canal, que dejaban el orden en otra fila. Y los vídeos en una fila encima de los canales: un toque menos, pero bajaba los canales siempre.
- **Paridad (D24):** extensión y Android, que tenían el mismo problema. La tele, no: está retirada y no tiene esa lista.

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

## 6. Hardware real

Comprobado en el mini PC, la TV y el mando el 16 de octubre:
[verificacion.md](verificacion.md#en-el-mini-pc-la-tv-y-el-mando). Hacia el 19 de octubre se retiró esa configuración
(la tele usa ahora otro aparato), así que desde la 0.3.0 la app de la tele solo se comprueba con las pruebas
automáticas.
