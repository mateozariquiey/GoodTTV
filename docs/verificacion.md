# Verificación: qué está comprobado y qué falta

Fecha: 8 de octubre de 2026. Entorno de laboratorio:
- **Equipo:** sobremesa con Arch Linux, Electron 44 y una pantalla virtual X11 (Xvfb) de
  1920×1080, sin GPU.
- **Teclas:** reales de X11, enviadas con `xdotool`, como las de un mando USB.
- **Audio:** silenciado por Chromium (`--mute-audio`).

Lo comprobado en el mini PC (GMKtec M6 Ultra), la TV Samsung UE65TU7095 y el mando físico está en
[En el mini PC, la TV y el mando](#en-el-mini-pc-la-tv-y-el-mando).

## Comprobado automáticamente

`bun run verify`: Biome, TypeScript estricto, **169 pruebas unitarias** (más 4 fallos esperados
heredados de VacuumStream y documentados en su código) y build.

| Área | Qué cubren las pruebas |
| --- | --- |
| Teclas | Mapeo de cada tecla; no repetir OK, Atrás ni Play/Pausa; texto en campos; tragar la tecla que cambia de modo |
| «Controles de Twitch» | Tab/Mayús+Tab/Enter solo hacia el marco del reproductor con el foco; nada si el foco o la URL cambian, o si otro depurador está conectado; salida con Atrás o al perder el foco la ventana |
| Navegación | Capas, memoria por pantalla, recuperación de foco perdido, entrada por el control `data-nav-entry`, pestañas, foco espacial «en haz» |
| Chat | Tokenizador (emotes, anchura cero, menciones), catálogo 7TV/BTTV/FFZ con prioridades y fallos aislados, EventSub (suscripciones, cambio de canal, reconexión, keepalive, falta de permiso), historial acotado |
| IPC y preload | Solo la ventana y el origen propios pueden llamar; validación de entradas y salidas; la API expuesta no incluye nada más |
| Servicios | Helix (seguidos, populares por idioma, búsqueda, recientes en directo), renovación del token ante 401, almacén local atómico |

`bun run test:e2e`: **7 pruebas** con la app real, Twitch real y teclas X11, todas en verde:

| Prueba | Resultado |
| --- | --- |
| Recorrido crítico (invitado) | Abrir canal → el vídeo avanza sin silenciar en el reproductor → nada solapa el iframe y mide al menos 400×300, con chat, con el selector de calidad abierto y con el chat oculto → Play/Pausa funciona con el selector abierto → Espacio pausa → la tecla Play reanuda → Atrás vuelve **con el foco en el mismo canal** → otro canal reproduce → Atrás. Twitch elige la resolución (ABR); la prueba la anota sin exigirla: la ejecución final llegó a **1920×1080**, otra empezó en 640×360 |
| Navegación | Foco inicial útil, pestañas, Buscar con el teclado en pantalla, prueba del mando, preferencia persistente |
| Recuperación | Fallo al cargar el reproductor → «Reintentar» enfocado → se recupera; Atrás funciona mientras carga |

**Variante privada (D11), 11 de octubre:** las 7 pruebas, adaptadas al reproductor propio y al modo
cine, pasan dos veces seguidas en Weston sin pantalla (`E2E_WAYLAND`, teclas con `sendInputEvent`):
el recorrido crítico con `trymacs` y `ml7support`, y la recuperación pasando del reproductor propio
al de Twitch. No se han ejecutado con Xvfb y xdotool.

## Comprobado a mano en el laboratorio

| Qué | Resultado | Evidencia |
| --- | --- | --- |
| Autoplay | Con la política por defecto de Electron arranca solo. Si algo tapa el iframe, Twitch lo bloquea («style visibility»); el flag `--autoplay-policy` no cambia nada | [captura del prototipo](evidencia/autoplay-bloqueado-por-solape.jpg), `docs/decisiones.md` |
| Puerta «contenido para determinadas audiencias» | Detectada como pista; aceptada solo con el mando: «Abrir controles de Twitch» → ↓ ↓ → OK → Atrás. Twitch la recuerda en el perfil | [secuencia](evidencia/puerta-contenido-con-mando.jpg) |
| Cuenta personal | Vinculada con un código desde el móvil; Inicio muestra los seguidos en directo (27–34 según la hora) y búsqueda real de Helix | [inicio](media/inicio.jpg), [buscar](media/buscar.jpg) |
| Chat | EventSub con la cuenta: mensajes en tiempo real, insignias, respuestas y menciones. En un minuto de un canal grande se vieron decenas de emotes de 7TV y de Twitch, sin imágenes rotas. En esos canales no aparecieron emotes de BTTV ni FFZ; sus catálogos se comprobaron contra las APIs reales | [reproducción](media/reproduccion.jpg) |
| Cambio de canal ↑/↓ | Cambia de canal con `setChannel` y el chat pasa al nuevo canal; el foco se queda en «Pausa» | [vídeo](media/demo.mp4) |
| Calidad | Selector con las calidades que ofrece Twitch (Auto, 1080p60 Source, 720p60…) en lugar de los controles, sin tapar el vídeo | [captura](media/calidad.jpg) |
| Canal desconectado | Aviso claro, Reanudar y Silencio desactivados, Volver disponible | [AppImage](evidencia/canal-desconectado-appimage.jpg) |
| AppImage | `dist/GoodTTV-0.1.0-x86_64.AppImage` arranca, sirve la interfaz por HTTPS local y reproduce un directo | — |
| Aceleración de vídeo | En la GPU del sobremesa (AMD RX 9070 XT, Mesa), Electron 44 informa `video_decode: enabled` (disponible) con Wayland y con X11, sin flags. **No** se comprobó qué decodificador usa Twitch al reproducir | Ajustes → Acerca de |

Fallos encontrados y corregidos en estas pruebas:
- El foco al salir del modo «Controles de Twitch».
- La memoria de foco del reproductor entre visitas.
- La pestaña actual no se veía enfocada.
- El grid del chat crecía con los mensajes.
- → desde una columna estrecha saltaba a las pestañas: era el algoritmo de foco.
- «Cerrar sesión» podía recibir el foco por defecto y cerrar la sesión con un OK suelto.
- Los fallos de la revisión final; véase `docs/decisiones.md`, sección 5.

## En el mini PC, la TV y el mando

16 de octubre, con la 0.2.2 (Electron 44.2.0) instalada desde el AppImage de la release:
- **Equipo:** el mini PC (Ryzen 5 7640HS, Radeon 760M) con Kubuntu 26.04 y Plasma en Wayland, a 3840×2160 a 60 Hz,
  escala 100 % y sin HDR, conectado a la TV.
- **Uso:** la app se abre a pantalla completa desde el centro multimedia (Kodi), y el usuario la maneja con el mando
  (G20S Pro).
- **Rendimiento:** medido en [Rendimiento en el mini PC](#rendimiento-en-el-mini-pc-hw-2).

| Punto | Cómo | Resultado |
| --- | --- | --- |
| Audio por HDMI | Un directo y `apps/tele/scripts/diagnostico.sh` | Suena por la TV; la salida activa es la HDMI de la Radeon |
| Aceleración de vídeo | El decodificador que elige Chromium (dominio `Media` de CDP) y la carga del motor de vídeo de la GPU | Decodifica la GPU: `VaapiVideoDecoder` en los 14 reproductores de la sesión (H.264 High, 1080p60), con el motor de vídeo al 8 % y la CPU a menos de un tercio de un núcleo |
| Mando | Ajustes → Probar el mando | Flechas, OK, Atrás y Play/Pausa salen con su acción |
| Foco | Abrirla desde Kodi y mandar una notificación del escritorio con ella abierta | Recibe el mando al abrirse. La notificación no se ve encima de la app a pantalla completa, y el mando sigue en ella |
| Suspensión y reanudación | — | No aplica a este mini PC: no se suspende, porque aloja otros servicios. Al apagar la TV se cierran las apps. Sin comprobar en un equipo que se suspenda |
| Legibilidad a 3 m | Desde el sofá, en la TV de 65″ | Se lee bien: la lista, los títulos y el chat |
| Inicio al abrir | Abrirla dos veces | La primera, «Cargando canales…» (no había nada guardado); la segunda, la lista nada más abrir ([Inicio al abrir en la tele](#inicio-al-abrir-en-la-tele)) |

Por diseño (D11), el reproductor no usa la cuenta: pide el vídeo con sesiones de invitado, así que Turbo y las
suscripciones no cuentan. La cuenta sirve para los seguidos y el chat.

## Extensión de navegador

Hito 1 (11 de octubre): el reproductor en una página de la extensión, con la prueba de humo
([desarrollo.md](desarrollo.md#prueba-de-humo)) en Chrome for Testing 155 y Firefox 157, sin
ventana y sin sonido.

| Prueba | Chrome | Firefox |
| --- | --- | --- |
| 60 s de directo | 1080p; el vídeo avanza al ritmo real; sin errores; 2-5 s de retraso | Igual |
| Arranque desde el VOD (`--pausa 0,20,1`) | 4 trozos del VOD; vuelta al directo con 0 s de salto; sin paradas | Igual |
| Pestaña oculta 6 min, sonando | Avanza 360 s de 360; sin esperas; mismo retraso al volver | Igual |
| Pestaña oculta 6 min, silenciada | Igual que sonando | Igual |
| Pestaña oculta 6 min, en pausa | hls.js salta al directo al salirse de la lista; al volver reanuda | Igual |

- **Sin comprobar:** que el navegador descarte o congele la pestaña (ahorro de memoria o de
  energía) ni sesiones de más de unos minutos.
- **Chrome se controla por CDP sin Playwright.** Playwright activa la emulación de foco, con la que
  Chrome da por visibles todas las pestañas, y lanza Chromium sin el freno a las pestañas en segundo
  plano.

Hito 3 (11 de octubre): la interfaz de la tele en la extensión, con el teclado (en el hito 4 la sustituyó la de escritorio). La prueba de la
interfaz ([desarrollo.md](desarrollo.md#prueba-de-la-interfaz)) pasa sus 18 pasos en Chrome y en
Firefox:
- pestañas con flechas y OK;
- teclado en pantalla;
- código de Twitch para vincular la cuenta, y cancelarlo;
- un canal de recientes que reproduce a 1080p;
- Espacio pausa y reanuda;
- Escape vuelve a la misma fila;
- Ajustes sin la sonda del mando;
- una sola pestaña de GoodTTV.

En Firefox las teclas se simulan en la página.

- **La cuenta, con la del usuario** (`node apps/navegador/test/humo/cuenta.mjs
  [--navegador firefox]`). La prueba muestra un código para autorizarlo en twitch.tv/activate y
  usa un perfil temporal que se borra al terminar. En Chrome y en Firefox pasó sus 6 pasos:
  - autoriza la cuenta y guarda la sesión;
  - Inicio con 48 seguidos y 12 populares;
  - llegan mensajes del chat;
  - un token de acceso caducado se renueva solo;
  - cerrar sesión borra la sesión guardada.
- **Firefox:** sin pulsaciones reales (activaciones nativas duplicadas, IME, atajos).

Hito 4 (11 de octubre): la interfaz de escritorio (D14). La prueba de la interfaz
([desarrollo.md](desarrollo.md#prueba-de-la-interfaz)) pasa sus 25 pasos en Chrome y en Firefox:
- buscar con / y abrir con Enter un canal que reproduce;
- Espacio y un clic en el vídeo pausan y reanudan;
- T y Esc para el modo teatro;
- C para el chat y M para el silencio;
- volver a Inicio con el canal en «Seguir viendo»;
- el código de la cuenta y cancelarlo;
- un modo de retraso que se conserva al recargar;
- una sola pestaña.

La prueba del reproductor sigue a 1080p y sin errores.

- **La cuenta, con la del usuario y la interfaz de escritorio:** en Chrome y en Firefox pasaron los
  6 pasos de `cuenta.mjs`:
  - 41 seguidos en la columna y 64 miniaturas;
  - chat de un directo;
  - renovación de un token caducado;
  - cerrar sesión.
- **Sin comprobar todavía:**
  - el menú contextual «Abrir en GoodTTV»: los navegadores sin ventana no lo dejan pulsar; está
    probada la lectura del canal desde la dirección;
  - la pantalla completa real y la rueda para el volumen.

Hito 5 (11 de octubre): el relleno con el VOD y los modos de retraso en la interfaz de escritorio, con
la prueba de los modos ([desarrollo.md](desarrollo.md#prueba-de-los-modos-de-retraso)) y los mismos
criterios que la tele:

| Escenario | Chrome | Firefox |
| --- | --- | --- |
| Adaptativo, `150,45`, 400 s | Una parada de 18 s en la primera pausa, ninguna después | Una de 20 s en la primera, ninguna después |
| Sin paradas, `150,45`, 400 s | Ninguna parada; dos rellenos | Igual |
| Arranque desde el VOD, `0,20,1`, 90 s | Empieza en el VOD, vuelve con 0 s de salto, sin paradas | Igual |

- **Vuelta al directo:** todos los rellenos volvieron con 0 s de salto.
- **Repetida el 12 de octubre con criterios más estrictos**, tras la revisión final: cada pausa
  tiene que rellenarse con trozos del VOD, la parada de Adaptativo tiene que caer antes de la
  segunda pausa, y el vídeo no puede quedar en pausa ni desaparecer. Pasan los tres escenarios en
  los dos navegadores, con los mismos resultados; Adaptativo para 18 s en la primera pausa. Con un
  canal cuyo VOD no se puede leer, falla, como debe.
- **Fotogramas perdidos** (sin ventana, decodificación por software): entre 0 % y 1,1 %; el 1,1 %, en
  Adaptativo, incluye la parada. Demultiplexar en la página no da problemas en Firefox.
- **Sin comprobar:** el rendimiento en hardware real y con la pantalla del usuario.

Hito 6 (11 de octubre): la instalación (D15), con el `.xpi` de `bun run pack:navegador`.

| Comprobación | Zen 1.23.2b | Firefox 157 |
| --- | --- | --- |
| Instalar el `.xpi` sin cambiar nada | Rechazado: falta la firma | Rechazado |
| Igual, con `xpinstall.signatures.required` a `false` | Instalado como permanente; abre la interfaz | Rechazado |
| Reiniciar el navegador | Sigue activo y con sus datos | — |
| Reinstalar la misma versión e instalar una nueva (0.1.1) | Se actualiza y conserva los datos | — |

- **Cómo:** navegadores sin ventana; se instala por la misma vía que «Instalar complemento desde
  archivo» (`AddonManager.getInstallForFile`), pero sin el diálogo de confirmación.
- **El `.xpi`:** un ZIP válido (con las CRC comprobadas); dos empaquetados seguidos dan el mismo
  archivo.
- **La extensión en Zen**, instalada como temporal:
  - pasan los 25 pasos de la prueba de la interfaz;
  - en el escenario Adaptativo de los modos, una parada de 20 s en la primera pausa y ninguna
    después, y los dos rellenos vuelven con 0 s de salto. Se pierde el 1,8 % de los fotogramas,
    contando la parada.
  - con aminematue no hubo relleno: su VOD no se puede leer (`vod-error`, también en Chrome).
- **Chrome:** descomprimida, como desde el hito 1.
- **En el Zen del usuario** (12 de octubre): la instaló siguiendo los pasos de
  [desarrollo.md](desarrollo.md#instalarla), con los diálogos reales, y funciona.

### Barra de volumen y zoom

12 de octubre (D17), con la extensión compilada, en Chrome for Testing y Firefox sin ventana. Los
scripts y las capturas están en `.lab/zoom/` (no se suben).

- **Barra de volumen:** se mide hasta dónde responde al ratón (`elementFromPoint` a cada distancia de
  la línea, en el centro de la barra), al 100 y al 150 % de zoom.
  - **Antes** (84 × 4 px): ±4 px en Chrome y ±2 px en Firefox.
  - **Ahora** (100 × 24 px): de −12 a +10 px en los dos.
  - **En Chrome, con clics y arrastre de verdad (CDP):** a 8 y 10 px por encima y por debajo de la
    línea el volumen cambia; antes, no. Las flechas siguen funcionando, y los controles se ocultan
    con el ratón quieto.
  - **Capturas al 100 y al 150 % en los dos navegadores:** el mismo aspecto, 16 px más ancha.
- **Zoom:** en una ventana de 1904 × 980, la del Zen del usuario.
  - **Cómo:** en Chrome se simula con un viewport de ancho/z × alto/z y `deviceScaleFactor` z; en
    Firefox, con el zoom de verdad (`tabs.setZoom`), en un viewport de 1904 × 994.
  - **Inicio:** sin cuenta no tiene tarjetas, así que se le añaden las de 24 directos reales con el
    mismo marcado.

  Ancho de la imagen del vídeo con el chat abierto, en px de pantalla:

  | Zoom | 100 % | 110 % | 125 % | 150 % | 175 % | 190 % | 200 % | 250 % |
  | --- | --- | --- | --- | --- | --- | --- | --- | --- |
  | Antes (Chrome) | 1324 | 1266 | 1179 | 1033 | 889 | 802 | 1746* | 1707* |
  | Ahora (Chrome) | 1329 | 1329 | 1316 | 1214 | 1099 | 1029 | 871 | 871 |

  \* Más alto que la ventana: los controles quedan fuera.

  - **En Firefox, con sus pasos de zoom** (100, 109, 120, 133, 150, 171, 188, 200 y 240 %): 1329,
    1329, 1329, 1291, 1214, 1115, 1042, 884 y 884 px.
  - **Sin chat,** con la columna plegada o no: igual que antes hasta el 190 %; al 200 %, 1159 px en vez
    de 1746 más alto que la ventana.
  - **Otras ventanas** (Chrome, de 100 a 250 %): en 1904 × 980, 1680 × 990 y 1440 × 900, con y sin
    chat, con la columna plegada o no y en modo teatro con el chat, el vídeo no crece en ningún paso de
    zoom y siempre cabe en la ventana. Antes de la revisión de Codex crecía al bajar el chat en las
    ventanas 16:10.
  - **Controles:** antes se pisaban al 175 y al 190 % (Chrome) y al 120-133 % en una ventana de
    1366 × 682 (Firefox). Ahora no se pisan en ningún caso medido. Con todo visible miden unos 653 px
    CSS (con «1080p50 (source)» como calidad).
  - **Tarjetas de Inicio** (columna normal, del 100 al 200 %): antes 252, 298, 364, 463, 435, 641 y
    523 px; ahora 253, 304, 299, 364, 470, 455 y 523. En las tres ventanas, entre un zoom y el
    siguiente encogen como mucho un 3 %.
- **Pruebas:** `bun run verify`, y `test:interfaz` en Chrome, Firefox y Zen (25 pasos).
- **El usuario** lo probó en su navegador el 12 de octubre y lo dio por bueno.
- **La 0.2.0 publicada** (con la búsqueda centrada en la barra): el usuario la probó en su navegador el 12 de octubre
  y funciona.
- **Sin comprobar:** Ctrl + de verdad en Chrome (solo simulado).

### Icono y arranque

15 de octubre, en la VM de agentes del mini PC (Chrome for Testing 155, Firefox 158 y Zen 1.23, sin ventana).
- **Icono:** la pestaña muestra el SVG de `public/icono.svg` en Chrome, Firefox y Zen; antes no tenía ninguno. En
  Zen, una pestaña fijada lo conserva al reiniciar, antes de cargarse.
- **Marcadores en Firefox y Zen:** siguen sin icono, y la extensión no puede hacer nada. Places rechaza guardar el
  favicon de una página `moz-extension://` (`setFaviconForPage` da `NS_ERROR_ILLEGAL_VALUE`; con una página https lo
  acepta). Para tenerlo a mano con su icono: fijar la pestaña o usar el botón de la extensión.
- **Arranque**, con un arnés (`.lab/arranque-visual/arranque.mjs`, no se sube):
  - Chrome con la extensión y una sesión ficticia;
  - un `fetch` simulado que contesta a id.twitch.tv y a Helix con datos reales del momento, y con retrasos que suman
    ~1 s, como la red de verdad;
  - una línea de tiempo de lo que se ve, más capturas.

  | Momento | Antes | Ahora |
  | --- | --- | --- |
  | 50-90 ms | Bienvenida sin cuenta y «Vincula tu cuenta» | Inicio de la última vez (2.ª apertura); «Cargando…» la primera |
  | ~630 ms | Todos los seguidos fuera de directo y los recientes «Desconectado» | Igual |
  | ~1100 ms | Inicio con los datos | Inicio con los datos de ahora |

  Si Helix falla al refrescar, se sigue viendo lo guardado; antes, la columna decía «Ninguno de tus seguidos está en
  directo». Pasan los 25 pasos de la prueba de la interfaz en Chrome y en Firefox.

## Rendimiento del reproductor propio

12 de octubre (D16). Prueba de rendimiento ([desarrollo.md](desarrollo.md#prueba-de-rendimiento)) con la
interfaz de escritorio en Chrome for Testing 155. Corre dentro de un Weston sin pantalla que usa la GPU del
sobremesa (RX 9070 XT, decodificación por hardware), sin sonido. La versión anterior y la nueva se probaron
a la vez, en dos Weston, con los mismos 6 canales de más audiencia y en el mismo orden: 2 rondas, 12
arranques por versión y 35 s de reproducción en cada uno.

| Medida (mediana) | Antes | Ahora |
| --- | --- | --- |
| Primer fotograma desde que se abre el canal | 1355 ms (p90 1528) | 1124 ms (p90 1308) |
| Ídem, precalentado 0,5 s antes de abrirlo (el ratón parado ~0,65 s encima) | — | 520 ms (p90 829) |
| `info` (el empalme ya ha publicado) | 1016 ms | 865 ms |
| Latencia («ahora − PDT», ver abajo) | 3,5 s (p90 4,8) | 1,9 s (p90 2,6) |
| Búfer mínimo durante la reproducción | 1,0 s | 1,5 s |
| Fotogramas perdidos (sobre el total de los 12) | 5,0 % | 0,1 % |
| Paradas (en total) | 0 | 0 |
| Hilo de la página ocupado / CPU del navegador | 0,9 % / 11 % | 1,4 % / 12 % |

- **De dónde venían los fotogramas perdidos:** todos caían mientras el vídeo iba a 1,05× para recuperar
  el retraso con el que arrancaba (~4 por segundo durante ~30 s). A 1× se pierden 0.
- **Antes, la latencia dependía del arranque:** el reproductor tardaba ~30 s en recuperar el retraso con
  el que empezaba. La mediana de «antes» incluye ese tramo, como lo vería quien abre un canal.
- **El salto del arranque:** hacia el segundo 3 el vídeo salta ~1-2 s (un evento `waiting` de ~30 ms).
  Es lo que sustituye a la aceleración.
- **Margen de 2,5 fragmentos frente a 3:** en otra comparación, 12 sesiones de 90 s por versión, con
  latencia 1 s menor (de 0,5 a 1,7 s según el canal), búfer mínimo de 1-2 s y ninguna parada.
- **La latencia** es «ahora − PDT del fragmento en pantalla». Cada canal tiene su desfase (en
  `trymacs` sale negativa), así que no es el retraso real respecto al emisor: la mediana solo sirve
  para comparar las dos versiones, que se midieron con los mismos canales.
- **Arranque desde el VOD** (todas las sesiones con anuncio de entrada; 1 de 12 en cada versión): igual
  que antes, empieza con ~24 s de margen.

**Repetido con la versión final** (12 oct por la tarde): `3863a4f`, con los arreglos de la revisión,
frente a `7df4a65`, la de antes de D16. Misma prueba, con otros 6 canales:

| Medida | Antes | Ahora |
| --- | --- | --- |
| Primer fotograma (mediana) | 1,26 s | 0,86 s |
| Latencia (mediana) | 3,65 s | 2,41 s |
| Fotogramas perdidos (sobre el total) | 1,1 % | 0,06 % |
| Paradas | 0 | 0 |
| CPU del navegador | 11 % | 11 % |

- La latencia baja en los 12 arranques, y el primer fotograma en 11.
- Nueve arranques de la versión nueva tienen un evento `waiting`, el del salto del arranque, sin llegar
  a parar.
- Los datos están en `.lab/ab-12oct/`.

**La cuarta sesión** (`mobile_feed@android`):
- Vigía de 6 canales con `site`, `embed`, `popout` y `mobile_feed@android`, un sondeo cada 4 s y sin
  renovar sesiones (`investigacion/vigia.py`, con los tipos como `tipo@plataforma`). En 100 min (unos
  5000 sondeos por tipo), `mobile_feed@android` no tuvo ningún anuncio; `embed`, el 15,1 % de los
  sondeos, y `site` y `popout`, el 0,7 %.
- Hubo cuatro pausas globales en `trymacs`, de 44, 44, 16 y 44 s (`MIDROLL` en las tres sesiones web a
  la vez), y en todas `mobile_feed@android` siguió dando el directo: fragmentos nuevos y la hora
  avanzando.
- Da 1080p60 y los mismos fragmentos que `site` (comprobado en 2 canales). En el empalme abre, se sitúa
  en la numeración común y publica fragmentos.
- Con la versión de tres sesiones a la vez (12 arranques cada una): mismo arranque (875 frente a
  859 ms) y misma CPU, latencia 1,8 frente a 2,0 s, ninguna parada.
- Sin comprobar: cómo se comporta en muchas más pausas y canales, y si Twitch la cambia.

**La tele** (`herramientas/laboratorio/arranque.mjs`, Electron en el Weston del laboratorio, 4 canales ×
2 rondas a la vez): primer fotograma de 1640 a 1075 ms de mediana; con las conexiones ya abiertas,
700-940 ms. Las 7 pruebas e2e pasan en Weston sin pantalla (`E2E_WAYLAND`).

**La tele frente a la extensión** (12 oct, noche, antes de publicar la 0.2.0):
- **Las dos a la vez** (6 canales × 2 rondas, en dos Weston): primer fotograma de 1019 ms de mediana en la tele y de
  787 ms en la extensión.
- **Por fases, hasta conectar el reproductor van igual:** la espera de las sesiones (`info`) es de ~600 ms en las dos.
  La diferencia está en el primer fragmento, que las dos piden al CDN de Twitch. La tele tarda 330-390 ms y la
  extensión 115-215 ms (1,68 MB en 133 ms con Chrome 155).
- **Descartado:**
  - **El salto al servidor local:** la conexión cuesta 1 ms y la lista llega 1-2 ms después de `info`.
  - **El `fetch` de Node en el proceso principal:** con `net.fetch` de Electron no cambia.
  - **Un hilo principal ocupado:** no hay tareas largas (≥ 50 ms) en la página mientras se descarga.
- **Encontrado y corregido: IPv6 en la red del laboratorio.** Anuncia ruta IPv6 pero el equipo no tiene dirección
  pública, y cada conexión nueva de Electron perdía ~310 ms esperando a IPv6 antes de pasar a IPv4. Con Happy Eyeballs
  (`app.configureHostResolver({ enableHappyEyeballs: true })`) tarda 7-19 ms. El primer fotograma apenas cambia
  (~1010 ms), pero sí todas las demás conexiones nuevas: API, chat, emotes y miniaturas.
- **Lo que quedaba:** la tele (Electron 44, Chromium 152) descargaba el primer fragmento más despacio que Chrome 155,
  con el mismo código y la misma configuración. El 16 de octubre, en una red sin IPv6 no hubo diferencia: lo más
  probable es la red, no Electron ([El primer fragmento, más lento en la tele](#el-primer-fragmento-más-lento-en-la-tele-ren-4)).
- **Paridad de la interfaz:** la tele usa ya el mismo chat que baja al final al cambiar de altura o cargar un emote
  (`useChatAtBottom`) y muestra «x s por detrás» junto a «En directo» (`useBehind`), como la extensión.
- **Pruebas:** las 7 e2e de la tele pasan en Weston, y `test:interfaz`, en Chrome y Firefox.

**Modos de retraso** ([desarrollo.md](desarrollo.md#prueba-de-los-modos-de-retraso), sin ventana): pasan
los tres escenarios.
- Adaptativo, con la versión anterior a la vez: la primera pausa para 10 s frente a 12 s, y se
  pierden 21 fotogramas de 23 433 frente a 102. Repetido con la cuarta sesión: 12 s y 82 de 23 466.
  Con la parada medida cada 2 s, no hay diferencia clara: la parada la marca el VOD.
- Arranque desde el VOD, en Chrome y Firefox: sin paradas y vuelta con 0 s de salto.
- Sin paradas, en Chrome: ninguna parada, 0 fotogramas perdidos.

**Firefox 157**, en el Weston del laboratorio, con la versión anterior a la vez (5 canales; un sexto no
arrancó en ninguna de las dos):

| Medida (mediana) | Antes | Ahora |
| --- | --- | --- |
| `info` | 2000 ms | 866 ms |
| Primer fotograma decodificado / el vídeo avanza | 3026 / 4004 ms | 2004 / 2095 ms |
| Latencia | 3,1 s | 1,7 s |
| Fotogramas perdidos / paradas | 0 / 0 | 0 / 0 |

- En ese Weston, Firefox casi nunca avisa del primer fotograma presentado y da los tiempos a saltos de
  ~1 s, así que el primer fotograma se toma del primero decodificado. Un canal (`zackrawrr`) no avanza
  ahí con ninguna de las dos versiones; sin ventana, reproduce bien.
- La prueba de la interfaz pasa sus 25 pasos en Chrome y en Firefox.
- Prueba de humo: reproduce a 1080p con 3-4 s de retraso en la página de prueba, frente a 6 s antes.
- Pestaña oculta 6 min, sonando, en Chrome y Firefox: avanza 360 s de 360, sin esperas, y al volver
  sigue igual, como en el hito 1.
- Aparece un aviso `networkError/aborted`, no fatal: hls.js cancela una descarga de fragmento y la
  repite. No afecta a la reproducción.

**El chat**, con un chat sintético (`?chatsintetico=N`, `src/lab.ts`: una cuenta ficticia y N mensajes
por segundo con emotes e insignias de Twitch), en Chrome con la GPU, 3 canales:
- Con 40-100 mensajes por segundo, el hilo de la página pasa del ~1,4 % al ~8 % ocupado, sin
  fotogramas perdidos ni paradas. Casi todo es maquetación y pintado, no JavaScript.
- Pintar solo los mensajes nuevos baja el JavaScript del 1,5-1,9 % al 0,8-1,2 %.
- `contain: strict` en la lista baja la maquetación del ~2,3 % al ~0,5 % y el hilo de la página del
  ~7,6 % al ~5,3 %. El chat se ve igual (comparado con capturas).
- **Con el chat real** (`?chatreal`: el chat del canal leído por IRC anónimo, con sus emotes de Twitch,
  7TV, BTTV y FFZ, animados incluidos, por el mismo tokenizador y catálogo que la app), en 3 canales con
  mucho chat y 60 s, las dos variantes a la vez con los mismos mensajes: el hilo de la página baja del
  3,7-4,4 % al 2,6-3,2 % y la maquetación del 0,5-0,9 % al 0,1-0,2 %, sin fotogramas perdidos de más.
  En `plaqueboymax` las dos variantes se pararon a la vez 27 s: algo de la emisión o de sus sesiones,
  no del chat. Desde entonces la prueba guarda qué pasó en el empalme de cada canal desde que se abrió
  (anuncios por sesión, rellenos, huecos).
- En la tele la lista lleva la misma contención; ahí no se ha medido: la tele no tiene chat de
  laboratorio.

**Sin comprobar:**
- el mini PC, la TV y tu pantalla;
- Zen con tu perfil;
- el chat de verdad con una cuenta, con emotes animados de 7TV;
- el precalentado con el ratón real (la prueba lo pide directamente).

### «Sin paradas»: saltos al crecer el retraso

15 de octubre. El usuario vio saltos constantes en *Sin paradas*, sobre todo en `elxokas`, que no emitía durante las
pruebas. Medido en la VM de agentes, sin ventana y con decodificación por software, con
`herramientas/laboratorio/vigilar.mjs`. Muestrea cada segundo la posición, el retraso, el búfer y la ventana de la
lista, y apunta cada `seeking`, cada error de hls.js y los eventos del empalme.
- **En condiciones normales no salta:** 20 min en Firefox (`carola`) y 20 min en Chrome (`alexelcapo`) sin un salto, una
  parada ni un error; son también las primeras sesiones largas con la carga progresiva. La posición queda a 14-17 s
  del principio de la lista publicada, que eran 20 fragmentos (40 s).
- **El margen era corto.** *Sin paradas* conserva el retraso que se añade, pero la lista solo abarcaba 16 s más que el
  objetivo:
  - tras una pausa de la persona de 35 s, el retraso quedó en 60 s y la posición 20 s por detrás del principio de la
    lista, viviendo solo del búfer;
  - tras cada relleno con el VOD (cuatro pausas globales simuladas de 75 s, `?pausa=150,75`), el retraso subió de 25 a
    30 s; al salir de la lista los trozos del VOD (~10 s), su principio avanzaba de golpe y dejaba ~12 s de margen;
  - fuera de la lista, hls.js recoloca la posición (`synchronizeToLiveEdge`, y `getNextFragment` cuando lo siguiente
    ya no está en ella).
- **Comparación a la vez** (Chrome, `caedrel`, pausa de la persona de 50 s):
  - **la versión anterior** quedó 35 s por detrás del principio de la lista y saltó 38 s hacia delante, que se
    perdieron. Después se quedó pegada al principio de la lista (a 0-2 s), con un objetivo de 77 s que la lista no
    abarcaba: cualquier parada desde ahí la vuelve a recolocar;
  - **la nueva** siguió desde donde se pausó, sin saltos, con la posición a ~24 s del principio de la lista.
- **El arreglo:** la lista abarca 100 s, más que lo que hls.js deja quedarse atrás (84 s), y el retraso conservado se
  queda 10 s por debajo de ese tope ([arquitectura.md](arquitectura.md#reproducción)). Los fragmentos en directo de
  Twitch se pueden descargar hasta unos 4,5 min: a los 268 s, sí; a los 328 s, ya no.
- **Pruebas:** pasan los 7 e2e de la tele, la prueba de la interfaz y la de los modos (`carola`, Chrome y Firefox):
  - *Sin paradas*, `150,45`: ninguna parada, dos rellenos y vuelta con 0 s de salto;
  - *Adaptativo*: una parada de 12-14 s en la primera pausa, como antes, ninguna después y vuelta con 0 s de salto.
- **Sin comprobar:** el canal del usuario (`elxokas`); en él es probable que se sumen pausas de anuncios con un VOD más
  lento y paradas de red. Que esta fuera la causa de lo que vio el usuario es una hipótesis; queda pendiente probarlo
  en ese canal.

### fMP4: saltos con la carga progresiva

15 de octubre por la tarde. El usuario, en Zen y *Sin paradas*, vio saltos sin parar en `illojuan`, y el retraso en
«0 s por detrás»; en otros canales, no. Medido en la VM de agentes con `vigilar.mjs` (datos en `.lab/illojuan/`).
- **La diferencia es el formato.** `illojuan` emite en fMP4 (`EXT-X-MAP`, calidades sin «(source)»: *Enhanced
  Broadcasting*); los canales de las pruebas anteriores (`carola`, `alexelcapo`, `caedrel`), en MPEG-TS. De los 24 con
  más espectadores en ese momento, 7 iban en fMP4. El VOD va en el mismo formato que el directo. Cada fragmento de
  `illojuan` es normal: 2 s, 120 fotogramas a 60 fps, en 19 trozos CMAF (`moof` + `mdat`) con un `emsg` delante.
- **El empalme no tenía la culpa:** ejecutado aparte, publica fragmentos continuos (tiempo de vídeo y PDT, +2 s cada
  uno). El anuncio de entrada solo lo tuvo `embed`, y no influye.
- **hls.js sí.** Con `progressive: true`, cada trozo que llega se compara con el principio del fragmento entero; a partir
  de 1 s de diferencia, `isInvalidInitPts` (`passthrough-remuxer.ts`) da el reloj por malo, lo recalcula y coloca ese
  trozo en el principio del fragmento, encima de lo anterior. Cada fragmento de 2 s ocupaba ~1,1 s en la lista de
  hls.js (50 fragmentos en ~55 s). Lo confirmó la revisión de Codex reproduciéndolo con las clases de hls.js y
  fragmentos reales: 2 s el primero y 1,18 / 1,07 / 1,08 s los siguientes; con `progressive: false`, 2,000 s todos. Con
  MPEG-TS no pasa: va por otro remuxer.
- **Antes, en Zen,** 20 min: el retraso real cayó de 27 a ~2 s en 40 s y no se recuperó; el vídeo estuvo parado 538 s
  (el 45 %), con el búfer a ~0 y hasta 14 rangos en `buffered`. En Chrome, igual los 4 min que duró.
- **Sin carga progresiva** (la misma versión, solo con `progressive: false`), en Zen, 5 min: ningún salto ni parada, el
  retraso real fijo en 22,2 s y ~21 s de búfer.
- **El arreglo:** sin carga progresiva cuando la primera lista trae `EXT-X-MAP`
  ([arquitectura.md](arquitectura.md#reproducción)); MPEG-TS la conserva. El precio en fMP4: el último fragmento
  (PREFETCH) entra en el búfer al completarse, como antes de la carga progresiva.
- **Con el arreglo,** en *Sin paradas*, sin un salto, una parada ni un error de hls.js:

  | Canal (formato) | Navegador | Duración | Antes | Ahora |
  | --- | --- | --- | --- | --- |
  | `illojuan` (fMP4) | Zen | 10 min | 538 s parado en 20 min; retraso real ~2 s | retraso real fijo en 20,9 s; búfer 19-20 s |
  | `buster` (fMP4) | Chrome | 2,5 min | 43 saltos, 55 s parado; retraso real ~4 s | fijo en 22,8 s; búfer ~19,5 s |
  | `carola` (TS) | Chrome | 2,5 min | — | fijo en 20,5 s; búfer ~20,8 s |

  Pasan `bun run verify` (con una prueba nueva en `reproductor-propio.test.ts`), los 25 pasos de la prueba de la
  interfaz en Chrome y Firefox (`illojuan,carola`) y los 7 e2e de la tele.
- **Rendimiento, en *Adaptativo*** (margen de 5 s, donde más pesa la carga progresiva), las dos versiones a la vez en
  Chrome sin ventana, 2 rondas de 45 s por canal:
  - **fMP4** (`illojuan`, `buster`): antes, ~21 s parado de cada 45 s y ~1000 fotogramas pintados; ahora, 2-3 s
    parado en la primera ronda, ninguno en la segunda, y ~2600 fotogramas. El búfer mínimo, 0,1-0,8 s;
  - **TS** (`carola`): igual en las dos;
  - **arranque:** igual (primer fotograma, mediana de 889 frente a 897 ms).
- **El usuario** lo probó en Zen, con su perfil, el 16 de octubre: `illojuan` va perfecto. Sale en la 0.2.1, que
  también probó en la tele, en el mini PC y con el mando: todo bien.
- **Sin comprobar:** si las paradas de 2-3 s en *Adaptativo* con fMP4 son el precio de cargar fragmento a fragmento o
  ruido de las dos pruebas a la vez.
- **Límite:** se decide al crear el reproductor. Si una emisión nueva cambia de formato con él abierto, sigue con lo
  decidido hasta que se vuelva a abrir el canal.

## Inicio al abrir en la tele

16 de octubre. El usuario, en la tele con la 0.2.1: al abrir, menos de medio segundo de una pantalla que no llegaba a
distinguir, luego «Cargando canales…» y luego la lista, en total ~1 s. Por el código, la primera era la bienvenida sin
cuenta: Inicio se pedía sin cuenta mientras se comprobaba la sesión (dos peticiones a Twitch), como en la extensión
antes del 15 de octubre ([Icono y arranque](#icono-y-arranque)).
- **El arreglo:** el de la extensión, ahora común
  (`useHome`, [arquitectura.md](arquitectura.md#las-tres-piezas-de-electron)): lo de la última vez con esa cuenta
  mientras llega lo de ahora, y ni bienvenida ni «Cargando canales…» mientras no se sabe si hay cuenta. La tele lo
  guarda en `saved-home.json`, por IPC, y el foco del mando entra cuando Inicio ya tiene algo.
- **Medido en la app real** (Electron sin ventana, perfil temporal, `.lab/inicio-tele/probar.mjs`), con la cuenta y
  los seguidos simulados en el proceso principal, 0,5 s por petición:
  - a los 25 ms, la lista guardada y el nombre de la cuenta; a los 39 ms, el foco en su primer canal;
  - a 1 s, la lista de ahora en su sitio. El canal enfocado seguía en ella, con otro título: conserva el foco, y la
    vista previa pasa al título de ahora;
  - en ningún momento la bienvenida ni «Cargando canales…»;
  - sin cuenta: la bienvenida a los 20 ms y el foco en «Vincular cuenta» a los 32 ms. Lo guardado (de otra cuenta) no
    llega a verse y se borra.
- **Revisión de Codex** (`gpt-6.1-sol`), con dos arreglos:
  - la vista previa guardaba el canal enfocado entero, así que tras un refresco seguía con su título y sus espectadores
    de antes hasta mover el foco. Ahora guarda solo cuál es y lo busca en las listas de ahora;
  - la tele no guarda un Inicio de más de 1 MB (unos 100 kB con 100 seguidos en directo), para que un renderer
    comprometido no deje un archivo enorme que se lea en cada arranque.

  Lo que no se cambió: el foco puede quedarse en las pestañas si la cuenta resulta ser otra en los 16 ms entre que sale
  lo guardado y el primer fotograma (la cuenta necesita al menos una petición de red), o si lo guardado no tiene ni un
  canal, tampoco en populares.
- **Pruebas:** `bun run verify`, con pruebas nuevas del hook (React, `inicio.test.ts`), del archivo de la tele y del
  IPC; los 7 e2e de la tele y los 25 pasos de la interfaz en Chrome y Firefox.
- **En la tele de verdad** (16 oct, 0.2.2, con la cuenta del usuario y el mando): la primera vez tras actualizar,
  «Cargando canales…» (aún no había nada guardado) y luego la lista; desde la segunda, la lista nada más abrir.

## Cuenta sin red al abrir (EXT-4)

16 de octubre. Si comprobar la cuenta fallaba por la red al abrir, Inicio salía como sin cuenta, en la tele y en la
extensión: la bienvenida y «Vincula tu cuenta», aunque la sesión siguiera guardada. Ajustes ofrecía vincularla otra
vez. Pasaba desde antes de guardar Inicio; lo encontró la revisión de Codex del 15 de octubre.
- **La causa:** `useAuth` convertía cualquier fallo de `auth.snapshot()` en `error`, y `error` es también lo que
  devuelve `TwitchAuth` cuando la sesión ha caducado, después de cerrarla.
- **El arreglo** ([arquitectura.md](arquitectura.md#la-extensión-appsnavegador)):
  - `useAuth` separa «no contesta» (`snapshot()` lanza: `unreachable`) de «contesta con error». No hace falta tocar el
    contrato: `TwitchSession` ya relanza los fallos de red y de Twitch caído, y solo da `ConfigurationError` (que
    acaba en `error`) con una respuesta que deja la sesión sin valor.
  - Con `unreachable` no se sabe la cuenta: Inicio sigue con lo de la última vez, sin pedir nada a Twitch ni borrar
    nada, y avisa con «Reintentar». Lo guardado es de la última cuenta: se olvida al cerrar sesión y se sustituye al
    entrar con otra.
  - Ajustes dice que la sesión no se ha cerrado y ofrece «Reintentar» y «Cerrar sesión». En la tele, el foco entra en
    «Reintentar», nunca en «Cerrar sesión». Sin red, cerrar sesión la borra aquí, pero no la revoca en Twitch.
  - Se vuelve a comprobar sola con el evento `online` y cada 30 s. Vale la última comprobación: una anterior que falla
    tarde no deshace una que acertó.
  - Con `error` (sesión caducada), lo guardado ahora se olvida, como sin cuenta.
  - En la tele, el foco entra en el primer canal guardado, con «Reintentar» justo encima (↑). Sin nada guardado, en
    «Reintentar».
- **Por el camino real**, con una sesión ficticia guardada (un token que Twitch rechaza) y scripts en `.lab/ext-4/`
  (no se suben):
  - **Extensión** (Chrome for Testing, red cortada con CDP): lo guardado con el aviso, sin la bienvenida. Al volver la
    red, el evento `online` comprobó la cuenta solo, en 0,5 s. Twitch rechazó el token: salió la bienvenida, y se
    borraron lo guardado y la sesión.
  - **Tele** (la app real, con el `fetch` del proceso principal cortado para twitch.tv): el error cruza el IPC. Salió
    lo guardado con el aviso y el foco en su primer canal, y la sesión siguió guardada. Con red, «Reintentar»: la
    bienvenida con el foco en «Vincular cuenta», y lo guardado y la sesión borrados.
  - **«Cerrar sesión» con la red cortada**, en las dos: se borran la sesión y lo guardado, y sale la bienvenida.
  - El aviso da el motivo: «Request failed due to a network error: GET https://id.twitch.tv/oauth2/validate». No lleva
    el token: va en una cabecera.
- **Pruebas:**
  - `bun run verify`: 303 pruebas, más 4 fallos esperados. En `inicio.test.ts` hay 11 nuevas: Inicio sin poder
    comprobar la cuenta, con y sin nada guardado, al volver la red, con la sesión caducada y después de cerrar sesión;
    y en `useAuth`, el fallo que pasa a `unreachable`, «Reintentar», el reintento con `online` y cada 30 s, y que vale
    la última comprobación.
  - Las e2e de la tele: 3 nuevas en `recovery.spec.ts`, que sustituyen los manejadores IPC de la cuenta; una cierra
    sesión con el mando. Las 10 pasan con Xvfb y xdotool.
  - `test:interfaz`: 7 pasos nuevos con `?sinred` (`lab.ts`), también cerrar sesión. Pasan los 32 en Chrome y en
    Firefox.
- **Revisión de Codex** (`gpt-6.1-sol`), con un arreglo: al cerrar sesión, lo guardado se borraba del disco pero
  seguía en memoria. Si después no se podía comprobar la cuenta (un fallo de red al vincular otra), volvían los canales
  y el nombre de la cuenta cerrada. Ahora la copia en memoria sigue a la del disco. Lo que no se cambió:
  - sin nada guardado, si se pulsa una tecla en el segundo que tarda la lista tras «Reintentar», el foco se queda en la
    pestaña «Siguiendo», a la vista; ↓ entra en la lista. Pasa igual con el «Reintentar» de la lista de Twitch;
  - un `error` con la sesión aún guardada, o una excepción con la sesión ya borrada: necesitan empezar a vincular con
    la sesión abierta (la interfaz no lo permite) o que falle leer el Client ID. Se corrigen en la siguiente
    comprobación.
- **Sin comprobar:** en la tele de verdad y con una cuenta real, y el evento `online` en la tele, cuando vuelve la red
  del mini PC. En la tele solo se ha probado «Reintentar»; los 30 s, solo en las pruebas del hook.

## Rendimiento en el mini PC (HW-2)

16 de octubre, con la 0.2.2 (Electron 44.2.0) en la TV ([En el mini PC](#en-el-mini-pc-la-tv-y-el-mando)). El usuario
vio unos 8 minutos de directos con el mando y cambió de canal varias veces. Tenía su configuración: *Sin paradas*, con
el chat a la vista.
- **Cómo se midió,** desde otro equipo y sin tocar la interfaz (scripts en `.lab/hw-tele/`, no se suben):
  - la app, abierta con `--remote-debugging-port` (solo en `127.0.0.1`), se leyó por CDP a través de un túnel SSH:
    - los hitos de cada apertura, desde que aparece el reproductor (lo mismo que `arranque.mjs`);
    - cada segundo, `getVideoPlaybackQuality()`;
    - el decodificador, por el dominio `Media`;
    - los tiempos de red de la página (Resource Timing);
  - la CPU de los procesos de la app, de `/proc`;
  - la carga de cada motor de la GPU, de los contadores `drm-engine-*` de `fdinfo` de amdgpu, cada 2 s. En esta GPU
    (VCN 4) la decodificación cuenta como `enc`.

| Medida | Resultado |
| --- | --- |
| Decodificador | `VaapiVideoDecoder` (por hardware) en los 14 reproductores, H.264 High 1080p60. Chromium da `video_decode: enabled`, aunque `SystemInfo` no lista perfiles |
| Primer fotograma | 990 ms de mediana (868-1105, 8 aperturas); avanza a los ~1,2 s. Dos aperturas más tardaron 6,4 y 6,9 s (abajo) |
| Primer fragmento del CDN | 380 ms de mediana (307-531, 10 aperturas); probablemente, la espera de IPv6 de [REN-4](#el-primer-fragmento-más-lento-en-la-tele-ren-4) |
| Fotogramas perdidos | 1,5 % (321 de 21 842, sin los 5 primeros segundos de cada canal), a rachas (abajo) |
| CPU, suma de los procesos | 29 % de un núcleo de media (p95 39 %): renderer 12 %, GPU 10 %, principal 4 %, red 3 %. Unos 2,4 % de los 12 hilos |
| GPU | Motor de vídeo (VCN) al 8 %, gráficos al 7 % |

Dos cosas que no se explican todavía:
- **Fotogramas perdidos a rachas.** En `ohnePixel` se perdieron 258 en 140 s (3,1 %). En el último minuto hubo rachas
  de 11 a 15 fotogramas cada ~4,5 s. En otra visita al mismo canal no se perdió ninguno en 92 s; en `TenZ`, 49 en
  125 s (0,7 %). Las muestras de CPU y GPU, cada 2 s, no tienen picos que coincidan, aunque uno breve no se vería. El
  usuario no notó tirones. No es comparable con el 0,06 % del laboratorio: era la extensión, con otra GPU, a 1080p y
  sin el chat.
- **Dos arranques de ~6 s, al cambiar de canal con ↑/↓.** En `Jynxzi` y `summit1g`, el empalme tardó 5,8 s en
  publicar su primer fragmento (`info`): no fue la red de la página ni el decodificador. El usuario notó que con las
  flechas a veces tardaba más que desde la lista. Unos 20 minutos después, en el laboratorio y desde la lista, los mismos
  canales tardaron 0,6-0,75 s en `info` (0,8-1 s al primer fotograma): no es algo fijo del canal, aunque pudo ser
  algo de ese momento. Una explicación posible es un anuncio de entrada en todas las sesiones de invitado, que hace
  arrancar desde el VOD: con uno simulado (`GOODTTV_PAUSA_SIMULADA=0,20,1`), `info` tarda 2-3,3 s en el laboratorio,
  no 5,8. No está demostrado: falta el registro del empalme en la tele.

## El primer fragmento, más lento en la tele (REN-4)

16 de octubre. Con el mismo código, la tele descargaba el primer fragmento ~200 ms más despacio que la extensión
([La tele frente a la extensión](#rendimiento-del-reproductor-propio)). Lo más probable es que no sea Electron, sino la
red: en una red sin IPv6 no hay diferencia, y en la de casa cada conexión nueva al CDN prueba antes IPv6, que no sale.
Falta comprobarlo en la app, antes y después de arreglar la red.
- **En una red sin IPv6 no hay diferencia.** Las tres versiones, a la vez, en tres Weston sin pantalla de una VM sin
  ruta IPv6, con 6 canales × 2 rondas, en modo adaptativo:

  | Versión | Descarga del primer fragmento | Primer fotograma |
  | --- | --- | --- |
  | Tele, Electron 44.2.0 | 76 ms (37-481) | 842 ms |
  | Tele, Electron 44.8.0 | 70 ms (38-577) | 912 ms |
  | Extensión, Chrome for Testing 155 | 85 ms (48-427) | 832 ms |

  Medianas. La espera de las sesiones (`info`) es de ~594 ms en las tres. El vídeo se decodifica por software en la
  VM, así que el primer fotograma es aproximado. La tele mide la descarga con Resource Timing
  (`.lab/ren4/arranque-red.mjs`, copia de `arranque.mjs`) y la extensión, entre los eventos de hls.js.
- **En la red de casa, IPv6 a medias.** El router anuncia una ruta IPv6 por defecto, pero no da direcciones. El mini PC
  solo tiene la dirección de Tailscale (una ULA, de ámbito global para Linux), así que cree tener IPv6. Los
  fragmentos vienen de CloudFront, que tiene IPv6: cada conexión nueva prueba IPv6 y, como no sale, solo conecta
  cuando lanza el intento por IPv4. Desde el mini PC, con `curl` al host de los fragmentos (3 veces cada uno):

  | `curl` desde el mini PC | Tiempo de conexión |
  | --- | --- |
  | Por defecto (IPv6 primero) | 205 ms |
  | Solo IPv4 | 4-5 ms |

  `curl` lanza el intento por IPv4 a los 200 ms; Chromium, a los 300 ms, salvo que la tele lo cambie: activa *Happy
  Eyeballs* (`configureHostResolver`), y no se ha medido cuánto espera con él. El host de los fragmentos cambia con
  cada emisión, así que cada canal abre una conexión nueva: en la tele, el primer fragmento tardó 307-531 ms, frente
  a 37-577 ms (mediana 70) en la VM.
- **El sobremesa** está en la misma red y ya mostró esa espera de ~300 ms con IPv6
  ([La tele frente a la extensión](#rendimiento-del-reproductor-propio)). Es lo más probable que la diferencia que
  quedaba allí sea esta misma, pero no se ha medido.
- **El arreglo sería de la red,** no de GoodTTV: que el mini PC no acepte la ruta IPv6 por defecto que anuncia el
  router, o que el router no la anuncie. No está hecho, y con él se comprobaría la causa: el primer fragmento en la app
  antes y después, con conexiones nuevas.

## Electron 44.8.0 (MAN-1)

16 de octubre. La tele pasa de Electron 44.2.0 a 44.8.0, el último de la 44, con los parches de seguridad de Chromium
152 (152.0.7977.167) y Node 24.22. Electron 45 (Chromium 156) aún está en beta.
- **Pruebas:**
  - `bun run verify`: 303 pruebas, más 4 fallos esperados;
  - las 10 e2e de la tele, dos veces en un Weston sin pantalla (`E2E_WAYLAND`);
  - en la comparación de [REN-4](#el-primer-fragmento-más-lento-en-la-tele-ren-4), el arranque igual que con la 44.2.0;
  - el AppImage arranca y reproduce un minuto en un Weston sin pantalla, se cierra sin errores y conserva los *fuses*
    de `after-pack.cjs`. Si se matan a la vez todos sus procesos (también el de la GPU), acaba con «GPU process isn't
    usable»: es por cómo se cierra, no por la versión.
- **Con Xvfb y xdotool,** antes de las e2e nuevas de EXT-4, el recorrido crítico falló 2 de 7 veces con la 44.8.0: una
  vez Escape no cerró el reproductor, otra se pasó un plazo de 10 s. Con la 44.2.0 pasó las 7. Alternando las dos
  versiones, pasaron las 8 ejecuciones. No se sabe la causa: puede ser intermitente, pero no está descartado que sea
  de Electron. Weston no lo descarta, porque allí las teclas se inyectan con `sendInputEvent`, sin pasar por la
  entrada del sistema. Lo que cuenta es el mando en la tele, que llega por Wayland.
- **Revisión de Codex** (`gpt-6.1-sol`) de la 0.2.3, antes de publicar:
  - corrigió dos cifras: el primer fragmento, que se agrupaba mal por apertura, y los porcentajes de fotogramas
    perdidos;
  - rebajó REN-4 y REP-7 de causa a hipótesis;
  - aclaró que lo probado en el mini PC es la 0.2.2.
