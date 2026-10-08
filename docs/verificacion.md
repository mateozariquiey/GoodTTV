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
