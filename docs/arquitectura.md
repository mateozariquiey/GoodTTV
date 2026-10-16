# Arquitectura

Esta guía está pensada para mantener la app. Las decisiones y sus alternativas están en
[decisiones.md](decisiones.md).

## La familia y el monorepo

GoodTTV es una familia de versiones que comparten código (D12). Un solo repo con espacios de
trabajo de bun y un único `node_modules` en la raíz:

```text
apps/                     una carpeta por versión
  tele/                   la app de Electron para la tele (casi todo lo que sigue en esta guía)
  navegador/              la extensión de Chrome y Firefox (D13), con su interfaz de escritorio (D14)
packages/                 código común, sin depender de una versión concreta
  contratos/              esquemas y tipos de window.api, del chat y de las teclas (Zod); sin Node
  interfaz/               la interfaz de React: pantallas, navegación por teclas, reproductor y chat
  servicios/              cuenta de Twitch, Helix, chat por EventSub y almacén local; sin Node
  sin-anuncios/           empalme, relleno con el VOD y recortes (D11); sin Node
docs/                     esta documentación
```

- **Cuándo algo pasa a `packages/`:** cuando lo necesita una segunda versión, no antes. Para la
  versión de navegador (D13) salieron de `apps/tele` los contratos, los servicios y la interfaz.
  Cada versión aporta lo suyo:
  - **la interfaz:** `window.api` (`AppApi`), montar `App` e importar las fuentes y los estilos;
  - **los servicios:** dónde guardar la sesión (`TokenStore`), los recientes y las preferencias
    (`TextStorage`) y de dónde sale el Client ID (`SettingsSource`).
- **`@goodttv/sin-anuncios`** no carga tipos de Node: solo usa `fetch`, `Response`,
  `crypto.getRandomValues` y `Uint8Array`, que existen en Electron, en una extensión y en Android.
  Sus rutas `/stream/` (`directo.ts`: lista con recarga bloqueante, `info`, `precalentar` y trozos
  del VOD) responden con `Response` estándar, sin depender del transporte. En la tele las sirve el servidor
  local (`apps/tele/src/main/stream/stream-service.ts`, un adaptador HTTP); en la extensión, la
  propia página atiende sus `fetch` a `/stream/` (`apps/navegador/src/directo-fetch.ts`). `apps/tele`
  lo declara como `devDependency` para que electron-vite lo meta en el bundle y electron-builder no
  lo empaquete aparte.
- **Lo sin anuncios que sigue fuera de `@goodttv/sin-anuncios`.** Es lo que habría que separar
  para una versión con solo el embed oficial (la pública lleva el reproductor sin anuncios desde D18):
  - en `apps/tele`: el gancho `dynamic` y la CSP de `https-server.ts`, la CSP de
    `renderer/index.html` (`connect-src https://*.ttvnw.net`, `media-src`, `worker-src blob:`), y
    el servicio y el registro `GOODTTV_REGISTRO_EMPALME` en `main/index.ts`;
  - en `packages/interfaz/src`: `useHlsPlayer.ts` y, en `PlayerScreen.tsx`, la elección de
    reproductor, el retraso del chat y el modo cine; `ChatDelayQueue` y `delay` en `useChat.ts`, y
    el texto de sincronización de `ChatPanel.tsx`; los modos de retraso de `AccountScreen.tsx`;
  - `LatencyMode` en `packages/contratos/src/contracts.ts` y la mezcla de preferencias por
    defecto en `packages/servicios/src/local-store.ts`.

### La extensión (`apps/navegador`)

Pantallas propias para ratón y teclado (D14), con la misma esencia que la tele: fondo casi negro,
Atkinson Hyperlegible, el blanco como única marca de selección y el rojo solo para «en directo». De
`@goodttv/interfaz` reutiliza la lógica (reproductor `useHlsPlayer`, chat `useChat` con su retraso,
datos, cuenta y los mensajes con emotes), no las pantallas. El botón de la extensión abre
`src/goodttv.html`.

