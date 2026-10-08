# GoodTTV

[English](README.md) · **Español**

Cliente de Twitch para la tele, pensado para usarlo desde el sofá en un mini PC Linux con un
mando pequeño: flechas, OK, Atrás y Reproducir/Pausa. Sirve para ver directos de los canales
que sigues, buscar canales y leer el chat con los emotes de **7TV, BTTV, FFZ** y Twitch. Nada
más: sin VOD, clips ni categorías.

![Inicio: canales que sigues en directo y vista previa del enfocado](docs/media/inicio.jpg)

![Reproducción: vídeo oficial de Twitch, controles debajo y chat con emotes a la derecha](docs/media/reproduccion.jpg)

[Vídeo de demostración (84 s, solo teclas de mando)](docs/media/demo.mp4) ·
[Buscar con el teclado en pantalla](docs/media/buscar.jpg) ·
[Selector de calidad](docs/media/calidad.jpg)

## Qué hace

- **Inicio tipo guía.** A la izquierda, los canales que sigues que están en directo, con
  espectadores, categoría y tiempo en directo. Debajo aparecen los canales que viste hace poco y
  los populares. A la derecha, una vista previa grande del canal enfocado.
- **Reproducción con el reproductor oficial de Twitch.** El vídeo nunca queda tapado: los
  controles y la información van debajo y el chat a la derecha. ↑/↓ cambian de canal sin salir
  del reproductor, y Reproducir/Pausa funciona siempre.
- **Chat propio y de solo lectura** por EventSub, con emotes de Twitch, 7TV, BTTV y FFZ
  (globales y del canal), emotes de anchura cero, insignias y menciones. Tiene dos tamaños de
  texto.
- **Buscar** con un teclado en pantalla manejado con el mando. Si conectas un teclado físico,
  también sirve.
- **Volver conserva tu sitio.** Al salir del reproductor, el foco vuelve al canal del que
  venías.
- **«Controles de Twitch».** Un modo explícito para manejar con el mando la interfaz del propio
  reproductor; por ejemplo, para aceptar el aviso de «contenido para determinadas audiencias».
- **Vincular la cuenta con el móvil**, mediante un QR o un código de Twitch. Solo pide permisos
  de lectura: tus seguidos y el chat.
- **Probar el mando**, en Ajustes: muestra qué tecla envía cada botón.

## Estado

Primera entrega. Lo comprobado en el laboratorio (escritorio Arch, pantalla virtual X11, teclas
X11 reales) y lo que falta por probar en el mini PC, la TV y el mando físico está en
[docs/verificacion.md](docs/verificacion.md). En resumen: el recorrido abrir canal →
reproducir → pausar/reanudar → volver → otro canal funciona solo con teclas, con vídeo real a
1920×1080. Quedan por probar el audio HDMI, la aceleración de vídeo y la fluidez en el GMKtec M6
Ultra, el mando físico y la suspensión.

Limitaciones que dependen de Twitch:
- Vincular la cuenta sirve para la lista de seguidos y el chat. **El reproductor no recibe esa
  sesión:** Turbo y las ventajas de suscriptor no se aplican.
- Twitch controla los anuncios, la disponibilidad y la puerta de contenido para adultos. La app
  no los evita.

## Usarlo

Requisitos: Linux x86_64, Node.js 24 o posterior y Bun 1.4.2.

```bash
bun install --frozen-lockfile
bun run build && bun run start         # en una ventana, para probar
bun run package:appimage               # dist/GoodTTV-0.1.0-x86_64.AppImage, a pantalla completa
```

Hay AppImages ya compilados en las [releases](https://github.com/mateozariquiey/GoodTTV/releases).
Desarrollo, pruebas, empaquetado y el laboratorio están en
[docs/desarrollo.md](docs/desarrollo.md).

| Mando | Acción |
| --- | --- |
| Flechas | Moverse. En el reproductor, ↑/↓ cambian de canal |
| OK (Enter) | Elegir |
| Atrás (Escape, Back, Retroceso) | Volver |
| Reproducir/Pausa (o Espacio) | Pausar o reanudar en cualquier momento |

## Origen y cambios

GoodTTV es una variante de [VacuumStream](https://github.com/eliottness/VacuumStream) 0.2.1,
de Eliott Bouhana, con licencia MIT. Este repositorio conserva su historial completo.

**Conservado de VacuumStream:**
- El proceso principal y su modelo de seguridad: aislamiento, IPC verificado y servidor HTTPS
  local con certificado fijado.
- El inicio de sesión por código y el almacén de tokens.
- El adaptador de Helix y el cargador del SDK de Twitch.
- El algoritmo de foco espacial y el empaquetado con electron-builder.

**Cambios:**
- Interfaz nueva, más pequeña y en español, diseñada para un mando de TV.
- Chat propio con emotes de terceros, en lugar del iframe oficial.
- Todas las teclas pasan por el proceso principal, así que la app no pierde el control aunque
  el foco esté dentro del iframe de Twitch.
- Se ha retirado el arranque del vídeo inyectando código en el iframe: ya no hace falta.
- Volver conserva tu posición en la lista.
- Fuera de esta versión: VOD, reanudación, categorías, favoritos, subtítulos, Steam Deck,
  Gamepad API y Flatpak.

El porqué de cada decisión está en [docs/decisiones.md](docs/decisiones.md) y el funcionamiento
en [docs/arquitectura.md](docs/arquitectura.md).

## Contribuir

Se agradecen issues y pull requests, en español o en inglés. Consulta
[CONTRIBUTING.md](CONTRIBUTING.md) y, para avisos de seguridad, [SECURITY.md](SECURITY.md).

## Licencia

[MIT](LICENSE), con la atribución original de VacuumStream. Twitch es una marca de Twitch
Interactive, Inc. GoodTTV no está afiliado a Twitch ni cuenta con su respaldo. Los emotes de
terceros se cargan desde los servicios públicos de 7TV, BetterTTV y FrankerFaceZ.
