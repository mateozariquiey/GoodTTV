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

El mini PC dejó de hacer de tele hacia el 19 de octubre, así que esto es lo comprobado mientras lo fue; desde la 0.3.0,
la app de la tele solo se comprueba con las pruebas automáticas.

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
  - la pantalla completa real (la rueda para el volumen se quitó el 22 de octubre: la rueda desplaza la página).

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
  con el mismo código y la misma configuración. El 16 de octubre resultó ser la red, no Electron
  ([El primer fragmento, más lento en la tele](#el-primer-fragmento-más-lento-en-la-tele-ren-4)).
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

### fMP4: paradas con el margen de 2,5 fragmentos

21 de octubre. En la comparación de la fase 1, `illojuan` (fMP4) bajó el búfer a 0,08 s en las dos versiones. Sin carga
progresiva (fMP4 la desactiva, arriba), el último fragmento de Twitch solo cuenta al llegar entero, como antes de D16, y
2,5 fragmentos de margen se quedaban cortos. Medido en `mini-agentes`, en la sesión GNOME con la GPU, con el margen
de fMP4 configurable en una compilación aparte (`.lab/roadmap/rend-margen.mjs`):

| Margen con fMP4 | Visitas | Paradas | Esperas | Búfer mínimo (mediana) | Perdidos | Latencia (mediana) |
| --- | --- | --- | --- | --- | --- | --- |
| 2,5 fragmentos (antes) | 10 | 16 s, en 4 | 33 | 0,42 s | 1,92 % | 2,79 s |
| 3 fragmentos | 10 | 0 | 5 | 0,76 s | 0,17 % | 3,35 s |

- **Canales:** los 5 en fMP4 de los 29 con más espectadores (`illojuan`, `otplol_`, `emiru`, `lirik` y
  `bratishkinoff`), 2 rondas de 60 s alternando márgenes. Antes, `illojuan` solo, 2 rondas de 90 s con 2,5, 3, 3,5 y 4:
  ninguna parada desde 3, y con 3,5 y 4 la latencia subía 1,3-2 s sin más ganancia.
- **Ahora** el reproductor usa 3 fragmentos con fMP4 (`FMP4_SYNC_SEGMENTS`, en `useHlsPlayer`), en la extensión y en la
  tele; con MPEG-TS sigue en 2,5. *Sin paradas* (24 s) y el arranque desde el VOD (16 s) ya tenían más.
- **Confirmado** con la compilación final frente a la anterior, en `lirik`, `bratishkinoff` y `emiru` alternando:
  la anterior, 7 s de paradas en 2 de 6 visitas, 19 esperas y un 1,03 % de fotogramas perdidos; la nueva, 2 s en 1
  de 6 (`emiru`, con el búfer en 0,06 s), 4 esperas y un 0,72 % (casi todo de esa parada). La latencia pasa de 2,76 a
  3,33 s y el primer fotograma, de 758 a 759 ms (medianas). En total, con 3 fragmentos, 1 parada en 18 visitas; con
  2,5, 7 en 18. Si se quieren cero, 3,5 dio ninguna en 2 visitas, con ~1 s más de retraso: queda para medir más.

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

## Inicio al abrir, sin esperas en cadena

23 de octubre (D26). Al abrir, Inicio enseñaba un instante lo guardado de la última vez, aunque fuera de hace horas, y
lo de ahora esperaba a cuatro peticiones a Twitch, una detrás de otra: validar la sesión, la foto de la cuenta, los
directos y las fotos de sus canales. Cada una tarda ~170 ms desde `mini-agentes`, aun reutilizando la conexión, y la
página pinta a los ~0,05 s, así que el tiempo se iba en la cadena.

Medido en la extensión con una cuenta y un Helix falsos que contesta la propia página, 170 ms por petición
(`?twitchfalso`, `twitch-falso.ts`; `herramientas/laboratorio/inicio.mjs`), Chrome for Testing sin ventana, las dos
versiones a la vez, 5 cargas por escenario (mediana; entre la más rápida y la más lenta, menos de 25 ms):

| Al abrir | Antes: lo de ahora | Antes: se veía | Ahora: lo de ahora | Ahora: se ve |
| --- | --- | --- | --- | --- |
| Lo guardado tiene 3 h | 730 ms | lo guardado, a los 34 ms | 218 ms | la forma de las listas, vacía, a los 35 ms |
| Lo guardado tiene 5 h y el token ha caducado | 1074 ms | lo guardado | 384 ms | la forma vacía |
| Otra pestaña (lo guardado tiene 1 min) | 733 ms | lo guardado | 224 ms | lo guardado |
| La primera vez tras actualizar (sin la cuenta ni las fotos guardadas) | 727 ms | «Cargando…» | 726 ms | «Cargando…» |

- **La cadena de antes:** validar (170 ms), la foto de la cuenta (170), los directos (170) y sus fotos (170). Con el
  token caducado, además, validar daba 401, renovar y validar otra vez.
- **Ahora:** los directos, la foto de la cuenta y la validación salen a la vez, al abrir; las fotos de los canales ya
  están guardadas. Con el token caducado, se renueva sin probarlo, y después todo a la vez.
- **La forma vacía ocupa lo mismo que lo de ahora** (capturas a 1600 × 900 con 3 s por petición): las miniaturas, las
  filas de la columna y la línea de estado de «Seguir viendo» no se mueven al llegar lo de ahora.
- **La primera vez** (tras actualizar, o tras vincular la cuenta) sigue igual: hasta la primera validación no se sabe
  la cuenta, y las fotos de los canales aún no están guardadas.
- **Límites:** la latencia es simulada y fija. Con la red real, cada petición varía, y lo de ahora llega cuando llega
  la más lenta de las que salen a la vez. No se ha medido con la cuenta del usuario ni en Android: en el S25, el código
  es el mismo (la página y sus servicios), pero las peticiones a Helix pasan por la red nativa.
- **Pruebas:** de la sesión (credenciales sin esperar a validar, una sola validación, la cuenta guardada al validar y
  conservada al renovar, el token caducado, la sesión que Twitch ya no acepta), del servicio (la foto de la cuenta a la
  vez, las fotos de los canales y EXT-7 con la secuencia real: validar 200, la foto 401 y renovar 400), de las fotos
  guardadas (`profile-pictures.test.ts`) y de `useHome` (`inicio.test.ts`: lo reciente, la forma, la carga temprana que
  sigue al llegar la cuenta y un fallo antes de saberla).
- **Revisión de Codex** (`gpt-6.1-sol`, razonamiento alto), con seis arreglos, cada uno con su prueba:
  - **la carga de al abrir seguía aunque la cuenta resultara ser otra** (otra pestaña vincula otra mientras tanto), y
    lo de la primera se guardaba como de la segunda. Ahora se vuelve a pedir si cambia la cuenta;
  - **una renovación de la validación de al lado podía hacer fallar Inicio** (`SessionChangedError`) aunque la sesión
    siguiera bien: las credenciales se vuelven a leer una vez;
  - **las fotos guardadas en memoria (la tele) se quedaban solo con las del último lote;**
  - **las fotos podían volver a guardarse tras cerrar sesión** (una respuesta en camino), y no se olvidaban si la sesión
    caducaba o la cerraba otra página;
  - **la lista y los datos del VOD en curso se renovaban cada 4 min con una caché de 5:** la llamada del minuto 4 no
    renovaba nada, y entre el 5 y el 8 retroceder volvía a esperarlos. Ahora se piden otra vez sin esperar a que caduquen;
  - **ya antes de este cambio, una petición podía llevar el id de una cuenta y el token de otra** (`streams/followed`,
    `channels/followed` y el chat), si la cuenta cambiaba entre las dos lecturas de credenciales o al renovar. Ahora se
    arma con la cuenta de las credenciales con que sale.

  Se sostuvo, según la revisión: guardar la cuenta con el token en la tele, sin bloqueo, no pisa una renovación; y esperar
  a las fotos que faltan. Queda, sin arreglar: entre pestañas, guardar las fotos no es atómico (puede perderse alguna,
  que se vuelve a pedir), y si la validación de al lado cierra la sesión antes de que la cuenta pregunte, sale «sin
  cuenta» en vez de «caducada» (en la app la cuenta pregunta la primera).

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
| Primer fragmento del CDN | 380 ms de mediana (307-531, 10 aperturas): la espera de IPv6 de [REN-4](#el-primer-fragmento-más-lento-en-la-tele-ren-4), ya corregida |
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
([La tele frente a la extensión](#rendimiento-del-reproductor-propio)). No era Electron, sino la red: en una red sin IPv6
no hay diferencia, y en la de casa cada conexión nueva al CDN probaba antes IPv6, que no sale. Comprobado en la app,
con y sin la ruta IPv6, y corregido en el mini PC (abajo).
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
- **Con y sin la ruta, en el mini PC.** Se alternaron cuatro rondas, con la ruta y sin ella, quitándola solo en tiempo de
  ejecución (`nmcli device modify … ipv6.never-default`). En cada ronda, 6 canales, cada uno en una GoodTTV 0.2.3 nueva
  y sin pantalla (`--ozone-platform=headless`, perfil temporal), para que cada apertura usara conexiones nuevas
  (`.lab/ren4/exp/`):

  | Medianas, 12 aperturas por columna | Con la ruta IPv6 | Sin ella |
  | --- | --- | --- |
  | Espera de las sesiones (`info`) | 646 ms | 650 ms |
  | Primer fragmento | 335 ms (305-631) | 86 ms (54-448) |
  | El vídeo avanza | 1401 ms | 1139 ms |

  Cada canal arranca ~0,26 s antes. `info` no cambia: lo pide el proceso principal, con el `fetch` de Node, y casi
  todo va a servidores sin IPv6. Con `curl`, que usa también Kodi, cada conexión nueva a un servidor con IPv6 (YouTube,
  Crunchyroll, TMDB, Flathub, el espejo de Kodi, BTTV, FFZ…) tardaba ~200 ms más con la ruta, y sin ella, lo mismo que
  por IPv4.
- **El arreglo es de la red,** no de GoodTTV: el mini PC ya no acepta la ruta IPv6 por defecto
  (`ipv6.never-default` en NetworkManager); sigue con el IPv6 local y el de Tailscale. En otra red con IPv6 a medias
  pasaría lo mismo: está entre los límites conocidos de la 0.2.3.

## Electron 44.8.0 (MAN-1)

16 de octubre. La tele pasa de Electron 44.2.0 a 44.8.0, el último de la 44, con los parches de seguridad de Chromium
152 (152.0.7977.167) y Node 24.22. Electron 45 (Chromium 156) aún está en beta. Sale en la 0.2.3, instalada en la
TV el mismo día: el usuario la probó con el mando (abrir, reproducir, cambiar de canal con ↑/↓, volver y salir).
- **Pruebas:**
  - `bun run verify`: 303 pruebas, más 4 fallos esperados;
  - las 10 e2e de la tele, dos veces en un Weston sin pantalla (`E2E_WAYLAND`);
  - en la comparación de [REN-4](#el-primer-fragmento-más-lento-en-la-tele-ren-4), el arranque igual que con la 44.2.0;
  - el AppImage arranca y reproduce un minuto en un Weston sin pantalla, se cierra sin errores y conserva los *fuses*
    de `after-pack.cjs`. Si se matan a la vez todos sus procesos (también el de la GPU), acaba con «GPU process isn't
    usable»: es por cómo se cierra, no por la versión.
- **Con Xvfb y xdotool,** antes de las e2e nuevas de EXT-4, el recorrido crítico falló 2 de 7 veces con la 44.8.0: una
  vez Escape no cerró el reproductor, otra se pasó un plazo de 10 s. Con la 44.2.0 pasó las 7. Los fallos
  coincidieron en el tiempo con las e2e de otro hilo en la misma máquina y la misma pantalla `:96` (entre las 08:42 y
  las 08:45 UTC), así que las teclas de una ejecución podían llegar a la ventana de la otra. Después, sin solaparse
  y alternando las dos versiones, pasaron las 8 ejecuciones. La causa probable es ese choque, no Electron. Desde el
  18 de octubre, cada ejecución usa una pantalla libre ([desarrollo.md](desarrollo.md#pruebas-e2e)).
- **Revisión de Codex** (`gpt-6.1-sol`) de la 0.2.3, antes de publicar:
  - corrigió dos cifras: el primer fragmento, que se agrupaba mal por apertura, y los porcentajes de fotogramas
    perdidos;
  - rebajó REN-4 y REP-7 de causa a hipótesis;
  - aclaró que lo probado en el mini PC es la 0.2.2.

## La hora de los trozos del VOD

16 de octubre. Al arrancar desde el VOD (todas las sesiones con anuncio de entrada), el empalme no tenía hora (PDT)
que dar a sus trozos: hls.js la deducía al volver al directo. Ahora se la da (`vodHour`, en `twitch-source.ts`): la que
trae la lista del VOD o, si no la trae, la de cuándo empezó a grabarse más su posición.

| Hora de un trozo del VOD, en 7 canales en directo | Error |
| --- | --- |
| La de su lista (`#EXT-X-PROGRAM-DATE-TIME`, en 5 de los 7) | 0,00 s |
| Cuándo empezó a grabarse (`recordedAt`) más su posición | +1,6 a +2,4 s |
| Cuándo empezó la emisión más su posición | −1,9 a −3,9 s |
| Suponer que el VOD acaba ahora (va 11-48 s por detrás del directo) | +1,3 a +38 s |

- **El error** es la diferencia con la hora de un fragmento en directo que tiene el mismo tiempo de vídeo.
- **Comprobado** con `test:modos --escenario arranque` en jynxzi (con hora en su lista) y caedrel (sin ella), en
  Chrome y Firefox: empieza en el VOD y vuelve con 0 s de salto, sin paradas.
- **Rendimiento, con el código común que sube a `packages/`** (`createPageApi`, `installDirecto` y el `fetch` del
  empalme como opción), frente a la versión anterior: dos tandas a la vez en dos Weston con GPU, cambiando de Weston
  entre ellas (4 canales × 2 rondas, 35 s). Igual el primer fotograma (769 frente a 779-808 ms de mediana), la latencia,
  el búfer, las esperas, la CPU y el hilo de la página, y sin paradas. Los fotogramas perdidos (0,16-0,25 % frente a
  0,48-0,65 %) son ruido: la versión nueva contra sí misma dio 0,20 y 0,51 %.

## Abrir un canal, precalentar al abrir y la calidad de reserva

21 de octubre, en la extensión, en `mini-agentes` (Chrome for Testing en la sesión GNOME, con la GPU: ahí los
fotogramas perdidos son fiables, 0,1-0,4 %; en un Weston 14 sin pantalla salían un 20-30 %).
- **Un canal abierto por su dirección se abría dos veces** con un modo guardado distinto de Adaptativo: el reproductor
  arrancaba con las preferencias por defecto y, al llegar las guardadas, volvía a abrir el canal. Pasa al abrir una
  pestaña en un canal o con «Abrir en GoodTTV». Con *Sin paradas* guardado, `.lab/roadmap/abrir.mjs` contó 8 sesiones
  abiertas antes y 4 ahora: el reproductor espera a las preferencias (`usePreferences` da `loaded`). En Android era el
  doble arranque de una «ruta» de adb (notas de AND-3), arreglado igual. La tele no abre canales antes de tenerlas.
- **REN-1:** al abrir GoodTTV en Inicio, se precalienta el último canal visto si emite (`useOpeningPrewarm`, con
  pruebas). El arranque que se gana es el de precalentar (D16: ~0,5 s en vez de ~0,9 s si se abre tras medio segundo).
  Solo en la extensión: la tele ya precalienta el canal con el foco al abrir, y Android aún no precalienta (no hay ratón).
  Desde el 24 de octubre, Android también lo hace al abrir, en el motor de la app.
- **REP-1:** `/info` dice aparte la calidad que suena (`playing`), y el menú enseña esa. Pidiendo 720p60 a dos canales
  pequeños en directo: `meromeruu` (solo 30 fps) sonaba en 1080p30 y el menú decía «Auto». Además, sin la pedida, el
  empalme elige la misma resolución u otra que no pase de ella (`pickVariant`): ahora suena en 720p30. Con pruebas,
  también para las dos dudas de REP-4 (sesiones con calidades distintas y un VOD con otra calidad que el directo).
- **Sin cambios en la reproducción,** frente a la versión anterior, alternando 4 canales × 2 rondas de 25 s: primer
  fotograma 731 frente a 727 ms de mediana, latencia 2,26 frente a 2,20 s, la misma CPU. Las paradas (3 s en la nueva)
  fueron todas en `illojuan` (fMP4, sin carga progresiva), que en las dos versiones bajó el búfer a 0,08 s.

## REP-6: rutas distintas tras un anuncio

21 de octubre. El empalme descarta el fragmento de una sesión si otra ya dio otra ruta para el mismo índice
(`url-distinta`), y la duda era si la primera podía estar desplazada en el tiempo. `.lab/roadmap/rutas.ts` arranca
empalmes reales y, en cada conflicto, mide en ese momento el tiempo de vídeo de los dos fragmentos. En 8 canales durante
40 min, con 13 anuncios y 10 cambios de numeración: 7 conflictos distintos (101 avisos, repetidos en cada consulta), y
en los 7 los dos fragmentos empezaban en el mismo tiempo de vídeo (diferencia 0). Son el mismo trozo con otra ruta, así
que quedarse con el primero no salta nada. Una primera versión de la sonda, que buscaba los fragmentos después del
conflicto, dio diferencias de segundos cuando la numeración acababa de cambiar: eran de ella, no del empalme. El
episodio de `alexelcapo` (16 oct) no se repitió.

## EXT-5: varias pestañas

21 de octubre, en la extensión, en `mini-agentes`: Chrome for Testing en la sesión GNOME (las pestañas ocultas lo están
de verdad), dos pestañas con dos canales en directo (`.lab/roadmap/pestanas.mjs`, con las esperas acortadas por
`?esperas=`). Desde que la pestaña pasa a estar a la vista hasta que el vídeo avanza con sonido:

| Cuánto tiempo oculta | Cómo estaba | Hasta que suena |
| --- | --- | --- |
| 2 s | sin sonido, siguiendo el directo | 73-87 ms (5 veces) |
| 9 s (parada a los 5 s, con `?esperas=`) | sin vídeo, con el empalme caliente | 104-112 ms (5) |
| 60 s | sin vídeo, con el empalme caliente | 117-133 ms (2) |
| pasado el plazo caliente (61 s con `?esperas=5,20`) | todo parado | 679-736 ms (3), como abrir el canal |

Con el empalme caliente, el reproductor se crea de nuevo (comprobado: es otro `<video>`) y arranca con lo último del
empalme, sin esperar a Twitch. Con las esperas de verdad: sin sonido el primer minuto, caliente los 5 siguientes.

- **La segunda pestaña silencia a la primera** al abrir su canal, y la primera, oculta, se para pasado el plazo.
- **La prueba de la interfaz** abre dos pestañas con el mismo canal, en Chrome y en Firefox: suena la última.
- **Pruebas de los servicios:** dos sesiones que encuentran a la vez el token caducado renuevan una sola vez y usan el
  mismo token; si otra pestaña cierra sesión mientras tanto, no se renueva con el viejo; dos pestañas que añaden un
  reciente a la vez no pierden ninguno.
- **Sin probar con una cuenta de verdad:** la renovación real con varias pestañas y el chat en más de tres ventanas.

## Revisión independiente del 21 de octubre

Codex (`gpt-6.1-sol`, razonamiento alto) revisó todo lo del día, de solo lectura, con preguntas concretas. Se aceptaron y
corrigieron, con pruebas las que se pueden reproducir sin navegador:
- **Una renovación podía resucitar una sesión que otra pestaña cerraba:** cerrar y abrir sesión van ahora en la misma
  sección exclusiva que renovar.
- **La identidad en caché de una pestaña servía para el token de otra cuenta** (otra pestaña cerró sesión y vinculó
  otra): la caché va con su token.
- **El chat del VOD repetía la misma petición sin fin** con un chat muy activo (50 mensajes en 5 s): sigue desde lo
  recibido, y cada respuesta avanza.
- **Dos pestañas que reclaman el sonido a la vez se callaban las dos:** gana la más reciente (y, a la misma hora, un
  desempate común).
- **Un VOD no participaba en «suena una sola»,** y **la rueda o el silencio de una pestaña silenciada** dejaban sonar
  dos, o volvían a silenciarla: reclaman el sonido, y lo que elige la persona manda.
- **Un mensaje enviado podía darse por fallido** si fallaba lo de después (el color, el nombre), y se reenviaría.
- **Cerrar una pestaña con un VOD en pausa pisaba lo que otra había avanzado** con el mismo vídeo: solo se guarda si la
  posición ha cambiado.
- **El éxito de un envío borraba lo que se había escrito mientras tanto,** y **el eco tardío pisaba la copia de
  EventSub** (con insignias y emotes de Twitch).
- **Los trozos «-unmuted» del VOD,** que Twitch no sirve, se piden silenciados, como en el relleno.
- **Dos pulsaciones del botón seguidas abrían dos pestañas.**
- Además, `offset` y la URL de las miniaturas se validan en `window.api.vods`.

No se cambió: **el desfase de DVR-1** (el segundo se calcula con cuándo empezó a grabarse el VOD, 1,6-2,4 s por
detrás); para un salto hacia atrás no se nota. Corregirlo con la hora (PDT) de la lista del VOD queda en DVR-1.

## VOD-1: el reproductor de VOD

21 de octubre, en la extensión, en `mini-agentes` (Chrome for Testing sin ventana), con un VOD de 3 h 18 min de `ibai`
(1080p60, trozos de 10 s de ~8 MB) y `.lab/roadmap/vod-prueba.mjs`, `vod-fresco.mjs` y `vod-twitch.mjs`:

| | GoodTTV | twitch.tv |
| --- | --- | --- |
| Abrir en una pestaña nueva, en la hora 1, hasta que avanza | 1,01-1,06 s (3 veces) | 1,50-2,24 s (3 veces, sin anuncio) |
| Abrir desde la lista del canal (la página ya abierta) | 1,1-1,2 s | |
| Saltar a 1 h, 2 h 30 y 10 min, hasta que avanza | 0,39-0,66 s | |

- **Empieza en 1080p60:** hls.js, por su cuenta, solo empezaba en una calidad cuyo primer trozo (10 s) bajara en 4 s, y
  daba 720p60. Ahora empieza en la mejor que cabe en el ancho de banda medido la última vez (con un 20 % de margen),
  y sigue el ABR. Con carga progresiva (salvo fMP4), se ve antes de llegar el trozo entero.
- **El chat del vídeo** llega como invitado por posición, unos 50 mensajes cada vez; por cursor, Twitch exige
  Client-Integrity (comprobado). Con emotes de Twitch, 7TV, BTTV y FFZ, y con insignias si hay cuenta.
- **Por dónde va:** se guarda cada 5 s, al pausar, al saltar y al ocultarse; al volver, «Sigues donde lo dejaste»,
  5 s antes, con «Desde el principio». Inicio enseña los que van a medias.
- **Un VOD en curso** (la emisión que sigue en directo) se reproduce como un directo que empieza al principio (lista
  `EVENT`), y se puede saltar por él.
- **Sin probar:** un VOD solo para suscriptores (usher da 403 y se dice) y los trozos silenciados.
- **La prueba de la interfaz** abre una emisión desde la ficha, salta con L y comprueba que guarda por dónde va, en
  Chrome y en Firefox.

## El chat, barato de pintar (D31)

24 de octubre, en `mini-agentes`. Scripts y datos en `.lab/rendimiento-1.0/` (no se suben).
- **Cómo se encontró:** con el chat real de `xqc` en Chrome for Testing en la sesión GNOME (con la GPU), la CPU de todo
  el navegador, por proceso e hilo (`hilos.mjs`): 25,4 % de un núcleo sin chat y 47,5 % con él; el hilo de la página,
  del 3,2 al 10,5 %. La traza (`traza.mjs`, `analiza.cjs`) daba 5,6 maquetaciones por segundo de 2,8 ms, todas de la
  página entera (`partialLayout: false`, ~1250 elementos), 32 pintados por segundo y `performWorkUntilDeadline`
  (React) 26 ms por segundo. Con la lista en un bloque, la maquetación pasó a ser parcial y de 0,23 ms.
- **Cómo se comparó:** las dos versiones a la vez, cada una en su Weston 14 sin pantalla (con la GPU), en el mismo canal y
  leyendo el mismo chat (`ab-chat.mjs --simultaneo`), cambiando de Weston en cada ronda; 30 s por ronda tras 15 s de
  arranque, con 100 VOD a medias en `localStorage` (`--historial`), como alguien que los usa. CPU en % de un núcleo;
  «hilo» es el hilo de la página.

  | Comparación (rondas) | CPU del navegador | Hilo de la página | JS (CDP) | Maquetación (CDP) | GPU |
  | --- | --- | --- | --- | --- | --- |
  | Antes → ahora, 15 mensajes/s inventados (2) | 39,5 → 29,3 | 14,1 → 7,0 | 3,6 → 1,1 | 2,5 → 0,45 | 11,3 → 10,1 |
  | Antes → sin el fondo opaco, chat real de `xqc` a 4,9-11 mensajes/s (4) | 46,2 → 42,7 | 10,5 → 7,6 | 2,0 → 0,8 | 1,5 → 0,24 | 16,1 → 16,0 |
  | Por tandas de 50, solo eso, chat real (4) | 46,8 → 45,8 | 9,1 → 8,2 | | | 17,2 → 17,3 |
  | El fondo opaco, solo eso, 15 mensajes/s inventados (2) | 35,7 → 27,9 | 7,1 → 6,6 | | | 13,8 → 9,3 |
  | El fondo opaco, solo eso, chat real a 2,7-5,8 mensajes/s (4) | 36,9 → 36,8 | 5,2 → 5,2 | | | 14,4 → 13,6 |

  Con el chat real, la GPU la marcan sobre todo los emotes animados, que se siguen redibujando; con los inventados, sin
  animaciones, el fondo opaco la deja como sin chat. En las capturas (`captura-chat.mjs`) el texto sale igual que antes,
  con subpíxeles; con `will-change: scroll-position` salía en gris. El árbol de capas (`capas.mjs`) lo confirma: sin el
  fondo, la lista no tiene capa propia; con él, sí (`OverflowScrolling`).
- **Zen** (1.23, en los mismos Weston, 15 mensajes/s inventados, 2 rondas): los procesos de contenido (con la página),
  de 11,8 a 9,3 %; todo Zen, de 43,5 a 41,3 %. Lo que más gasta allí es el proceso principal (~31 %, la composición), igual en las dos.
- **Android, en el emulador** (`goodttv-s25`, sin GPU; `android/chat.mjs`, con la cuenta, los seguidos y el chat falsos
  de la maqueta de AND-3 a 10 mensajes por segundo, 3 rondas alternas): el proceso de la WebView, de 13,0 a 10,3 %
  (12,4/13,6/13,0 frente a 9,6/10,7/10,6). El de la app (~80-125 %) lo ocupa el vídeo, dibujado por software. En el
  teléfono (2,8x en el emulador) la lista ya tenía capa propia: allí no hace falta el fondo opaco.
- **En el S25** (24 oct, la misma maqueta con `jynxzi`, 30 s por ronda, 4 rondas alternas de cada versión; `.lab/s25-1.0/`):
  el proceso de la WebView, de 30,2 a 24,1 % de un núcleo (29,9-30,5 frente a 23,2-24,5); el de la app, con el vídeo,
  de 60,0 a 57,3 %. En el teléfono hay procesos de WebView de otras apps: `chat.mjs` se quedaba con el último que
  encontraba (dio 0 en tres rondas, descartadas) y ahora suma los que gastan.
- **Sin fugas** (`fugas.mjs`): tres vueltas por seis canales con chat real, 12 s en cada uno, y tras cada vuelta, en
  Inicio y tras recoger la basura: 6,6, 7,3 y 7,3 MB de JavaScript (la primera vuelta guarda los catálogos de emotes),
  y los mismos nodos y listeners.
- **Descartado, `content-visibility: auto` en los mensajes:** con el chat real, el hilo de la página subió de 8,2 a 9,9 %
  y de 6,9 a 9,0 % en dos rondas, y la maquetación, de 0,25 a 0,7 %.
- **Pruebas:** las unitarias (con el recorte por tandas y la ventana del chat de un VOD), `test:interfaz` en Chrome
  (43 pasos) y Firefox (41), y las 10 e2e de la tele.

## Fallos encontrados probando (24 oct)

Con recorridos largos en la extensión (Chrome for Testing con teclas y clics de verdad por CDP, una cuenta falsa cuyos
seguidos son canales en directo; `.lab/fallos/`, no se sube) y, en Android, el emulador `goodttv-s25` con la maqueta de
AND-3 y la app manejada desde la página. Una revisión del código de Android (un subagente, solo lectura) encontró los
de Android y dos que también tenía la extensión; cada uno se comprobó antes de arreglarlo.
- **Espacio no pausaba (extensión)** tras abrir un canal con un clic en la columna o tocar el volumen, y tras el botón
  del modo teatro lo quitaba: lo tocado con el ratón se queda con el foco, y Espacio era suyo. Ahora solo lo es si se
  llegó con el teclado (`watchPointerFocus`, en `shortcuts.ts`; `:focus-visible` no sirve: Chrome lo da al pulsar la
  tecla). Comprobado con teclas de verdad en los tres casos (`espacio.mjs`, `espacio2.mjs`).
- **La calidad elegida se perdía al retroceder al VOD (extensión):** al volver, el menú decía 720p60 (la del empalme, aún
  caliente) y con ↓ el canal siguiente se abría en la original. Ahora se queda en la pestaña (`estado.mjs`: 720p60 tras el
  VOD, con ↓ y con ↑).
- **Los VOD en fMP4 empezaban mal (extensión):** el primer trozo iba con la carga progresiva (se desactivaba tarde), no se
  veía, el segundo fallaba y hls.js volvía a empezar, a veces en peor calidad (`vod-directo.mjs`, `vod-arranque.mjs`):

  | VOD (fMP4) | Antes | Ahora |
  | --- | --- | --- |
  | `theburntpeanut`, terminado | 1,9 s, en 360p, con un reinicio | 0,9 s, en 1080p60 |
  | `illojuan` | 0,64 s, con un reinicio | 0,70 s, sin él |
  | `theburntpeanut`, en curso, al retroceder | 3,6 s, en 720p60, con un reinicio | 2,1 s, en 1080p60 |

  Sin carga progresiva, el primero tiene que llegar entero. Los TS (`ibai`, `jynxzi`, `xqc`, `hasanabi`) no cambian:
  0,6-1,3 s.
- **Pausas largas e «Ir al directo» (extensión y Android):** «Ir al directo» no olvidaba la pausa de antes, y al pausar
  otra vez y reanudar se abría el VOD donde se pausó la primera vez. En la extensión, además, no reanudaba (ahora sí,
  como Android). Y moverse en pausa no movía el momento guardado. Comprobado en la extensión con pausas de 65 s
  (`pausa.mjs`: tras «Ir al directo» y una pausa corta, sigue en el directo; con ← en pausa, el VOD abre 10 s antes, a
  2 s de lo esperado) y en el emulador (`android-pausa.mjs`: la segunda pausa lleva su hora, no la de la primera).
- **Android: retroceder al VOD cerraba el canal:** a pantalla completa, el VOD volvía a vertical, y el servicio y los
  mandos del sistema se iban y volvían. En el emulador (`android-dvr.mjs`), antes vertical y ahora horizontal, con el
  chat abierto también al volver al directo (antes se cerraba).
- **Android, en un VOD:** la velocidad volvía a 1× al pasar a otro (ahora sigue, como en la extensión: 1,5× en el
  emulador); reintentar enseñaba otra vez el fallo de antes y otro toque lo abría dos veces; y su chat pedía desde el
  segundo 0 mientras llegaba el VOD.
- **La tarjeta del VOD que se ve («Viéndolo»)** lo volvía a abrir sin el directo del que se vino: se perdía «Ir al
  directo». Extensión y Android.
- **Recientes en minúsculas** (S25, 23 oct): el nombre provisional de un canal abierto por su dirección (su login)
  pisaba el que ya se sabía y, con el id puesto, el canal no volvía a pedir sus datos. Ahora no lo pisa, y uno que quedó
  así se corrige al abrirlo (`nombre.mjs`: «theburntpeanut» pasa a «TheBurntPeanut», también en lo guardado).
- **Sin cambios, comprobado:** la ficha de un emote y el chat quieto mientras el ratón está encima, con la lista en su
  bloque nuevo (`ficha-emote.mjs`); capturas de Inicio, el canal, el modo teatro, un VOD, Ajustes, la búsqueda y un
  canal sin directo, a 1920 × 1080 y 1280 × 720 (`capturas.mjs`); `test:interfaz` en Zen (41 pasos); y 15 min de
  `xqc` en Zen en *Sin paradas* (`vigilar.mjs`): ningún salto ni parada, ningún error de hls.js y un anuncio cubierto.
- **Revisión de Codex** (`gpt-6.1-sol`, razonamiento alto, solo lectura) de todo lo de D31 y de estos arreglos. Se
  aceptaron sus cuatro hallazgos, comprobados antes de arreglarlos:
  - **Android: si no se podía pedir la lista del VOD,** el servicio y los mandos de lo de antes se quedaban esperándolo.
    Ahora la app los cierra;
  - **Android: en pausa, la imagen guardada se movía lo pedido, no lo que de verdad se movía** (Media3 cae en el
    fotograma clave anterior), y el error se acumulaba. Ahora se mueve adonde cae: en el emulador, −10,13 s, igual que
    la posición (`android-pausa-salto.mjs`);
  - **recientes:** un nombre de verdad igual al login no podía cambiar lo guardado. El provisional es el que no trae id;
  - **Espacio,** si se llegó a un botón con Tab y después se pulsaba con el ratón, seguía siendo del botón
    (`espacio3.mjs`: ahora pausa).

  Sostuvo, revisándolo en hls.js 1.7.3, que `LEVEL_UPDATED` llega antes de pedir el primer trozo, y que la calidad que se
  queda no hace que el precalentado y el reproductor pidan calidades distintas. En la tele, la calidad elegida también
  se queda al cerrar el reproductor y volver a abrirlo.

## Solo audio, la calidad recordada e imagen en imagen (D32)

24 de octubre, en `mini-agentes` (scripts en `.lab/fallos/`, no se suben).
- **Android, solo audio con la pantalla apagada,** en el emulador `goodttv-s25` con la maqueta de AND-3 y un canal en
  directo, midiendo lo que baja la interfaz de red del emulador (`android-audio.mjs`, `android-audio-pip.mjs`):

  | | Antes | Ahora |
  | --- | --- | --- |
  | Pantalla encendida | 8,3 Mbit/s | 8,3 Mbit/s |
  | Pantalla apagada | 8,28 Mbit/s | 0,39 Mbit/s, sonando (la sesión de medios, «PLAYING») |
  | Al encenderla, hasta que vuelve el vídeo | al momento | ~3 s (el emulador, sin GPU) |
  | En PiP / en PiP con la pantalla apagada | | 8,3 / 0,37 Mbit/s |

  Antes, con un empalme de verdad en solo audio (`empalme-audio.ts`): publica trozos fMP4 de 2 s de ~52 KB (unos
  210 kbit/s), con la numeración común de las sesiones, y salta los anuncios como con vídeo.
- **En el S25** (24 oct, `jynxzi` con la maqueta, `.lab/s25-1.0/audio.mjs`): con la pantalla encendida, 7,93 Mbit/s en
  1080p60; apagada, 0,38 Mbit/s, sonando («PLAYING»). Al encenderla, el vídeo vuelve 0,92 s después de desbloquearla
  (una medida; el S25 tiene bloqueo, así que se cuenta desde que lo quita el usuario). En el emulador eran ~3 s.
- **La calidad del directo** (`calidad.mjs`, Chrome con clics de verdad): al abrir, «Auto (1080p60)»; tras elegir
  720p60, 720p y guardada; al recargar, sigue en 720p60; el VOD al retroceder, en 720p; y «Auto» vuelve a 1080p60 y la
  olvida (antes del arreglo del directo, se quedaba en 720p).
- **Imagen en imagen** (`pip.mjs`, en un Weston sin pantalla): el botón la abre con un clic, sigue sonando y la cierra.
  Se creyó que solo la tenía Chrome, pero el usuario vio el botón en su Zen: Firefox 158 y Zen 1.23 tienen la API
  (`document.pictureInPictureEnabled`). En Zen, con un clic de verdad (en un Xvfb, con `xdotool`;
  `.lab/teatro-zen/pip.mjs`), se abre su ventana y otro clic la cierra; sin él, la rechaza.
  CPU de todo el navegador en el mismo canal, sin y con ella: 19,8/20,3, 19,8/20,0 y 19,8/19,9 % de un núcleo. Con el
  botón de más, la fila de controles desbordaba 4-10 px con el vídeo estrecho (`controles-ancho.mjs`, de 1280 a 440 px de
  ventana); por debajo de 580 px de vídeo ya no sale, y no desborda en ninguno.
- **Pruebas:** las unitarias (la calidad guardada y «Auto», `levelFor`, el solo audio en `pickVariant` y en el directo),
  `test:interfaz` en Chrome (43 pasos) y Firefox (41), y las 10 e2e de la tele.
- **Revisión de Codex** (`gpt-6.1-sol`, razonamiento alto, solo lectura). Se aceptaron sus cuatro hallazgos, comprobados
  antes de arreglarlos y después en el emulador (`android-audio2.mjs`):
  - **encender la pantalla mientras se abría el solo audio lo dejaba en solo audio, a la vista.** Ahora vuelve el vídeo
    (7,9-8,3 Mbit/s, en 1080p60);
  - **apagarla mientras cargaba el canal, o en pausa y reanudar después, lo dejaba bajando vídeo.** Ahora pasa a solo
    audio al empezar a sonar (0,38 Mbit/s);
  - **pausar en solo audio y volver perdía lo que quedaba hasta el directo:** el vídeo nuevo empieza en el directo, y su
    lista, corta, no llega a la pausa. Ahora se abre en pausa con la pausa «fuera», y reproducir abre el VOD donde se
    pausó, como tras una pausa larga;
  - **el VOD al retroceder pedía antes la lista de otra calidad.** Ahora empieza ya en la del directo.

  Al comprobarlo apareció otro, del 24 por la mañana: la página de Android no actualizaba lo pausado al moverse en
  pausa (solo comparaba cuándo se pausó), así que el arreglo de entonces no llegaba a abrir el VOD donde se dejó la
  imagen. Ahora sí, y la imagen se mueve lo que de verdad se movió (`android-pausa-salto.mjs`: −10,14 s).

## El relevo del solo audio y el chat a pantalla completa (D33)

24 de octubre, en `mini-agentes` (scripts en `.lab/relevo/`, no se suben).
- **El relevo, en el emulador** `goodttv-s25`, con la maqueta de AND-3 y `jynxzi` (`relevo.mjs`, dos vueltas): al apagar
  la pantalla, el relevo a solo audio se entrega a los 2,3-2,5 s de empezar, con los dos reproductores a 1-5 ms uno del
  otro (por la hora de los fragmentos). La página solo ve «reproduciendo», sin ninguna carga, la sesión de medios sigue
  en «PLAYING» y bajan 0,40-0,43 Mbit/s. Al encenderla, igual hacia el vídeo (2,3 s). Empezándolo al encenderse la
  pantalla y desbloqueando a los 2,5 s, como una persona, el vídeo está a los 39-49 ms de desbloquear (sin eso, ~2,3 s).
  Las capturas a 0,3 y 1,5 s del desbloqueo lo enseñan moviéndose (`captura.mjs`).
- **Que no hay corte** se comprueba por la hora de los fragmentos y por lo que ve la página: el emulador va sin sonido.
- **En el S25** (24 oct, la release, probado por el usuario): sin corte de sonido al apagar ni al encender; al
  desbloquear, el vídeo ya está, con un parpadeo negro muy corto. En logcat, los relevos se entregan a los 2,3-2,6 s, con
  los dos reproductores a 1-7 ms.
- **Lo de la revisión de D32, otra vez** (`android-audio2.mjs`): apagar y encender enseguida deja el vídeo (7,9 Mbit/s);
  apagar mientras carga, solo audio (0,38); pausar en solo audio y volver, en pausa y «fuera», y reproducir abre el VOD.
  Pausar con los mandos del sistema (`cmd media_session dispatch pause`) con la pantalla apagada, volver y reproducir
  abre el VOD donde se pausó (`pausa-mandos.mjs`), también antes del relevo. En el S25, con la versión anterior, el
  usuario vio que volvía al directo. Con esta, por ese mismo camino (`pausa-s25.sh`: solo audio ya puesto, pausa por la
  sesión de medios con la pantalla apagada, encenderla), se reabre en pausa «fuera» al encenderse y, al darle a
  reproducir, abre el VOD. También pausando desde la pantalla de bloqueo en `jaimemellado`. Y la pausa larga con «Ir
  al directo» y una pausa corta después sigue en el directo (`jynxzi`). No se sabe por qué falló antes.
- **El motor:** pruebas nuevas en `directo.test.ts` (el empalme de antes sigue con su reproductor y se para a los 10 s
  sin peticiones suyas; con el mismo reproductor, sin visita o con otro canal, se para; sus trozos del VOD siguen
  valiendo). El rendimiento de la extensión (`rendimiento.mjs`, antes y ahora a la vez en dos Weston, con `jynxzi`,
  `papaplatte` y `eslcs`, 2 rondas): primer fotograma, mediana de 756 y 731 ms; CPU del navegador, 17,8 y 17,7 %; ninguna
  parada.
- **La pantalla completa con su chat** (`test:interfaz` en Chrome, con teclas de verdad): F da solo el vídeo, sin el
  botón del modo teatro; C pone el chat al lado; al salir, sigue en modo teatro con el chat de la ventana; y la vez
  siguiente, F ya lo pone al lado. En Zen 1.23.4b (`.lab/teatro-zen/zen.mjs`, con la pantalla completa permitida sin
  gesto), igual: solo el vídeo a 1920 × 1080, T no hace nada, y C pone el chat a 340 px.
- **Pruebas:** las unitarias (436), `test:interfaz` en Chrome (45 pasos) y Firefox (41), y las 10 e2e de la tele (con
  `E2E_CHANNELS`: de su lista, a esa hora solo emitía uno).

