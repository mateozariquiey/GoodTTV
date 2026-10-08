# Arquitectura

Esta guía está pensada para mantener la app. Las decisiones y sus alternativas están en
[decisiones.md](decisiones.md).

## Las tres piezas de Electron

```text
Proceso principal (src/main) ── tiene todos los permisos
├── index.ts               ventana, servidor HTTPS local, permisos, arranque
├── input-router.ts        TODAS las teclas del mando → acciones («up», «ok», «back»…)
├── player-interaction.ts  modo «Controles de Twitch»: flechas → Tab/Mayús+Tab, OK → Enter
├── twitch-*.ts            cuenta (código + tokens) y Helix (seguidos, directos, búsqueda)
├── chat/                  chat por EventSub + emotes de 7TV/BTTV/FFZ + tokenizador
├── local-store.ts         recientes y preferencias (archivo JSON local)
└── ipc.ts                 la única puerta de entrada desde la interfaz
        │  IPC validado con Zod (src/shared)
Preload (src/preload) ── expone window.api, valida lo que entra y lo que sale
        │
Renderer (src/renderer) ── React, sin acceso a Node
├── navigation.tsx         capas, memoria de foco, recuperación del foco perdido
├── App.tsx                pestañas Siguiendo / Buscar / Ajustes y pila Inicio → Reproducción
├── screens/               HomeScreen, SearchScreen, AccountScreen
└── player/                PlayerScreen, useTwitchPlayer (SDK oficial), useChat, ChatPanel
        │
iframe de player.twitch.tv (otro origen; la app no lo toca por dentro)
```

**Regla de oro:** el renderer nunca ve un token. Las llamadas a Twitch con credenciales salen
del proceso principal, y la interfaz recibe datos ya validados.

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
- Si el foco se pierde (el elemento desaparece o estaba en el iframe), la primera tecla solo lo
  recupera y no mueve nada.

## Reproducción

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

`chat/eventsub-chat.ts` mantiene **una** conexión WebSocket con EventSub mientras el chat está
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
| Añadir una tecla del mando | `src/main/input-router.ts` (`actionForKey`) y su prueba |
| Cambiar colores, tamaños o espaciado | `src/renderer/src/styles.css` (variables en `:root`) |
| Añadir una sección a Inicio | `src/renderer/src/data.ts` (`loadHome`) y `screens/HomeScreen.tsx` |
| Otro proveedor de emotes | `src/main/chat/emote-catalog.ts` y el host en `src/shared/chat.ts` y en la CSP de `src/renderer/index.html` |
| Una llamada nueva a Twitch | `twitch-service.ts` → `ipc.ts` → `preload/index.ts` → `shared/contracts.ts` |
