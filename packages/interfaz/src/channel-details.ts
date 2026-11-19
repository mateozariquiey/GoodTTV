import type { ChannelCard, StreamCard } from "@goodttv/contratos"
import { useEffect, useRef, useState } from "react"
import { type Channel, fromSearch, fromStream, toRecent } from "./channel"

// Lo que la extensión y Android hacen con el canal abierto (ChannelView.tsx y pantallas/Canal.tsx): completar sus datos,
// guardarlo en recientes y saber si lo sigues.

// Lo que dice el buscador de un canal, sobre lo que ya se sabía de él. Lo del directo, si ha llegado antes, se queda.
const withCard = (current: Channel, card: ChannelCard): Channel =>
  current.userId === undefined
    ? fromSearch(card)
    : {
        ...current,
        displayName: current.displayName === current.login ? card.displayName : current.displayName,
        profileImageUrl: current.profileImageUrl ?? card.thumbnailUrl,
      }

// Los datos del directo, con la foto que ya hubiera si el directo no la trae.
const withStream = (current: Channel, stream: StreamCard): Channel => {
  const live = fromStream(stream)
  const picture = live.profileImageUrl ?? current.profileImageUrl
  return picture === undefined ? live : { ...live, profileImageUrl: picture }
}

// Un canal abierto por su nombre (la dirección, o abrirlo desde la búsqueda): se completan su nombre, su foto y su id
// (que el chat necesita también sin directo) sin cuenta, y con cuenta, los datos del directo (cuánto lleva).
export const useChannelDetails = (channel: Channel, signedIn: boolean): Channel => {
  const [details, setDetails] = useState(channel)
  useEffect(() => {
    setDetails(channel)
    // Con su id, ya se sabe todo, salvo que su nombre sea solo el login: un reciente guardado mientras llegaban sus datos
    // (antes podía quedarse así), que se corrige.
    if (channel.userId !== undefined && channel.displayName !== channel.login) return undefined
    let active = true
    window.api.catalog
      .channel(channel.login)
      .then((card) => {
        if (active && card !== null) setDetails((current) => withCard(current, card))
      })
      .catch(() => undefined)
    if (signedIn)
      window.api.catalog
        .streamsByLogin([channel.login])
        .then(([stream]) => {
          if (active && stream !== undefined) setDetails((current) => withStream(current, stream))
        })
        .catch(() => undefined)
    return () => {
      active = false
    }
  }, [channel, signedIn])
  return details
}

// A recientes al abrirlo, y otra vez cuando se completan sus datos (con su nombre, su foto e id).
export const useRecentChannel = (details: Channel): void => {
  const latest = useRef(details)
  latest.current = details
  const recentKey = `${details.login}|${details.userId ?? ""}|${details.displayName}`
  // biome-ignore lint/correctness/useExhaustiveDependencies: se guarda al cambiar recentKey, con los datos de ese momento.
  useEffect(() => {
    void window.api.recents.add(toRecent(latest.current))
  }, [recentKey])
}

// SEG-1: si la cuenta sigue el canal; null mientras no se sabe o sin cuenta. Seguir y dejar de seguir, en twitch.tv
// (D24): al volver a la página (a esta pestaña, o a la app tras seguirlo), se mira otra vez.
export const useFollowing = (
  broadcasterId: string | undefined,
  signedIn: boolean,
): boolean | null => {
  const [following, setFollowing] = useState<boolean | null>(null)
  useEffect(() => {
    setFollowing(null)
    const follows = window.api.catalog.follows
    if (!signedIn || broadcasterId === undefined || follows === undefined) return undefined
    let active = true
    const check = (): void => {
      follows(broadcasterId)
        .then((value) => {
          if (active) setFollowing(value)
        })
        .catch(() => undefined)
    }
    check()
    const onVisible = (): void => {
      if (document.visibilityState === "visible") check()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      active = false
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [broadcasterId, signedIn])
  return following
}