```text
src/goodttv.tsx        monta las pantallas de escritorio; una sola pestaña a la vez
├── escritorio/        las pantallas
│   ├── Desktop.tsx    barra, columna de seguidos y la vista de la dirección; atajos generales
│   ├── routes.ts      la vista en la dirección: #/, #/canal/<login>, #/ajustes (atrás y enlaces)
│   ├── Search.tsx     búsqueda siempre arriba (/); Enter abre el canal con ese nombre exacto
│   ├── Sidebar.tsx    tus seguidos en directo; plegable
│   ├── HomeView.tsx   miniaturas de tus seguidos y populares, y «Seguir viendo»
│   ├── ChannelView.tsx  el vídeo con controles encima, ficha del canal y chat; modo teatro
│   ├── SettingsView.tsx cuenta, retraso, chat y la lista de atajos
│   ├── shortcuts.ts   atajos de teclado (Espacio, M, T, F, C, ↑ ↓, /, Esc)
│   └── desktop.css    los estilos
├── api.ts             window.api: lo que en la tele hacen el proceso principal y el IPC, aquí en la página
│   ├── @goodttv/servicios   cuenta, Helix, chat por EventSub y almacén local
│   ├── storage.ts           la sesión y los datos en chrome.storage.local, sin cifrar
│   ├── wake-lock.ts         que la pantalla no se apague mientras se ve un directo
│   └── home-cache.ts        Inicio de la última vez (window.api.home), en localStorage
├── directo-fetch.ts   el directo sin anuncios, atendido en la página
└── lab.ts             laboratorio por la dirección: ?pausa= (pausas simuladas), ?registro, ?chatsintetico=, ?chatreal y ?sinred
src/fondo.ts           abre o trae al frente la página; menú «Abrir en GoodTTV» en twitch.tv
```

- **Un solo manifest para los dos navegadores** (`public/manifest.json`, MV3):
  - el fondo, declarado como `service_worker` (Chrome) y como `scripts` (Firefox);
  - el icono, en PNG (Chrome no admite SVG en el manifest); la página lleva el mismo en SVG
    (`public/icono.svg`) como favicon, en negativo si el navegador va en claro;
  - `gecko.id`;
  - permisos de host para Twitch y sus CDN.

  Con esos permisos, las páginas de la extensión no están sujetas a CORS. Vite compila `dist/` sin
  minificar, y `empaquetar.mjs` lo mete en `out/goodttv-<versión>.xpi` (un ZIP con `manifest.json`
  en la raíz) para instalarlo en Zen o firmarlo en AMO (D15).
- **El fondo apenas hace nada** (`src/fondo.ts`): abre la página o la trae al frente, y pone
  «Abrir en GoodTTV» en el menú contextual de los enlaces y las páginas de twitch.tv. El canal lo
  saca de la dirección (`twitch-links.ts`) y lo abre con `#/canal/<login>`; si la página ya está
  abierta, solo cambia su dirección. Todo lo demás vive en la página, porque en Chrome el fondo es
  un service worker que el navegador puede detener.
- **Sin embed oficial de respaldo:** Manifest V3 no admite código remoto, y el SDK de Twitch lo es.
  Si falla el reproductor propio, «Reintentar» o «Abrir en twitch.tv».
- **La plataforma** (`packages/interfaz/src/platform.tsx`) solo lleva la configuración extra de
  hls.js: la extensión le pone el `FetchLoader`.
- **Los tokens, en la página.** La regla de la tele (el renderer no ve un token) protege de lo que
  carga la ventana. Aquí la página es la propia extensión: Manifest V3 no deja cargar código ajeno,
  y los tokens se quedan en los servicios; la interfaz solo recibe datos. Se guardan sin cifrar en
  `chrome.storage.local`, y Ajustes lo avisa.
- **Inicio sale ya al abrir** (`useHome`, en `packages/interfaz/src/data.ts`, común con la tele). Comprobar la cuenta
  y pedir los directos a Twitch tarda alrededor de un segundo. Mientras tanto se enseña lo que se vio la última vez con
  esa cuenta (`window.api.home`, sin tokens), y se sustituye en cuanto llega lo de ahora. Se olvida al cerrar sesión, y
  no se usa si la cuenta resulta ser otra. Sin nada guardado, Inicio dice «Cargando…» hasta saber si hay cuenta: antes
  enseñaba la bienvenida sin cuenta y luego a todos los seguidos como desconectados. `useResource` vuelve a «cargando»
  al cambiar de función de carga, para que lo cargado sin cuenta no se enseñe como si fuera con ella. La extensión lo
  guarda en `localStorage` (`home-cache.ts`), que la plataforma lee sin esperar: sale en la primera imagen.
