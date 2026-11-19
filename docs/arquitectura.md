# Arquitectura

Esta guía está pensada para mantener la app. Las decisiones y sus alternativas están en
[decisiones.md](decisiones.md).

## La familia y el monorepo

GoodTTV es una familia de versiones que comparten código (D12). Un solo repo con espacios de
trabajo de bun y un único `node_modules` en la raíz:

```text
apps/                     una carpeta por versión
  tv/                     la app de Electron para la TV, con sus pantallas para el mando (casi todo lo que sigue)
  navegador/              la extensión de Chrome y Firefox (D13), con su interfaz de escritorio (D14)
packages/                 código común, sin depender de una versión concreta
  contratos/              esquemas y tipos de window.api, del chat y de las teclas (Zod); sin Node
  interfaz/               lo común de la interfaz de React: datos, reproductor hls.js, chat, idioma y direcciones
  servicios/              cuenta de Twitch, Helix, chat por EventSub y almacén local; sin Node
  sin-anuncios/           empalme, relleno con el VOD y recortes (D11); sin Node
docs/                     esta documentación
```

- **Cuándo algo pasa a `packages/`:** cuando lo necesita una segunda versión, no antes. Para la
  versión de navegador (D13) salieron de `apps/tv` los contratos, los servicios y la interfaz.
  Las pantallas de la TV y su navegación por mando volvieron a `apps/tv` cuando dejó de recibir funciones (D50): solo
  las usa ella. Cada versión aporta lo suyo:
  - **la interfaz:** `window.api` (`AppApi`), sus pantallas, las fuentes y los estilos;
  - **los servicios:** dónde guardar la sesión (`TokenStore`), los recientes y las preferencias
    (`TextStorage`) y de dónde sale el Client ID (`SettingsSource`).
- **`@goodttv/sin-anuncios`** no carga tipos de Node: solo usa `fetch`, `Response`,
  `crypto.getRandomValues` y `Uint8Array`, que existen en Electron, en una extensión y en Android. Pide a Twitch por
  el `fetch` que se le da (`createDirecto({ fetch })`); si no, por el global. De `@goodttv/contratos` solo toma tipos
  (los de los VOD, que da ya con la forma de `window.api.vods`), y `@goodttv/servicios` toma de él los de lo que pide
  como invitado (`guestChannels` y `guestVods`, en `invitado.ts`).
  Sus rutas `/stream/` (`directo.ts`: lista con recarga bloqueante, `info`, `precalentar` y trozos
  del VOD) responden con `Response` estándar, sin depender del transporte. En la TV las sirve el servidor
  local (`apps/tv/src/main/stream/stream-service.ts`, un adaptador HTTP); en la extensión, la
  propia página atiende sus `fetch` a `/stream/` (`directo-fetch.ts`, en el paquete). `apps/tv`
  lo declara como `devDependency` para que electron-vite lo meta en el bundle y electron-builder no
  lo empaquete aparte.

### La extensión (`apps/navegador`)

Pantallas propias para ratón y teclado (D14), con la misma esencia que la TV: fondo casi negro,
Atkinson Hyperlegible, el blanco como única marca de selección y el rojo solo para «en directo». De
`@goodttv/interfaz` reutiliza la lógica (reproductor `useHlsPlayer`, chat `useChat` con su retraso,
datos, cuenta y los mensajes con emotes), no las pantallas. El botón de la extensión abre
`src/goodttv.html`.

