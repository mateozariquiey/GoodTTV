# GoodTTV

[English](README.md) · **Español**

Twitch sin anuncios, con clientes propios para ver directos en la tele y en el navegador. La versión de Android está
en desarrollo.

> [!WARNING]
> Quitar los anuncios incumple las condiciones de servicio de Twitch. GoodTTV es un proyecto personal: úsalo bajo tu
> responsabilidad. No está en ninguna tienda y no tiene relación con Twitch.

| Versión | Para qué | Estado |
| --- | --- | --- |
| [Tele](#tele) (`apps/tele`) | Un mini PC Linux conectado a la tele, con un mando | 0.2.0; falta probarla en el mini PC |
| [Navegador](#navegador) (`apps/navegador`) | Chrome, Chromium, Firefox y Zen, con ratón y teclado | 0.2.0 |
| [Android](#android) | El teléfono | En desarrollo |

![Extensión: el vídeo con los controles encima, la ficha del canal y el chat; a la izquierda, los seguidos en directo](docs/media/escritorio-canal.jpg)

## Cómo quita los anuncios

Twitch mete los anuncios dentro de la propia emisión, y cada sesión de espectador los recibe por separado. GoodTTV:
- abre a la vez varias sesiones de invitado del mismo canal: la del reproductor web, la del incrustado, la de la
  ventana emergente y la de la app de Android;
- toma cada fragmento de vídeo de una sesión que no esté en anuncio y los empalma por la numeración común que les
  pone Twitch;
- si todas están en anuncio a la vez, rellena con la grabación del directo (el VOD) hasta que vuelve la emisión.

El relleno necesita que el canal tenga el VOD público y que llegue a tiempo; si no, la imagen se queda quieta mientras
dura la pausa. El vídeo se reproduce con [hls.js](https://github.com/video-dev/hls.js) en un `<video>` propio. Hay tres
modos de retraso: Adaptativo (por defecto), Sin paradas y Directo. El chat se retrasa lo mismo que la imagen, para que
vayan más o menos a la par.

En la extensión, con varios canales y 12 arranques, la primera imagen llega en 0,86 s (mediana) y se pierde el 0,06 %
de los fotogramas, sin paradas ([detalle](docs/verificacion.md#rendimiento-del-reproductor-propio)).

## Tele

Pensada para usarla desde el sofá en un mini PC Linux con un mando pequeño: flechas, OK, Atrás y Reproducir/Pausa.
Sirve para ver los directos de los canales que sigues, buscar canales y leer el chat con los emotes de **7TV, BTTV,
FFZ** y Twitch. No incluye VOD, clips ni categorías.

![Inicio de la tele: canales que sigues en directo y vista previa del enfocado](docs/media/inicio.jpg)

De la 0.1.0, con el reproductor oficial de Twitch: [reproducción](docs/media/reproduccion.jpg) ·
[vídeo de demostración (84 s, solo teclas de mando)](docs/media/demo.mp4) ·
[buscar con el teclado en pantalla](docs/media/buscar.jpg) · [selector de calidad](docs/media/calidad.jpg)

- **Inicio tipo guía.** A la izquierda, los canales que sigues que están en directo, con espectadores, categoría y
  tiempo en directo. Debajo aparecen los canales que viste hace poco y los populares. A la derecha, una vista previa
  grande del canal enfocado.
- **Reproductor propio, sin anuncios.** El vídeo ocupa todo el alto y el chat va a la derecha. El título y los
  controles aparecen encima al pulsar una tecla y se ocultan solos. Si el reproductor propio falla, se puede cambiar al
  oficial de Twitch, con los controles debajo. ↑/↓ cambian de canal sin salir del reproductor, y Reproducir/Pausa
  funciona siempre.
- **Chat propio y de solo lectura** por EventSub, con emotes de Twitch, 7TV, BTTV y FFZ (globales y del canal),
  emotes de anchura cero, insignias y menciones. Tiene dos tamaños de texto.
- **Buscar** con un teclado en pantalla manejado con el mando. Si conectas un teclado físico, también sirve.
- **Volver conserva tu sitio.** Al salir del reproductor, el foco vuelve al canal del que venías.
- **Vincular la cuenta con el móvil**, mediante un QR o un código de Twitch. Solo pide permisos de lectura: tus
  seguidos y el chat.
- **Probar el mando**, en Ajustes: muestra qué tecla envía cada botón.

| Mando | Acción |
| --- | --- |
| Flechas | Moverse. En el reproductor, ↑/↓ cambian de canal |
| OK (Enter) | Elegir |
| Atrás (Escape, Back, Retroceso) | Volver |
| Reproducir/Pausa (o Espacio) | Pausar o reanudar en cualquier momento |

**Instalarla:** descarga el AppImage de las [releases](https://github.com/mateozariquiey/GoodTTV/releases) (Linux
x86_64) y ejecútalo; arranca a pantalla completa y necesita `libfuse2`. Para compilarla:

```bash
bun install --frozen-lockfile
bun run build && bun run start   # en una ventana, para probar
bun run package:appimage         # apps/tele/dist/GoodTTV-0.2.0-x86_64.AppImage
```

**Estado:** lo comprobado en el laboratorio y lo que falta por probar en el mini PC, la TV y el mando físico está en
[docs/verificacion.md](docs/verificacion.md). Quedan por probar el audio HDMI, la aceleración de vídeo y la fluidez en
el GMKtec M6 Ultra, el mando físico y la suspensión.

## Navegador

Una extensión que abre GoodTTV en una pestaña propia, con una interfaz pensada para el ratón y el teclado. Un solo
código sirve para Chrome y para Firefox.

- **Inicio** con miniaturas de tus seguidos en directo y de los populares, y «Seguir viendo».
- **Columna de seguidos en directo**, que se puede plegar.
- **Búsqueda siempre arriba** (atajo `/`). Enter abre el canal con ese nombre.
- **Controles sobre el vídeo**, que se ocultan con el ratón quieto: calidad, modo teatro (`T`), pantalla completa
  (`F`), chat (`C`) y silencio (`M`). ↑/↓ cambian de canal.
- **Arranca antes** si dejas el ratón quieto sobre un canal: lo va preparando.
- **«Abrir en GoodTTV»** en el menú contextual de los enlaces de twitch.tv.
- **Vincular la cuenta** con un código, como en la tele.
- **Sigue a su ritmo con la pestaña oculta**, aunque el navegador frene sus temporizadores.

**Instalarla:** no está en las tiendas. Descarga `goodttv-0.2.0.xpi` de las
[releases](https://github.com/mateozariquiey/GoodTTV/releases):
- **Zen** (y Firefox Developer Edition o Nightly): en `about:config`, pon `xpinstall.signatures.required` a
  `false`. Después, en `about:addons`, menú del engranaje → «Instalar complemento desde archivo…».
- **Firefox:** solo admite complementos sin firmar de forma temporal: `about:debugging` → «Este Firefox» → «Cargar
  complemento temporal…». Se quita al cerrar Firefox.
- **Chrome y Chromium:** descomprime el `.xpi` (es un ZIP) en una carpeta. En `chrome://extensions`, activa el «Modo
  de desarrollador» y pulsa «Cargar descomprimida».

Para compilarla, `bun run build:navegador` (deja la extensión en `apps/navegador/dist`) o `bun run pack:navegador`
(el `.xpi`). Más en [docs/desarrollo.md](docs/desarrollo.md#extensión-de-navegador).

## Android

En desarrollo. La interfaz irá en una WebView, el empalme en JavaScript y el vídeo con Media3, y seguirá sonando con
la pantalla apagada.

## El código

Un monorepo con espacios de trabajo de Bun:

| Carpeta | Qué hay |
| --- | --- |
| `apps/tele` | La app de la tele (Electron) |
| `apps/navegador` | La extensión (Manifest V3) |
| `packages/sin-anuncios` | El empalme de las sesiones y el relleno con el VOD |
| `packages/interfaz` | Lo común de las interfaces: reproductor, chat y datos |
| `packages/servicios` | Cuenta, API de Twitch (Helix), chat y almacén |
| `packages/contratos` | Los tipos de la API que comparten las versiones |

Requisitos: Node.js 24 o posterior y Bun 1.4.2.

```bash
bun install --frozen-lockfile
bun run verify   # Biome, TypeScript, pruebas unitarias y compilaciones
```

La documentación de diseño está en español: [arquitectura](docs/arquitectura.md), [decisiones](docs/decisiones.md),
[desarrollo](docs/desarrollo.md) y [verificación](docs/verificacion.md). Algunas rutas que citan (`investigacion/`,
`herramientas/`, `.lab/`) son del repo de trabajo y no se publican.

## Origen

GoodTTV empezó como una variante de [VacuumStream](https://github.com/eliottness/VacuumStream) 0.2.1, de Eliott
Bouhana, con licencia MIT. Este repositorio conserva su historial completo. De VacuumStream se conserva, en la tele:
- el proceso principal y su modelo de seguridad: aislamiento, IPC verificado y servidor HTTPS local con certificado
  fijado;
- el inicio de sesión por código y el almacén de tokens;
- el adaptador de Helix y el cargador del SDK de Twitch;
- el algoritmo de foco espacial y el empaquetado con electron-builder.

Lo demás es de GoodTTV: la interfaz de la tele y la de escritorio, el chat con emotes de terceros, el reproductor sin
anuncios y la extensión. El porqué de cada decisión está en [docs/decisiones.md](docs/decisiones.md).

## Contribuir

Se agradecen issues y pull requests, en español o en inglés. Consulta [CONTRIBUTING.md](CONTRIBUTING.md) y, para
avisos de seguridad, [SECURITY.md](SECURITY.md).

## Licencia

[MIT](LICENSE), con la atribución original de VacuumStream. Twitch es una marca de Twitch Interactive, Inc. GoodTTV no
está afiliado a Twitch ni cuenta con su respaldo. Los emotes de terceros se cargan desde los servicios públicos de 7TV,
BetterTTV y FrankerFaceZ.
