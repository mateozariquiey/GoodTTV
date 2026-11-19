# Verificación: qué está comprobado y qué falta

El estado a 19 de noviembre de 2026: qué está comprobado hoy de cada versión y de cada función, con qué prueba, en qué
fecha y con qué versión, y qué no lo está. El detalle de cada comprobación (cómo se hizo, las cifras y los datos) está en
el [diario](#el-diario), un archivo por versión publicada. Cómo se lanza cada prueba está en
[desarrollo.md](desarrollo.md).

## Cómo leerlo

- **Lo comprobado** es lo que dice el diario, con su fecha. Si algo cambió después en el código que lo toca y no se ha
  vuelto a mirar, aquí sale como «sin comprobar desde» esa fecha.
- **El laboratorio no es el aparato del usuario.** Casi todo se comprueba en `mini-agentes`, con Chrome for Testing,
  Firefox o Zen, en un Weston sin pantalla o en la sesión GNOME, y Android en un emulador. Lo que solo se puede ver en el
  teléfono, en una TV o con una cuenta de Twitch de verdad se dice aparte.
- **Al comprobar algo nuevo,** apúntalo en el diario de lo aún sin publicar
  ([verificacion/sin-publicar.md](verificacion/sin-publicar.md)) y cambia aquí su fila. Al publicar una versión, ese
  archivo pasa a llamarse como ella y se empieza otro.
- **El texto del diario no se reescribe:** cuenta lo que pasó entonces. Lo que una decisión posterior cambió está
  [abajo](#lo-que-el-diario-cuenta-y-ya-no-vale).

## Las tres versiones, hoy

La última versión publicada es la 0.5.1, del 10 de noviembre, sin APK de Android. Lo que hay en `main` desde entonces
(la categoría en la columna, cada pestaña con su sonido y el directorio de categorías, del 18 de noviembre) no ha salido
en ninguna versión.

### Extensión

- **Pruebas automáticas:** `bun run verify` (589 pruebas), la prueba de la interfaz en Chrome for Testing 156
  (55 pasos) y en Firefox 158 (52) y la de humo pasan el 19 de noviembre, tras [la auditoría](verificacion/0.6.0.md#la-auditoría-de-noviembre-limpieza-y-rendimiento-d51-d52). En
  Zen pasó por última vez al publicar la 0.5.1, el 10 de noviembre (50 pasos).
- **Recorridos del 18 de noviembre:** la columna de seguidos (D47) y el directorio de categorías en inglés y en español
  (D49). **Del 19,** con lo que la auditoría unió entre la extensión y Android: la cuadrícula en ventanas de verdad
  (59 pasos), retroceder el directo y los VOD, y el chat con emotes.
- **Rendimiento del reproductor:** la última comparación con la versión anterior es del 19 de noviembre, con el búfer
  del directo a 30 s (D52): sin regresiones en las paradas, la CPU, el hilo de la página ni los fotogramas perdidos, y
  la página ocupa 630 MB menos con cuatro canales. D48 (18 nov) cambió lo que hace una pestaña oculta: ahora sigue
  sonando, y cuánto gasta eso está sin medir.
- **Sin comprobar:** casi nada se ha visto con una cuenta de Twitch de verdad desde octubre (se usa la cuenta falsa del
  laboratorio), y la guía de Chrome no se ha seguido en Windows.

### Android

- **La última versión con APK es la 0.6.0,** del 20 de noviembre, firmada con la clave de siempre. La 0.5.1 salió sin
  él. En el S25, ese día: medida frente a la 0.5.0 sin regresiones, lo nuevo recorrido con la variante de medida, y la
  release instalada encima de la 0.5.0 conserva la cuenta ([diario](verificacion/0.6.0.md#la-auditoría-de-noviembre-limpieza-y-rendimiento-d51-d52)).
- **En el S25, el 5 de noviembre:** la versión final de la 0.5.0 contra la de antes de D41 y D42, sin regresiones (abrir
  un canal en 944 ms frente a 1047, ningún fotograma perdido y ninguna parada). La release instalada encima conserva la
  cuenta del usuario.
- **Después, solo en el emulador:** el selector de Inicio (D43, 5 nov), el directorio de categorías (D49, 18 nov) y, el
  19 de noviembre, [un recorrido entero](verificacion/0.6.0.md#la-auditoría-de-noviembre-limpieza-y-rendimiento-d51-d52) tras quitar el
  reproductor B y unir con la extensión la lógica del canal, los VOD, los emotes y la búsqueda. Desde ese día,
  `bun run verify` comprueba los tipos de la página de Android, y esa lógica tiene pruebas unitarias.
- **Sin comprobar:** el uso con el dedo de lo nuevo, la pantalla apagada y desenchufado más de 10 min, la calle con datos
  de verdad, el fin real de una emisión y la potencia, que no se mide desde el 23 de octubre porque las medidas
  posteriores se hicieron con el teléfono enchufado.

### TV

- **No está instalada en ninguna TV desde hacia el 19 de octubre.** Lo último comprobado en una TV de verdad, con el
  mando, es la 0.2.2 y la 0.2.3, el 16 de octubre: el audio por HDMI, la decodificación por hardware, el mando y leer a
  3 m ([diario](verificacion/0.2.1-0.2.3.md#en-el-mini-pc-la-tv-y-el-mando)).
- **Desde entonces, solo pruebas automáticas:** las 13 e2e de Electron pasan el 19 de noviembre, ya sin el reproductor
  oficial de Twitch y con el servidor local en HTTP (D51). El AppImage, extraído, abre por HTTP, enseña «Populares» y
  reproduce un directo abierto con las teclas del mando (20 nov, con D51).
- **Rendimiento, frente a la 0.5.0:** el primer fotograma igual (580 frente a 586 ms, 6 nov) y los fotogramas perdidos
  igual (0,46 frente a 0,53 %, 10 nov) ([diario](verificacion/0.5.1.md#la-tv-en-inglés-y-sin-cuenta-d44)).
- **No recibe funciones nuevas de momento (D50).**
- **Sin comprobar:** nada en una TV ni con un mando de verdad desde el 16 de octubre, ni a 3 m, ni en 4K, y nada con
  cuenta en inglés.

## Lo que no está comprobado

Lo más importante de lo que falta, de las tres versiones:
- **Una pausa global de verdad** (todas las sesiones en anuncio a la vez): la última documentada es del 12 de octubre.
  Desde entonces, el relleno con el VOD solo se ha probado con pausas simuladas.
- **Con una cuenta de Twitch de verdad,** casi todo lo de octubre y noviembre se ha comprobado con una cuenta falsa del
  laboratorio que usa canales reales.
- **La TV en una TV,** desde el 16 de octubre.
- **Android fuera de casa:** con la pantalla apagada y desenchufado más de 10 min, y pasando a datos con buena cobertura.
- **La extensión en Windows y macOS:** todas las pruebas son en Linux, y la guía de instalación en Chrome para Windows
  no la ha seguido nadie en Windows.

## Lo que el diario cuenta y ya no vale

El diario se escribió día a día, y estas cosas cambiaron después. Lo que diga de ellas vale para su fecha:

| Lo que cuenta el diario | Desde cuándo | Lo que vale ahora |
| --- | --- | --- |
| Solo suena una pestaña, la última que se miró, y las demás se paran por escalones (EXT-5, 21 oct y 3 nov, y lo que dicen de ello otras secciones, como la cuadrícula) | 18 nov | Cada pestaña suena por su cuenta, también oculta (D48) |
| El reproductor acelera a 1,05× para recuperar el margen (D16, 12 oct) | 29 oct | Salta lo que sobra de una vez (D34) |
| fMP4 sin carga progresiva y con 3 fragmentos de margen (15 y 21 oct) | 29 oct | Con hls.js 1.7.4, carga progresiva y 2,5 fragmentos, como MPEG-TS |
| La interfaz de la TV dentro de la extensión (hito 3, 11 oct) | 11 oct | La interfaz de escritorio (D14) |
| La rueda del ratón para el volumen sobre el vídeo | 22 oct | Quitada: la rueda desplaza la página |
| Inicio enseña lo guardado de la última vez, sea de cuando sea (16 oct) | 23 oct | Solo si es de hace menos de 5 min, y si no, la forma vacía (D26) |
| La categoría en la columna, solo por encima de 1760 px de ventana (D41) | 18 nov | A cualquier ancho, con la cifra abreviada (D47) |
| La TV en el mini PC, con Kodi y el mando (16 oct) | Hacia el 19 oct | Sin instalar en ninguna TV |
| La TV con el certificado de VacuumStream | 0.5.0 | Un certificado propio por instalación |
| El reproductor oficial de Twitch como respaldo en la TV, «Controles de Twitch» y el HTTPS local con su certificado (D4, D11) | 19 nov | Sin respaldo: un error con «Reintentar», y el servidor local en HTTP (D51) |
| El reproductor B de Android (hls.js en la WebView) y la página `reproductor.html` de la extensión | 19 nov | Quitados: Android solo lleva Media3 (D21), y la prueba de humo abre el reproductor de verdad |
| Electron 44.2.0 y 44.8.0 | 4 nov | Electron 44.10.2 |

## El diario

Un archivo por versión publicada, con las secciones en el orden en que se escribieron. Cada una lleva su fecha, y algunas
tienen añadidos posteriores al final.

| Archivo | Periodo | Qué trae |
| --- | --- | --- |
| [hasta-0.2.0.md](verificacion/hasta-0.2.0.md) | 8-12 oct | La TV que salió de VacuumStream, la extensión por hitos, la barra de volumen y el zoom, y el rendimiento del reproductor propio (D16) |
| [0.2.1-0.2.3.md](verificacion/0.2.1-0.2.3.md) | 13-19 oct | La TV en el mini PC con el mando, los saltos de *Sin paradas* y de fMP4, Inicio al abrir en la TV, la cuenta sin red (EXT-4), el primer fragmento lento (REN-4) y Electron 44.8.0 |
| [0.3.0.md](verificacion/0.3.0.md) | 20-23 oct | Precalentar al abrir, Inicio sin esperas (D26), varias pestañas (EXT-5), los VOD (VOD-1), retroceder el directo (DVR-1), los emotes y Android en el S25 |
| [0.4.0.md](verificacion/0.4.0.md) | 24 oct | El chat barato de pintar (D31), solo audio, la calidad recordada, imagen en imagen y el relevo (D32, D33) |
| [0.4.1.md](verificacion/0.4.1.md) | 25 oct-1 nov | El audio desincronizado (D34), hls.js 1.7.4, el paso al VOD más rápido y el eval del empalme (REP-9) |
| [0.5.0.md](verificacion/0.5.0.md) | 2-5 nov | Electron 44.10.2, el idioma a mano (D35), las paradas y las conexiones (D36-D39), la reconexión de Android (D38, D40), la cuadrícula (D42), la interfaz de D41 y la versión final en el S25 |
| [0.5.1.md](verificacion/0.5.1.md) | 6-10 nov | La TV en inglés y sin cuenta (D44) |
| [0.6.0.md](verificacion/0.6.0.md) | 11-20 nov | La categoría en la columna (D47), cada pestaña con su sonido (D48), el directorio de categorías (D49), la auditoría de noviembre (D51-D53), «Reintentar» (D54) y «Populares» (D55) |
| [sin-publicar.md](verificacion/sin-publicar.md) | Desde el 21 nov | Lo que se compruebe después de la 0.6.0 |