```text
src/goodttv.tsx        monta las pantallas de escritorio; avisa de lo que cambian otras pestañas
├── escritorio/        las pantallas (el texto, con t() de @goodttv/interfaz: D35)
│   ├── Desktop.tsx    barra, columna de seguidos y la vista de la dirección; atajos generales
│   ├── routes.ts      la vista en la dirección: #/, #/canal/<login>, #/categorias, #/ajustes (atrás y enlaces)
│   │                  (Inicio, el canal, el VOD y las categorías, comunes con Android: routes.ts de la interfaz)
│   ├── Search.tsx     búsqueda siempre arriba (/): la lista por relevancia de twitch.tv, y Enter abre el elegido
│   ├── Sidebar.tsx    tus seguidos en directo, con su categoría y sus espectadores (D47); plegable (solo avatares)
│   ├── HomeView.tsx   miniaturas de tus seguidos y populares (también sin cuenta, D41), y «Seguir viendo»
│   ├── CategoriesView.tsx  el directorio (D49): las categorías más vistas con sus cifras, y los directos de una
│   ├── ChannelView.tsx  el vídeo con controles encima, ficha del canal (con «Siguiendo») y chat; modo teatro
│   ├── PlayerControls.tsx  lo común a los controles del canal, del VOD y de la cuadrícula: a la vista al mover el
│   │                    ratón, un clic pausa y dos van a pantalla completa, el volumen, los menús y sus botones
│   ├── fullscreen.ts  la pantalla completa del canal y del VOD, con su propio chat al lado (D33)
│   ├── ChatPanel.tsx  el chat; un emote dice su nombre al pasar el ratón, y un clic lo pone en la caja
│   ├── ChatCompose.tsx  la caja para escribir (CHAT-1): Tab y «:» completan emotes, y la lista de emotes
│   ├── visibilidad.ts si la pestaña está a la vista y si se ha mirado ya (D48): el chat y lo abierto sin verse
│   ├── GridView.tsx   varios canales en una pestaña (EXT-6, D42, con su opción en Ajustes; cuadricula.ts)
│   ├── VodView.tsx    un VOD (VOD-1): barra con miniaturas, velocidad, calidad y chat del vídeo; reanuda
│   ├── SkipButton.tsx retroceder y avanzar 10 s (← →), en el directo y en un VOD
│   ├── useVodPlayer.ts  hls.js para el VOD: arranque en buena calidad, carga progresiva y por dónde va
│   ├── Videos.tsx     los vídeos de un canal (debajo de la ficha, COL-2, y de un VOD) y sus tarjetas
│   ├── SettingsView.tsx cuenta, retraso, chat y la lista de atajos
│   ├── shortcuts.ts   atajos de teclado (Espacio, ← →, Fin, M, T, F, C, ↑ ↓, /, Esc)
│   └── desktop.css    los estilos
├── api.ts             window.api: lo que en la TV hacen el proceso principal y el IPC, aquí en la página
│   ├── @goodttv/servicios   createPageApi (page-api.ts): cuenta, Helix, chat por EventSub, almacén local e
│   │                        Inicio de la última vez (page-home.ts, en localStorage)
│   ├── storage.ts           la sesión y los datos en chrome.storage.local, sin cifrar
│   └── wake-lock.ts         que la pantalla no se apague mientras se ve un directo
└── lab.ts             laboratorio por la dirección: ?pausa= (pausas simuladas), ?registro, ?chatsintetico=, ?chatreal
                       (con &escribir, una cuenta ficticia que escribe), ?sinred y ?twitchfalso (una cuenta y un Helix
                       falsos, con una espera por petición, para medir el arranque de Inicio: twitch-falso.ts)
src/fondo.ts           abre GoodTTV o trae al frente la pestaña con esa vista; menú «Abrir en GoodTTV» en twitch.tv
```

- **Un solo manifest para los dos navegadores** (`public/manifest.json`, MV3):
  - el fondo, declarado como `service_worker` (Chrome) y como `scripts` (Firefox);
  - el icono, en PNG (Chrome no admite SVG en el manifest); la página lleva el mismo en SVG
    (`public/icono.svg`) como favicon, en negativo si el navegador va en claro;
  - `gecko.id`;
  - permisos de host para Twitch y sus CDN.

  Con esos permisos, las páginas de la extensión no están sujetas a CORS. Vite compila `dist/` sin
  minificar, y `empaquetar.mjs` lo mete en `out/goodttv-<versión>.xpi` (un ZIP con `manifest.json`
  en la raíz) para instalarlo en Zen o firmarlo en AMO (D15, D30), y en `out/goodttv-<versión>-chrome.zip`, el mismo
  sin lo que solo usa Firefox en el manifiesto, para Chrome. El mismo código da los mismos archivos, también en arm64.
  Firefox busca versiones nuevas en `updates.json` del repo público (`gecko.update_url`).
- **El fondo apenas hace nada** (`src/fondo.ts`): abre GoodTTV, y pone «Abrir en GoodTTV» en el menú
  contextual de los enlaces y las páginas de twitch.tv. El canal lo saca de la dirección
  (`twitch-links.ts`): si una pestaña ya lo muestra, la trae al frente; si no, abre otra con
  `#/canal/<login>`. Todo lo demás vive en la página, porque en Chrome el fondo es un service worker
  que el navegador puede detener. Debe quedar en un solo archivo, sin importaciones.
- **Escribir en el chat (CHAT-1, D24),** con la API oficial (`POST /helix/chat/messages`, permiso `user:write:chat`, que
  la extensión y Android piden al vincular: `TWITCH_CHAT_SCOPES`; la TV sigue con los de lectura). Lo enviado sale
  ya, sin la cola del retraso: los servicios lo devuelven con el color de la persona y sus emotes, y la copia que llega
  por EventSub (con insignias) ocupa su sitio. Si Twitch no lo envía, su motivo. Los emotes para escribir
  (`window.api.chat.emotes`) son los del canal y los globales de 7TV, BTTV y FFZ (`EmoteCatalog.listForChannel`) y los
  de Twitch de la cuenta (`GET /helix/chat/emotes/user`, permiso `user:read:emotes`); se piden la primera vez que se va
  a escribir (`useChatEmotes`), y completarlos es común (`emote-complete.ts`, en `@goodttv/interfaz`), como la lista
  por grupos con su buscador y la ficha de un emote del chat (`emote-list.ts`). Los de 7TV, BTTV
  y FFZ se envían como texto: los ve como imagen quien tenga su extensión, o GoodTTV.