- **Sin poder comprobar la cuenta** (sin red, Twitch caído), lo guardado sigue con un aviso y «Reintentar», nunca la
  bienvenida (EXT-4). `useAuth` distingue los dos fallos:
  - si `auth.snapshot()` lanza, no ha contestado: `unreachable`, y la sesión sigue guardada. No se pide nada a Twitch,
    y se vuelve a comprobar sola con el evento `online` y cada 30 s. Ajustes ofrece también «Cerrar sesión»;
  - si devuelve `error`, sí ha contestado: la sesión ha caducado y `TwitchAuth` ya la ha cerrado. Lo guardado se
    olvida, como sin cuenta.
- **Una sola GoodTTV a la vez** (`goodttv.tsx`). La pestaña abierta tiene un bloqueo del navegador
  (`navigator.locks`). Otra pestaña avisa y puede pedirlo:
  1. se pone a la cola y lo anuncia por un `BroadcastChannel`;
  2. la primera se recarga en espera y suelta el bloqueo al descargarse;
  3. la nueva solo arranca cuando la anterior ha parado.

  Dos pestañas renovarían a la vez la misma sesión de Twitch, y el token de renovación solo vale una
  vez.
- **El directo, en la página.** `src/directo-fetch.ts` sustituye el `fetch` de la página: lo que
  pide a sus propias rutas `/stream/` lo responde `@goodttv/sin-anuncios` en memoria, como el
  servidor local de la tele. hls.js usa su `FetchLoader`, porque el `XhrLoader` por defecto no
  pasaría por ahí. Así el reproductor pide lo mismo en las dos versiones.
- **Sin worker de hls.js, como en la tele:** la versión ESM de hls.js no lo trae, así que
  demultiplexa en el hilo de la página. Por eso no afecta que Firefox no admita workers `blob:` en
  las páginas de extensión. No hace falta: con un directo a 1080p60 el hilo de la página está
  ocupado un 1-1,5 % del tiempo (D16).
- **Precalentar al pasar el ratón** (`escritorio/prewarm.ts`): con el ratón parado 150 ms sobre un
  enlace a un canal (salvo los recientes desconectados), o al empezar a pulsarlo, se pide
  `/stream/<canal>/precalentar`, con la calidad elegida a mano si la hay. El directo abre ese
  empalme aparte, sin parar el que suena, y al abrir el canal el arranque lleva ese adelanto: con
  medio segundo, el primer fotograma llega en ~0,5 s en vez de ~1,1 s (D16).
