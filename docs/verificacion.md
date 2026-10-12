# Verificación: qué está comprobado y qué falta

Fecha: 8 de octubre de 2026. Entorno de laboratorio:
- **Equipo:** sobremesa con Arch Linux, Electron 44 y una pantalla virtual X11 (Xvfb) de
  1920×1080, sin GPU.
- **Teclas:** reales de X11, enviadas con `xdotool`, como las de un mando USB.
- **Audio:** silenciado por Chromium (`--mute-audio`).

Nada de esto certifica el mini PC (GMKtec M6 Ultra), la TV Samsung UE65TU7095 ni el mando
físico.

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

## Pendiente en el mini PC, la TV y el mando

Para cada punto, la manera de comprobarlo:

1. **Audio por HDMI.** Abre un directo y comprueba que suena por la TV. Ejecuta
   `bash scripts/diagnostico.sh`: muestra la salida de audio activa.
2. **Aceleración de vídeo y fluidez.** En Ajustes → Acerca de, «Aceleración de vídeo
   disponible» debe decir «sí». Eso indica capacidad, no que se use. Durante un directo a
   1080p60, entra en «Controles de Twitch» → engranaje → Avanzado → *Video Stats* para ver los
   fotogramas perdidos. Vigila con `top` el uso de CPU: si un proceso `goodttv` consume uno o
   más núcleos completos, probablemente decodifica por software.
3. **Mando físico.** En Ajustes → Probar el mando, comprueba que flechas, OK, Atrás y Play/Pausa
   aparecen con su acción. Si Atrás envía otra tecla, se añade en `actionForKey`.
4. **Foco del sistema.** La app solo recibe teclas mientras su ventana tiene el foco. Conviene
   arrancarla en una sesión de quiosco o como única ventana, y comprobar qué pasa tras una
   notificación del escritorio.
5. **Suspensión y reanudación.** Con un directo abierto, suspende y reanuda el equipo. Debe
   reanudar solo, salvo que lo hubieras pausado tú. Mientras se reproduce, la app impide que la
   pantalla se apague (`powerSaveBlocker`).
6. **Legibilidad a 3 m** en la Samsung de 65″. La TV es 4K: si el escritorio va a 4K al 100 %,
   la app escala sola, porque su tamaño depende del ancho de la ventana.
7. **Tu cuenta en el reproductor.** El reproductor no comparte la sesión de la app: anuncios,
   Turbo y suscripciones se comportan como para un invitado.

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
- **Sin comprobar:** Ctrl + de verdad en Chrome (solo simulado).

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
- **Lo que queda:** la tele (Electron 44, Chromium 152) descarga el primer fragmento más despacio que Chrome 155, con el
  mismo código y la misma configuración. Queda por investigar.
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
- sesiones de más de 7 min con la carga progresiva (las de los modos duran 400 s);
- el precalentado con el ratón real (la prueba lo pide directamente).