- **Los VOD (VOD-1, D24),** como invitado y sin anuncios, como el relleno del empalme: los vídeos de un canal, la lista
  maestra de usher, las miniaturas de la barra y el chat del vídeo (`vods.ts`, en `@goodttv/sin-anuncios`; a la
  interfaz llegan por `window.api.vods`, con los emotes y las insignias que pone `createPageApi`; las pantallas de la
  extensión y de Android piden los datos, las miniaturas y la lista con `vod-data.ts`, en `@goodttv/interfaz`). El chat solo se puede
  pedir por posición: por cursor exige Client-Integrity (`useReplayChat` pide por delante de lo que se ve). Por dónde
  va cada vídeo se guarda en `localStorage` (`vod-progress.ts`, en `@goodttv/interfaz`): reanuda 5 s antes y lo dice;
  pasado el 97 % (o a 45 s del final) cuenta como visto. Los vídeos del canal salen debajo de su ficha (COL-2) y, sin
  directo, en vez del vídeo, con una fila encima con los suyos a medias; también debajo de un VOD, y todos los que van
  a medias, en Inicio. También son comunes los tiempos (`vod-format.ts`) y la lista maestra pedida de antemano
  (`vod-cache.ts`); la extensión, además, la descarga (al ver el canal o pasar el ratón por el vídeo) y se la da a
  hls.js como `data:`, y lleva el vídeo al punto pedido en cuanto el búfer lo cubre, sin esperar a que hls.js tenga el
  trozo de 10 s entero (`useVodPlayer`). En Android (D25), el VOD lo reproduce Media3 con esa lista, por la red del teléfono y sin el motor
  (`Reproductor.kt`), y la página (`pantallas/Vod.tsx`) pinta encima la barra y los controles, como en un canal.
- **El idioma (D35, D44),** en las tres con `t()` y `idioma-en.ts`. La extensión y Android guardan lo elegido en el
  `localStorage` de la página; la TV, en `idioma.json` de su carpeta de datos (`apps/tv/src/main/idioma.ts`), porque
  el origen de su página cambia de puerto en cada arranque. La página de la TV lo recibe ya leído, con el idioma del
  sistema (`window.api.idioma`, que el preload pide sin esperar), y se lo pasa a `activarIdioma` como su fuente.
- **Buscar canales y abrir uno por su nombre, sin cuenta** (las tres): con el buscador de twitch.tv como invitado
  (`canales.ts`, en `@goodttv/sin-anuncios`; `guestCatalog`, en `@goodttv/servicios`, lo convierte en `catalog.search`,
  `catalog.channel` y `catalog.popular`, que da «Populares» en Inicio también con cuenta): su relevancia, que corrige
  erratas, con la foto, los seguidores y si está en directo. La extensión y Android lo usan en la página (`createPageApi`); la TV, en el proceso principal, por
  IPC (D44). Un canal abierto por la dirección
  (o, en la TV, por su nombre) se completa con `catalog.channel`: su nombre, su foto y su id, que el chat necesita
  también sin directo (en la extensión y Android, `useChannelDetails`, en `channel-details.ts`).
- **El directorio de categorías (D49),** en las tres: como invitado, también con cuenta, por el GraphQL público
  (`topCategories` y `categoryStreams`, en `canales.ts`; `guestCatalog` los convierte en `catalog.categories` y
  `catalog.category`, que en la TV van por IPC). Las más vistas con sus espectadores y sus canales, y los directos de una
  por su nombre en las direcciones de twitch.tv. Cada versión, con sus pantallas: en la extensión, «Categorías» arriba
  (`CategoriesView.tsx`); en Android, un botón en la barra de Inicio y dos pantallas que siguen montadas debajo de lo que
  se abre desde ellas (`pantallas/Categorias.tsx`, `App.tsx`); en la TV, una pestaña con dos capas de foco, la lista y los
  directos de una (`screens/CategoriesScreen.tsx`).
- **Tus seguidos, por espectadores o «Recomendado para ti»** (la extensión y Android): Helix solo los da por espectadores; el
  orden recomendado es propio, con los minutos que suena cada canal en GoodTTV, en directo o en sus VOD, que pesan la
  mitad cada 14 días (`watch-time.ts`, en `@goodttv/interfaz`, en `localStorage`), y luego los abiertos hace poco.
