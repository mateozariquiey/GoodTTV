// El canal al que lleva una dirección de twitch.tv (www.twitch.tv/<canal>, también /<canal>/videos…), o nada si es
// otra página: directorio, ajustes, búsqueda…
const RESERVED = new Set([
  "activate",
  "directory",
  "downloads",
  "drops",
  "embed",
  "following",
  "friends",
  "inventory",
  "jobs",
  "login",
  "messages",
  "moderator",
  "p",
  "payments",
  "popout",
  "prime",
  "search",
  "settings",
  "signup",
  "store",
  "subscriptions",
  "team",
  "turbo",
  "user",
  "videos",
  "wallet",
])
const HOSTS = new Set(["twitch.tv", "www.twitch.tv", "m.twitch.tv"])

export const channelFromTwitchUrl = (url: string | undefined): string | undefined => {
  if (url === undefined || !URL.canParse(url)) return undefined
  const { hostname, pathname } = new URL(url)
  if (!HOSTS.has(hostname)) return undefined
  const login = (pathname.split("/").find(Boolean) ?? "").toLowerCase()
  return /^[a-z0-9_]{1,25}$/.test(login) && !RESERVED.has(login) ? login : undefined
}
