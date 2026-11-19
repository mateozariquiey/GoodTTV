import { usePageVisible } from "@goodttv/interfaz"

// Varias pestañas de GoodTTV, cada una con su canal y con su sonido, como las de twitch.tv (D48): ninguna calla ni para
// a las demás, y una que deja de verse sigue sonando. De las otras pestañas, cada una solo mira si está a la vista:
//   - el chat solo se conecta a la vista, porque EventSub admite tres conexiones por cuenta (useChat, connected);
//   - un canal o un vídeo abierto en una pestaña que aún no se ha mirado (con el clic central, o «Abrir en GoodTTV» en
//     segundo plano) no empieza hasta que se mira, para que no suene de golpe lo que nadie ha visto todavía. Desde esa
//     primera vez sigue, también oculta, y lo que abra después sin verse (un VOD que alcanza al directo) empieza ya.

const isVisible = (): boolean => document.visibilityState === "visible"

let seen = isVisible()
document.addEventListener("visibilitychange", () => {
  if (isVisible()) seen = true
})

// Si esta pestaña se ha mirado alguna vez.
export const usePageSeen = (): boolean => {
  const visible = usePageVisible()
  return seen || visible
}

export { usePageVisible }