- **Retroceder el directo (DVR-1):** con el VOD que graba la emisión en curso (`liveArchive`, en `vods.ts`; va unos
  segundos por detrás del directo), la barra del canal va desde que empezó (`useLiveArchive` y `liveBar`, en
  `live-archive.ts` de `@goodttv/interfaz`, comunes a la extensión y a Android). Si ese VOD es solo para suscriptores
  (su token de invitado restringe las calidades), no se ofrece: ← y la pausa se quedan en la lista del empalme
  (D34). Lo que cubre la lista del empalme (~100 s,
  menos el margen del modo), ← y la barra lo recorren en el mismo reproductor (`seekBy` de `useHlsPlayer`; ← y →, al
  fotograma clave más cercano, a menos de 1 s, como Media3 en Android, para no decodificar hasta 2 s de vídeo): lo
  retrocedido se conserva, sin acelerar ni que hls.js vuelva solo al directo, hasta avanzar a él o pulsar «Ir al
  directo» (Fin), que también reanuda y olvida la pausa. Moverse en pausa mueve también el momento en que se pausó.
  Más atrás, o al reanudar tras más de un minuto en pausa, se abre ese VOD en ese momento
  (`#/vod/<id>?t=…&directo=<canal>`): la hora del directo menos la de cuando empezó a grabarse; avanzar más allá de lo
  grabado vuelve al canal, cuyo empalme se ha mantenido caliente. El directo y el VOD son pantallas distintas, cada una
  con su `<video>`: cada reproductor nuevo empieza con el volumen y el silencio que eligió la persona en esa pestaña
  (`volume.ts`, en `@goodttv/interfaz`), y el del directo, con la calidad elegida (`chosenLiveQuality`, en
  `player/live-quality.ts`; «Auto», la mejor), que se guarda como el volumen. El VOD al que se retrocede empieza en ella
  (`levelFor`, en `useVodPlayer`). Como en twitch.tv, se guardan en `localStorage` (`page-storage.ts`, que no lanza si
  el navegador no lo deja usar): una pestaña nueva, o GoodTTV
  al volver a abrirlo, empieza con lo último que se eligió. El camino del directo no cambia: mientras no se retrocede, es el de siempre. En Android (D25), lo que cabe en la lista lo recorre Media3 dentro de su ventana del
  directo (`saltar` y `alDirecto` en `Reproductor.kt`), al fotograma clave; lo de más atrás, igual que en la extensión.
- **Solo audio con la pantalla apagada (Android, D32 y D33):** al dejar de verse la app sin el PiP a la vista
  (`MainActivity.onStop`), el canal pasa a la calidad `audio_only@0` (`Reproductor.soloAudio`), que el empalme admite
  como una más (`pickVariant`, sin relleno con el VOD), y al volver a verse (o al encenderse la pantalla, aún
  bloqueada), a la de antes. Solo si suena en el directo, sin pausa ni retroceder. Sin corte: un relevo
  (`Reproductor.relevar`) prepara el reproductor nuevo callado, lo coloca en la hora (PDT) del de antes y cambia cuando
  este llega; mientras, el motor sigue sirviendo al de antes su empalme (`outgoing`, en `directo.ts`).
- **Imagen en imagen (la extensión, D32):** `togglePictureInPicture` de `useHlsPlayer` y `useVodPlayer` sobre su
  `<video>`, con el botón donde el navegador tiene la API (`PictureInPictureButton.tsx`).
- **Si sigues el canal (SEG-1):** la ficha lo dice (`GET /helix/channels/followed`, con el permiso que ya había;
  `useFollowing`, en `channel-details.ts`, común con Android). Seguir
  y dejar de seguir no tiene API oficial desde 2021 (D24): el botón abre el canal en twitch.tv.
- **Sin embed oficial de respaldo:** Manifest V3 no admite código remoto, y el SDK de Twitch lo es.
  Si falla el reproductor propio, «Reintentar» o «Abrir en twitch.tv».
- **La plataforma** (`packages/interfaz/src/platform.tsx`) solo lleva la configuración extra de
  hls.js: la extensión le pone el `FetchLoader`.
- **Los tokens, en la página.** La regla de la TV (el renderer no ve un token) protege de lo que
  carga la ventana. Aquí la página es la propia extensión: Manifest V3 no deja cargar código ajeno,
  y los tokens se quedan en los servicios; la interfaz solo recibe datos. Se guardan sin cifrar en
  `chrome.storage.local`, y Ajustes lo avisa.
