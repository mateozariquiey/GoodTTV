import { type RefObject, useCallback, useEffect, useState } from "react"

// Pantalla completa (F): la vista entera, el vídeo y, si se quiere, el chat al lado (desktop.css). El chat a pantalla
// completa va aparte del de la ventana (D33): empieza oculto, como en Twitch, YouTube o Android en horizontal, y C o su
// botón lo enseñan o lo quitan ahí sin tocar el de la ventana. Antes dependía del modo teatro y del chat de la ventana a
// la vez: con el chat oculto en la ventana, F en modo teatro daba solo el vídeo sin que se entendiera por qué.
// Se guarda en el localStorage de la página, como el volumen: la próxima vez, como se dejó.
const KEY = "chat-pantalla-completa"

const storageOf = (): Storage | undefined => {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

export const fullscreenChat = (storage = storageOf()): boolean => {
  try {
    return storage?.getItem(KEY) === "si"
  } catch {
    return false
  }
}

export const chooseFullscreenChat = (on: boolean, storage = storageOf()): void => {
  try {
    storage?.setItem(KEY, on ? "si" : "no")
  } catch {
    // Sin almacenamiento, vale para esta vez.
  }
}

// view: lo que va a pantalla completa. windowChat y onWindowChat: el chat de la ventana (la preferencia de siempre).
// chatShown: si el chat se ve ahora, en la ventana o a pantalla completa.
export const useFullscreen = (
  view: RefObject<HTMLElement | null>,
  windowChat: boolean,
  onWindowChat: (on: boolean) => void,
) => {
  const [fullscreen, setFullscreen] = useState(false)
  useEffect(() => {
    const onChange = (): void => setFullscreen(document.fullscreenElement === view.current)
    document.addEventListener("fullscreenchange", onChange)
    return () => document.removeEventListener("fullscreenchange", onChange)
  }, [view])
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement !== null) void document.exitFullscreen()
    else void view.current?.requestFullscreen()
  }, [view])
  const [chatInFullscreen, setChatInFullscreen] = useState(() => fullscreenChat())
  const toggleChat = useCallback(() => {
    if (!fullscreen) return onWindowChat(!windowChat)
    chooseFullscreenChat(!chatInFullscreen)
    setChatInFullscreen(!chatInFullscreen)
  }, [chatInFullscreen, fullscreen, onWindowChat, windowChat])
  return {
    chatShown: fullscreen ? chatInFullscreen : windowChat,
    fullscreen,
    toggleChat,
    toggleFullscreen,
  }
}
