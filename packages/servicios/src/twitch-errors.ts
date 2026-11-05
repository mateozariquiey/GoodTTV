export class ConfigurationError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = "ConfigurationError"
  }
}

// Helix answered with an error status (after refreshing the token once on 401).
export class TwitchRequestError extends ConfigurationError {
  public constructor(readonly status: number) {
    super(`Twitch ha dado un error ${status}`)
    this.name = "TwitchRequestError"
  }
}

export class SessionChangedError extends Error {
  public constructor() {
    super("La sesión de Twitch ha cambiado durante la operación")
    this.name = "SessionChangedError"
  }
}

export class TwitchUnavailableError extends Error {
  public constructor(status: number) {
    super(`No se puede autenticar con Twitch ahora mismo: error ${status}`)
    this.name = "TwitchUnavailableError"
  }
}