- **Inicio al abrir, sin esperas en cadena** (D26; `useHome`, en `packages/interfaz/src/data.ts`, común con la TV y
  Android). Lo de ahora llega en unas décimas, porque lo que se pide a Twitch sale a la vez:
  - **la sesión guarda la cuenta junto al token** (`StoredToken.identity`: id, nombre de usuario y permisos, de
    `/validate`). Con ella, `TwitchSession.credentials` no espera a validar: la validación va a la vez, una sola por
    token, y la cuenta (`auth.snapshot`) sí la espera. Si el token ya no vale, Helix contesta 401 y se renueva, y si
    tampoco se puede, la validación cierra la sesión. Un token caducado se renueva sin probarlo. Una sesión de antes, o
    recién vinculada, espera a la primera validación, que la guarda;
  - **la foto y el nombre de la cuenta** se piden a la vez que se valida (`TwitchService.authSnapshot`, con la cuenta
    guardada);
  - **las fotos de los canales** se guardan una semana (`profile-pictures.ts`; en la página, en el `localStorage` de
    Inicio; en la TV, en memoria) y solo se piden las que faltan;
  - **`useHome` pide los directos al abrir** si lo guardado dice que había cuenta, sin esperar a comprobarla; al llegar
    la cuenta, la misma carga sigue. Lo pedido antes de saberla, si falla, no es un error hasta que la cuenta lo diga
    (puede ser que la sesión haya caducado).

  Mientras llega, lo que se vio la última vez con esa cuenta (`window.api.home`, sin tokens) si es de hace menos de
  5 min (`SAVED_HOME_FRESH_MS`); si es más viejo, `useHome` da su forma (`sketch`: cuántos directos había en cada lista
  y los recientes), y las pantallas pintan los huecos vacíos, sin saltos al llegar lo de ahora. Lo guardado se olvida al
  cerrar sesión, y no se usa si la cuenta resulta ser otra. Sin nada guardado, Inicio dice «Cargando…» hasta saber si
  hay cuenta: antes enseñaba la bienvenida sin cuenta y luego a todos los seguidos como desconectados. `useResource`
  vuelve a «cargando» al cambiar de función de carga, para que lo cargado sin cuenta no se enseñe como si fuera con
  ella. La extensión lo guarda en `localStorage` (`page-home.ts`, en `@goodttv/servicios`), que la plataforma lee sin
  esperar: sale en la primera imagen.
- **Sin poder comprobar la cuenta** (sin red, Twitch caído), lo guardado sigue, sea de cuando sea, con un aviso de que
  es de la última vez y «Reintentar», nunca la bienvenida (EXT-4). `useAuth` distingue los dos fallos:
  - si `auth.snapshot()` lanza, no ha contestado: `unreachable`, y la sesión sigue guardada. No se pide nada a Twitch,
    y se vuelve a comprobar sola con el evento `online` y cada 30 s. Ajustes ofrece también «Cerrar sesión»;
  - si devuelve `error`, sí ha contestado: la sesión ha caducado y `TwitchAuth` ya la ha cerrado. Lo guardado se
    olvida, como sin cuenta.
- **Varios canales en una pestaña,** con una opción de Ajustes (EXT-6, D42). Cada celda es un `useHlsPlayer` con su directo
  (`?hueco=`, `directo-huecos.ts`); suena una y su chat es el que se ve. Pasar de un canal a la cuadrícula o al revés no corta el vídeo: el
  reproductor cambia de pantalla (`waiting` en `useHlsPlayer.ts`). Sin activarla, `grid` no llega al hook y la dirección es Inicio.
- **Varias pestañas a la vez,** cada una con su canal (EXT-5). Cada pestaña lleva su directo, su reproductor y su chat;
  comparten la sesión de Twitch, los recientes y las preferencias, en `chrome.storage.local`:
  - **lo que lee, cambia y escribe va en un bloqueo del navegador** (`navigator.locks`, uno por clave, `storage.ts`).
    Renovar el token sobre todo: el token de renovación solo vale una vez, y si dos pestañas lo renovaran a la vez la
    segunda daría la sesión por caducada en todas. Al entrar en el bloqueo, si otra ya lo renovó, se usa el suyo
    (`TwitchSession`). Los recientes, igual (`LocalStore`), para no perder uno;
  - **lo que cambia otra pestaña se avisa** (`chrome.storage.onChanged`, en `goodttv.tsx`): entrar o salir de la cuenta
    y las preferencias;
  - **cada una suena por su cuenta, como las de twitch.tv** (D48): ninguna calla ni para a las demás, y una que deja de
    verse sigue sonando. Solo espera la que se abre sin verse (con el clic central, o en segundo plano): no empieza hasta
    que se mira por primera vez (`escritorio/visibilidad.ts`), y desde entonces sigue. Hasta D48 sonaba una sola, la
    última que se miró;
  - **el chat, solo en las pestañas a la vista:** EventSub admite tres conexiones con suscripciones por cuenta. Al
    ocultarse se cierra sin vaciarse, y al volver sigue (`useChat`, `connected`);
  - **el botón y «Abrir en GoodTTV»** llevan a la pestaña que ya muestra esa vista o abren otra junto a la actual. El
    fondo no ve las direcciones de las pestañas (sin el permiso «tabs»): pregunta a las páginas (`pestanas.ts`).
