import type { ChatEmoteGroups } from "@goodttv/contratos"
import { useEffect, useState } from "react"
import { NO_EMOTES } from "./emote-complete"

type Loaded = { readonly groups: ChatEmoteGroups; readonly load: () => Promise<ChatEmoteGroups> }

// Los emotes que se pueden escribir en el canal (CHAT-1), pedidos la primera vez que hacen falta («wanted»: al ir a
// escribir), no al abrir el canal: la mayoría de las visitas no escriben. Otro canal (otra «load»), otra lista.
export const useChatEmotes = (
  load: (() => Promise<ChatEmoteGroups>) | undefined,
  wanted: boolean,
): ChatEmoteGroups => {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const current = loaded !== null && loaded.load === load
  useEffect(() => {
    if (!wanted || load === undefined || current) return undefined
    let active = true
    load()
      .then((groups) => {
        if (active) setLoaded({ groups, load })
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [current, load, wanted])
  return current ? loaded.groups : NO_EMOTES
}
