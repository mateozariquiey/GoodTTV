// Followed channels for Home and reading chat through EventSub. Nothing that writes or moderates.
export const TWITCH_SCOPES = "user:read:follows user:read:chat"
// La extensión y Android también escriben en el chat (CHAT-1, D24). user:read:emotes, para autocompletar los emotes
// de Twitch de la persona más adelante sin volver a pedirle que vincule la cuenta.
export const TWITCH_CHAT_SCOPES = `${TWITCH_SCOPES} user:write:chat user:read:emotes`

type ParsedLiveInput = {
  readonly after?: string | undefined
  readonly first: number
  readonly language?: string | undefined
}

export const createDeviceTokenBody = (
  clientId: string,
  deviceCode: string,
  scopes = TWITCH_SCOPES,
): URLSearchParams =>
  new URLSearchParams({
    client_id: clientId,
    device_code: deviceCode,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    scopes,
  })

export const createLiveSearchParams = (
  input: ParsedLiveInput,
): Readonly<Record<string, string | number>> => ({
  ...(input.after === undefined ? {} : { after: input.after }),
  first: input.first,
  ...(input.language === undefined ? {} : { language: input.language }),
})

export const shouldRefreshResponse = (status: number): boolean => status === 401

export const isAllowedActivationUrl = (value: string): boolean => {
  if (!URL.canParse(value)) return false
  const url = new URL(value)
  return (
    url.origin === "https://www.twitch.tv" &&
    url.pathname === "/activate" &&
    url.username === "" &&
    url.password === ""
  )
}

// Un token que ha caducado, o al que le queda menos de un minuto, ya no se prueba: se renueva directamente.
export const isTokenExpiring = (tokenExpiresAt: string, now: number): boolean =>
  !(now < Date.parse(tokenExpiresAt) - 60_000)

export const isIdentityCacheCurrent = (
  checkedAt: number,
  tokenExpiresAt: string,
  now: number,
): boolean => now - checkedAt < 3_600_000 && now < Date.parse(tokenExpiresAt) - 60_000