- **El directo, en la página.** `installDirecto` (`directo-fetch.ts`, en `@goodttv/sin-anuncios`) sustituye el
  `fetch` de la página: lo que pide a sus propias rutas `/stream/` lo responde el directo en memoria, como el servidor
  local de la TV, y el directo pide a Twitch con el `fetch` original. hls.js usa su `FetchLoader`, porque el
  `XhrLoader` por defecto no pasaría por ahí. Así el reproductor pide lo mismo en las dos versiones.
- **Sin worker de hls.js, como en la TV:** la versión ESM de hls.js no lo trae, así que
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
  la posición sale de la lista, y al volver reanuda ([verificacion.md](verificacion/hasta-0.2.0.md#extensión-de-navegador)).
- **Lo del laboratorio va por la dirección de la propia página** (`src/lab.ts`): `?pausa=` simula
  pausas globales (como `GOODTTV_PAUSA_SIMULADA`), y `?registro` expone el registro del empalme y el
  hls.js del reproductor para las pruebas ([desarrollo.md](desarrollo.md#prueba-de-humo)). No hay
  otra página de reproductor: las pruebas abren `goodttv.html#/canal/<login>`.

El resto de esta guía describe la TV. Las rutas de `src/main`, `src/preload` y
`src/renderer` son relativas a `apps/tv`; las pantallas y la navegación están en `src/renderer/src`, y lo común
(reproductor, chat y datos), en `packages/interfaz/src`.

## Las tres piezas de Electron

```text
Proceso principal (src/main) ── tiene todos los permisos
├── index.ts               ventana, servidor local (interfaz y /stream/), permisos, arranque
├── local-server.ts        http://127.0.0.1:<puerto>, solo en 127.0.0.1 y con el Host exacto
├── input-router.ts        TODAS las teclas del mando → acciones («up», «ok», «back»…; @goodttv/contratos)
├── @goodttv/servicios     cuenta (código + tokens) y Helix; chat por EventSub, emotes y tokenizador;
│                          recientes y preferencias. La TV aporta dónde se guardan:
├── token-vault.ts         la sesión, cifrada con el llavero del sistema (o archivo 0600 sin él)
├── local-store.ts         recientes y preferencias (archivo JSON local)
├── saved-home.ts          Inicio de la última vez (window.api.home; archivo JSON local)
├── settings-store.ts      el Client ID (variables de entorno y de compilación)
└── ipc.ts                 la única puerta de entrada desde la interfaz
        │  IPC validado con Zod (@goodttv/contratos)
Preload (src/preload) ── expone window.api, valida lo que entra y lo que sale
        │
Renderer (src/renderer/src: main.tsx monta App) ── React, sin acceso a Node
├── navigation.tsx         capas, memoria de foco, recuperación del foco perdido (navigation-geometry.ts)
├── App.tsx                pestañas Siguiendo / Buscar / Categorías / Ajustes y pila Inicio → Reproducción
├── screens/               HomeScreen, SearchScreen, CategoriesScreen (D49), AccountScreen
├── player/                PlayerScreen
├── ui.tsx                 las piezas de las pantallas (filas de canal, avatar, «EN DIRECTO»…)
├── styles.css             los estilos
└── @goodttv/interfaz      datos (useHome…), useHlsPlayer (reproductor propio), useChat, ChatPanel, el idioma
```

**Regla de oro:** el renderer nunca ve un token. Las llamadas a Twitch con credenciales salen
del proceso principal, y la interfaz recibe datos ya validados.

**Inicio al abrir** (`useHome`, como en la extensión, D26): mientras llegan los directos, lo que se vio la última vez
con esa cuenta si es de hace menos de 5 min; si no, «Cargando canales…». La TV no lo guarda en `localStorage`: el
servidor local cambia de puerto en cada arranque, y con él el origen de la página, así que no duraría. Lo guarda el
proceso principal en `saved-home.json` (archivo 0600), y la interfaz lo pide por IPC al abrir: tarda unos
milisegundos, durante los que Inicio no enseña nada. Las fotos de los canales, en memoria del proceso principal: la
primera carga tras abrir la app las pide todas.

## Cómo viaja una pulsación del mando

1. El mando envía una tecla estándar (por ejemplo, `ArrowDown`).
2. `input-router.ts` la recibe en `before-input-event`, *antes* de que llegue a la página. La
   traduce a una acción (`down`) y anula la tecla original.
3. La acción llega por IPC a `navigation.tsx`, que se la entrega a la **capa superior**: la
   pantalla visible o el submenú abierto.
4. La capa puede consumirla. Por ejemplo, el reproductor usa ↑/↓ para cambiar de canal. Si no la
   consume, `navigation` mueve el foco en esa dirección: primero a los controles alineados con el
   actual (su «haz») y, entre ellos, al más cercano (`navigation-geometry.ts`).

Por eso da igual dónde esté el foco DOM. La excepción: con un campo de texto activo, las letras, Espacio y Retroceso
pasan al campo.

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
- Si el foco se pierde (el elemento desaparece), la primera tecla solo lo recupera y no mueve nada.

## Reproducción

**El reproductor propio (D11):** `useHlsPlayer`, un `<video>` con hls.js sobre el
directo sin anuncios que sirve el proceso principal en `/stream/<canal>/` (`src/main/stream`, sobre
`@goodttv/sin-anuncios`: empalme de sesiones, relleno con el VOD, recarga bloqueante). El modo de retraso (`latencyMode`
en las preferencias) llega al proceso principal en `?modo=` y elige margen y relleno. `useChat`
retiene los mensajes en una cola (`ChatDelayQueue`) hasta que la imagen los alcanza; los avisos de
estado no esperan. La pantalla va en modo cine: el vídeo ocupa todo el alto y la franja de título y
controles flota encima y se oculta a los 4 s sin tocar el mando mientras se reproduce; con ella
oculta, una tecla solo la muestra (↑ ↓ siguen cambiando de canal y Play/Pausa sigue funcionando).
Si falla, la franja dice «No se pudo preparar el directo sin anuncios.» con «Reintentar» enfocado,
como la extensión. No hay reproductor de respaldo: el oficial de Twitch (embed), con su modo
«Controles de Twitch», se quitó tras la 0.5.1, y con él el HTTPS del servidor local, que solo
existía porque su `parent` lo exigía.

**Arranque, latencia y fluidez del reproductor propio (D16):**
- **Las sesiones, a la vez** (`Empalme.start`): `site`, `embed`, `popout` y `mobile_feed@android`
  (`tipo@plataforma`, `sessionKind`) se abren en paralelo y cada una consulta su
  lista en cuanto abre; publica la primera que da directo. `info` contesta en cuanto hay algo
  publicado (`Empalme.changed`), sin sondear.
- **Precalentar** (`prewarmStream`, `usePrewarm`, en `player/prewarm.ts`): con el foco 400 ms en un canal en directo de
  Inicio, en la TV, o con el ratón parado 150 ms encima en la extensión, el directo abre ya ese
  empalme en un hueco aparte (`/stream/<canal>/precalentar`) que no para el que suena. Al abrir el
  canal pasa a activo; si nadie lo abre, se para a los 30 s como cualquier otro.
- **La conexión de los fragmentos, por adelantado:** el DNS de los hosts de Twitch tarda ~0,3 s (TTL 0), así que el empalme pide
  un `HEAD` al ver un host nuevo en la lista, por la misma red que el reproductor (D37).
- **Empezar en el objetivo:** hls.js no empieza más cerca del final que `TARGETDURATION`, y con
  relleno la lista declara 13 s (los trozos del VOD). `useHlsPlayer` empieza a cargar él mismo en
  «final − objetivo» (`autoStartLoad: false` y `startLoad` al llegar la lista). Por lo mismo, tras
  un error fatal de medios vuelve a cargar él mismo (`startLoad` después de `recoverMediaError`):
  hls.js ya ha parado la carga y, sin `autoStartLoad`, no la reanuda.
- **Saltar en vez de acelerar:** lo que sobre de margen se salta de una vez, sin pasar del búfer: al empezar (la
  primera lista puede llegar hasta un fragmento atrasada respecto a Twitch, y no se nota hasta la siguiente; un salto
  de ~1-2 s hacia el segundo 3) y tras una parada. Acelerar a 1,05× descartaba fotogramas (60 fps a 1,05× piden 63 por
  segundo) y, en Firefox y Zen, cada cambio de velocidad dejaba el sonido algo más atrás de la imagen, sin volver (D34).
  En Adaptativo, una parada de 1 a 12 s en pleno directo no se salta: lo que añade es el margen que le faltaba a ese canal (D36).
  No se salta con la lista parada (una pausa global): ese retraso no es margen que sobre. Tras una pausa de más de 1 s,
  lo pausado se conserva como lo retrocedido, con «Ir al directo»; en *Directo* y en la TV, que no tiene ese botón, se
  salta.
- **La lista abarca 100 s** (`WINDOW_SECONDS` en el empalme), más de lo que hls.js deja quedarse atrás antes de
  saltar (`liveMaxLatencyDuration`: el objetivo más 60 s, 84 s en *Sin paradas*). *Sin paradas* y *Adaptativo* (tras
  el primer relleno) conservan el retraso que se añade, como una pausa de la persona, hasta 10 s por debajo de ese
  tope. Con 20 fragmentos (40 s) y el objetivo de 24 s, bastaban 16 s de más para que la posición se saliera de la
  lista, y hls.js la recolocaba a saltos (15 oct, [verificacion.md](verificacion/0.2.1-0.2.3.md#sin-paradas-saltos-al-crecer-el-retraso)).
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
  - **También con fMP4** (`EXT-X-MAP`; p. ej. con *Enhanced Broadcasting*, como `illojuan`), con el mismo margen de
    2,5 fragmentos, desde hls.js 1.7.4. Hasta la 1.7.3, hls.js situaba cada trozo que llegaba respecto al principio del
    fragmento y, a partir de 1 s, lo daba por desfasado (`isInvalidInitPts`) y lo ponía encima de lo anterior
    ([verificacion.md](verificacion/0.2.1-0.2.3.md#fmp4-saltos-con-la-carga-progresiva)), así que fMP4 se cargaba fragmento a
    fragmento y con 3 fragmentos de margen. La 1.7.4 lo arregla
    ([verificacion.md](verificacion/0.4.1.md#hlsjs-174-ren-4)).
  - **El VOD en fMP4 sigue sin carga progresiva** (`useVodPlayer`, decidido en `LEVEL_UPDATED`, porque al llegar
    `LEVEL_LOADED` hls.js ya ha pedido el primer trozo): con la 1.7.3 el primero no se veía y hls.js volvía a empezar, a
    veces en peor calidad, y con la 1.7.4 no se ha medido. El VOD va en el mismo formato que el directo.
- **El chat, barato de pintar:** cada lote solo pinta los mensajes nuevos (`Message` memoizado) y la
  lista lleva `contain: strict`, así que los mensajes que entran no recolocan el resto de la pantalla. En la extensión
  y en Android, además (D31):
  - la lista va dentro de un bloque (`chat__scroller`, `chat__marco`): Chrome no maqueta aparte a una hija de una
    rejilla o de un flex, aunque lleve `contain: strict`. La de la TV aún lo es;
  - el chat va en su propio componente (`ChannelChat`, `CanalChat`): un lote no vuelve a pintar el canal;
  - los mensajes más antiguos se quitan por tandas (`CHAT_TRIM`, en `useChat`): la lista guarda entre 150 y 200;
  - en la extensión, la lista tiene fondo opaco: así Chrome compone su desplazamiento sin perder los subpíxeles del
    texto (en pantallas a 1x, sin fondo, no lo hacía).

**Un directo que se queda parado** (`player/stuck.ts`, en la extensión y la TV): un error fatal de medios se recupera
(`recoverMediaError`) hasta tres veces seguidas, y el cuarto deja «No se pudo preparar el directo sin anuncios.» con
«Reintentar»; con 30 s de vídeo avanzando, el contador vuelve a cero. Y un vídeo que no avanza sin estar en pausa, ya
reproduciendo y con la emisión en marcha, pasa a «Twitch no responde.» con «Reintentar» a los 30 s si tiene datos por
delante en el búfer (lo para el reproductor) o a los 4 min si no los tiene (espera al directo, y una pausa global sin
relleno dura hasta 3 min). Si después avanza solo 10 s, vuelve a `ready` y el aviso se va (no a la primera: tras un corte
de red, el vídeo puede moverse un par de segundos y volver a pararse). Antes de esto la imagen se quedaba
congelada sin aviso: la lista la sirve la propia página o el servidor local, así que hls.js no llega a dar un error de red.

**Fallos en Android (D38):** `Reproductor.fallo` vuelve a abrir solo, con esperas crecientes y un límite, y sin red espera
el aviso de `AvisoDeRed`. La página solo pinta las fases `reconectando` y `sin-red`. Cada intento pide antes
`/motor/reiniciar`, que cambia el empalme por uno nuevo. Lo mismo, sin esperar, si el vídeo se para con la red recién
cambiada o si las paradas han añadido más de 12 s de retraso (D40).

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
| Añadir o cambiar un texto de cualquier versión | La frase en `t("…")` y su inglés en `packages/interfaz/src/idioma-en.ts`. Si es un mensaje de `@goodttv/servicios`, igual, y se pinta con `tMensaje` (D35) |
| Añadir una tecla del mando | `packages/contratos/src/keys.ts` (`actionForKey`) y su prueba |
| Cambiar colores, tamaños o espaciado | `apps/tv/src/renderer/src/styles.css` en la TV, `apps/navegador/src/escritorio/desktop.css` en la extensión y `apps/android/web/estilos.css` en Android (variables en `:root`) |
| Añadir una sección a Inicio | `packages/interfaz/src/data.ts` (`loadHome`, `toSavedHome` con `SavedHomeSchema` en `@goodttv/contratos` para que se guarde y, si debe tener su forma mientras carga, `HomeSketch`) y las pantallas de cada versión (en la TV, `screens/HomeScreen.tsx`) |
| Otro proveedor de emotes | `packages/servicios/src/chat/emote-catalog.ts` y el host en `packages/contratos/src/chat.ts` y en la CSP de `src/renderer/index.html` |
| Una llamada nueva a Twitch | `packages/servicios/src/twitch-service.ts` → `ipc.ts` → `preload/index.ts` → `packages/contratos/src/contracts.ts` |