- **Con la pestaña oculta sigue igual.** Chrome y Firefox frenan los temporizadores de las
  pestañas ocultas, y el empalme sondea cada 2 s. Con 6 min oculta, sonando o silenciada, el
  vídeo avanzó al ritmo real, sin esperas ni más retraso. En pausa, hls.js salta al directo cuando
  la posición sale de la lista, y al volver reanuda ([verificacion.md](verificacion.md#extensión-de-navegador)).
- **La página de prueba del reproductor** (`src/reproductor.html#canal`) admite `?modo=` y
  `?pausa=` (como `GOODTTV_PAUSA_SIMULADA`). Expone `window.estadoPrueba` para la prueba de humo
  ([desarrollo.md](desarrollo.md#prueba-de-humo)).

El resto de esta guía describe la tele. Las rutas de `src/main`, `src/preload` y
`src/renderer` son relativas a `apps/tele`; las de la interfaz (pantallas, navegación, reproductor y
chat), a `packages/interfaz/src`.

## Las tres piezas de Electron

```text
Proceso principal (src/main) ── tiene todos los permisos
├── index.ts               ventana, servidor HTTPS local, permisos, arranque
├── input-router.ts        TODAS las teclas del mando → acciones («up», «ok», «back»…; @goodttv/contratos)
├── player-interaction.ts  modo «Controles de Twitch»: flechas → Tab/Mayús+Tab, OK → Enter
├── @goodttv/servicios     cuenta (código + tokens) y Helix; chat por EventSub, emotes y tokenizador;
│                          recientes y preferencias. La tele aporta dónde se guardan:
├── token-vault.ts         la sesión, cifrada con el llavero del sistema (o archivo 0600 sin él)
├── local-store.ts         recientes y preferencias (archivo JSON local)
├── saved-home.ts          Inicio de la última vez (window.api.home; archivo JSON local)
├── settings-store.ts      el Client ID (variables de entorno y de compilación)
└── ipc.ts                 la única puerta de entrada desde la interfaz
        │  IPC validado con Zod (@goodttv/contratos)
Preload (src/preload) ── expone window.api, valida lo que entra y lo que sale
        │
Renderer (src/renderer: main.tsx monta @goodttv/interfaz) ── React, sin acceso a Node
├── navigation.tsx         capas, memoria de foco, recuperación del foco perdido
├── App.tsx                pestañas Siguiendo / Buscar / Ajustes y pila Inicio → Reproducción
├── screens/               HomeScreen, SearchScreen, AccountScreen
└── player/                PlayerScreen, useTwitchPlayer (SDK oficial), useChat, ChatPanel
        │
iframe de player.twitch.tv (otro origen; la app no lo toca por dentro)
```

**Regla de oro:** el renderer nunca ve un token. Las llamadas a Twitch con credenciales salen
del proceso principal, y la interfaz recibe datos ya validados.

**Inicio al abrir** (`useHome`, como en la extensión): mientras se comprueba la cuenta y llegan los directos, lo que
se vio la última vez con esa cuenta. La tele no lo guarda en `localStorage`: el servidor local cambia de puerto en cada
arranque, y con él el origen de la página, así que no duraría. Lo guarda el proceso principal en `saved-home.json`
(archivo 0600), y la interfaz lo pide por IPC al abrir: tarda unos milisegundos, durante los que Inicio no enseña nada.

## Cómo viaja una pulsación del mando

1. El mando envía una tecla estándar (por ejemplo, `ArrowDown`).
2. `input-router.ts` la recibe en `before-input-event`, *antes* de que llegue a la página o al
   iframe de Twitch. La traduce a una acción (`down`) y anula la tecla original.
3. La acción llega por IPC a `navigation.tsx`, que se la entrega a la **capa superior**: la
   pantalla visible o el submenú abierto.
4. La capa puede consumirla. Por ejemplo, el reproductor usa ↑/↓ para cambiar de canal. Si no la
   consume, `navigation` mueve el foco en esa dirección: primero a los controles alineados con el
   actual (su «haz») y, entre ellos, al más cercano (`navigation-geometry.ts`).

Por eso da igual dónde esté el foco DOM. Aunque un clic accidental lo meta en el iframe de
Twitch, la siguiente tecla vuelve a la interfaz. Las excepciones son dos:
- Con un campo de texto activo, las letras, Espacio y Retroceso pasan al campo.
- En el modo «Controles de Twitch», las flechas y OK se envían como Tab y Enter al iframe del
  reproductor, con comprobaciones del marco y del foco antes de cada envío.

## Foco y «volver a donde estaba»

- Cada control enfocable es un `<button data-nav data-nav-id="…">` con un id estable, por
  ejemplo `home-following-ibai`.
- Cada capa recuerda el último id enfocado; si hay capas anidadas, solo la más interna. Al volver
  del reproductor, Inicio enfoca ese id aunque la lista se haya refrescado y reordenado. Al cerrar
  el selector de calidad, el foco vuelve a «Calidad».
- Un control puede fijar su vecino con `data-nav-up/down/left/right`: un id, varios separados por
  espacios (gana el primero que exista) o `none`.
- Sin memoria, el foco empieza en el control marcado con `data-nav-entry`. Las pestañas
  (`data-nav-transient`) no se recuerdan, y al subir a ellas se entra por la pestaña actual.
- Al abrir, el foco entra cuando Inicio ya tiene algo: la lista (guardada o de ahora), un error, sin cuenta la
  bienvenida o, si no se pudo comprobar la cuenta, el aviso (`App.tsx`). Antes caería en las pestañas, y ahí se
  quedaría al llegar la lista. Con el aviso, el foco va a la lista guardada, con «Reintentar» justo encima; sin lista,
  a «Reintentar».
- Si el foco se pierde (el elemento desaparece o estaba en el iframe), la primera tecla solo lo
  recupera y no mueve nada.

## Reproducción

**Variante privada (D11):** por defecto reproduce `useHlsPlayer`, un `<video>` con hls.js sobre el
directo sin anuncios que sirve el proceso principal en `/stream/<canal>/` (`src/main/stream`, sobre
`@goodttv/sin-anuncios`: empalme de sesiones, relleno con el VOD, recarga bloqueante). El modo de retraso (`latencyMode`
en las preferencias) llega al proceso principal en `?modo=` y elige margen y relleno. `useChat`
retiene los mensajes en una cola (`ChatDelayQueue`) hasta que la imagen los alcanza; los avisos de
estado no esperan. Con el reproductor propio la pantalla va en modo cine: el vídeo ocupa todo el
alto y la franja de título y controles flota encima y se oculta a los 4 s sin tocar el mando
mientras se reproduce; con ella oculta, una tecla solo la muestra (↑ ↓ siguen cambiando de canal y
Play/Pausa sigue funcionando). Si el reproductor propio falla, se ofrece el embed oficial, que
funciona como se describe a continuación.

**Arranque, latencia y fluidez del reproductor propio (D16):**
- **Las sesiones, a la vez** (`Empalme.start`): `site`, `embed`, `popout` y `mobile_feed@android`
  (`tipo@plataforma`, `sessionKind`) se abren en paralelo y cada una consulta su
  lista en cuanto abre; publica la primera que da directo. `info` contesta en cuanto hay algo
  publicado (`Empalme.changed`), sin sondear.
- **Precalentar** (`prewarmStream`, `usePrewarm`): con el foco 400 ms en un canal en directo de
  Inicio, en la tele, o con el ratón parado 150 ms encima en la extensión, el directo abre ya ese
  empalme en un hueco aparte (`/stream/<canal>/precalentar`) que no para el que suena. Al abrir el
  canal pasa a activo; si nadie lo abre, se para a los 30 s como cualquier otro.
- **Empezar en el objetivo:** hls.js no empieza más cerca del final que `TARGETDURATION`, y con
  relleno la lista declara 13 s (los trozos del VOD). `useHlsPlayer` empieza a cargar él mismo en
  «final − objetivo» (`autoStartLoad: false` y `startLoad` al llegar la lista). Por lo mismo, tras
  un error fatal de medios vuelve a cargar él mismo (`startLoad` después de `recoverMediaError`):
  hls.js ya ha parado la carga y, sin `autoStartLoad`, no la reanuda.
- **Saltar en vez de acelerar al empezar:** la primera lista puede llegar hasta un fragmento
  atrasada respecto a Twitch, y no se nota hasta la siguiente. Durante los 10 primeros segundos, lo
  que sobre de margen se salta (un salto de ~1-2 s hacia el segundo 3); acelerar a 1,05× durante
  ~30 s descartaba fotogramas (60 fps a 1,05× piden 63 por segundo). No se salta tras una pausa de
  la persona ni con la lista parada (una pausa global): ese retraso no es margen que sobre.
- **La lista abarca 100 s** (`WINDOW_SECONDS` en el empalme), más de lo que hls.js deja quedarse atrás antes de
  saltar (`liveMaxLatencyDuration`: el objetivo más 60 s, 84 s en *Sin paradas*). *Sin paradas* y *Adaptativo* (tras
  el primer relleno) conservan el retraso que se añade, como una pausa de la persona, hasta 10 s por debajo de ese
  tope. Con 20 fragmentos (40 s) y el objetivo de 24 s, bastaban 16 s de más para que la posición se saliera de la
  lista, y hls.js la recolocaba a saltos (15 oct, [verificacion.md](verificacion.md#sin-paradas-saltos-al-crecer-el-retraso)).
  Los fragmentos de Twitch se pueden descargar unos 4,5 min.
- **Recarga bloqueante larga:** el directo retiene la petición de la lista hasta 20 s, y también la
  que llega sin `_HLS_msn` si ese reproductor (`visita`) ya tiene lo último. Tras una respuesta sin
  novedades, hls.js pregunta sin `_HLS_msn` y, si vuelve igual, no pregunta otra vez hasta pasados
  `TARGETDURATION`/2 (6,5 s con relleno): un trozo del VOD podía tardar hasta 6,5 s de más en
  llegar al reproductor. `playlistLoadPolicy` espera esas respuestas hasta 25 s.
- **Carga progresiva** (`progressive: true`, con el `FetchLoader`): cada fragmento se añade al vídeo
  a medida que llega. El último de Twitch (PREFETCH) se descarga mientras se codifica, durante unos
  2 s; antes el búfer solo crecía al completarse cada fragmento y bajaba a ~1 s justo antes. El
  primer fragmento se pide sin esperar al MediaSource (`startFragPrefetch`).
  - **Solo con MPEG-TS.** Los canales con fMP4 (`EXT-X-MAP`; p. ej. con *Enhanced Broadcasting*, como `illojuan`) se
    cargan fragmento a fragmento: hls.js 1.7 sitúa cada trozo que llega respecto al principio del fragmento y, a partir
    de 1 s, lo da por desfasado (`isInvalidInitPts`) y lo pone encima de lo anterior. Se decide con la primera lista,
    antes de cargar nada (`useHlsPlayer`, `LEVEL_LOADED`); el VOD va en el mismo formato que el directo
    ([verificacion.md](verificacion.md#fmp4-saltos-con-la-carga-progresiva)).
- **El chat, barato de pintar:** cada lote solo pinta los mensajes nuevos (`Message` memoizado) y la
  lista lleva `contain: strict`, así que los mensajes que entran no recolocan el resto de la pantalla.

`useTwitchPlayer` crea un `Twitch.Player` oficial por visita y usa `setChannel` para cambiar de
canal. Separa tres hechos que los eventos de Twitch mezclan:
- **Disponibilidad:** READY, ONLINE y OFFLINE.
- **Reproducción:** PLAY, PLAYING, PAUSE y PLAYBACK_BLOCKED.
- **Intención de la persona:** una pausa voluntaria se respeta; una pausa porque la página quedó
  oculta se recupera al volver.

**Nada puede tapar el iframe:** Twitch desactiva el autoplay si algo lo cubre. El CSS de
`.player__video` garantiza 16:9 y un mínimo de 400×300, y la prueba e2e lo comprueba en cada
ejecución.

## Chat

`chat/eventsub-chat.ts` (en `packages/servicios/src`) mantiene **una** conexión WebSocket con EventSub mientras el chat está
visible. Al cambiar de canal sustituye las suscripciones (mensaje, borrado y limpieza), y nunca
deja un juego a medias. Además:
- Sigue los avisos de reconexión de Twitch.
- Detecta conexiones muertas por silencio.
- Reintenta con espera creciente si falla la red.
- Agrupa los mensajes cada 100 ms y limita la cola: si se acumulan, descarta líneas antiguas,
  nunca avisos de moderación.

Cada socket pertenece a una «generación»: al cerrar el chat, nada de un socket anterior puede
volver a activarlo. Cada mensaje
se convierte en *tokens* (texto, mención o emote con capas de anchura cero) con
`chat/tokenize.ts` y el catálogo de `chat/emote-catalog.ts`. Prioridad de emotes: los del canal
antes que los globales, y dentro de cada grupo 7TV > BTTV > FFZ. El renderer solo los pinta, y
guarda los últimos 150.

## Dónde tocar para…

| Quiero… | Archivo |
| --- | --- |
| Añadir una tecla del mando | `packages/contratos/src/keys.ts` (`actionForKey`) y su prueba |
| Cambiar colores, tamaños o espaciado | `packages/interfaz/src/styles.css` (variables en `:root`) |
| Añadir una sección a Inicio | `packages/interfaz/src/data.ts` (`loadHome`, y `toSavedHome` con `SavedHomeSchema` en `@goodttv/contratos` para que se guarde) y `screens/HomeScreen.tsx` |
| Otro proveedor de emotes | `packages/servicios/src/chat/emote-catalog.ts` y el host en `packages/contratos/src/chat.ts` y en la CSP de `src/renderer/index.html` |
| Una llamada nueva a Twitch | `packages/servicios/src/twitch-service.ts` → `ipc.ts` → `preload/index.ts` → `packages/contratos/src/contracts.ts` |
