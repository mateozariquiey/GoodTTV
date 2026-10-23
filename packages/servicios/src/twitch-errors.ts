export class ConfigurationError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = "ConfigurationError"
  }
}

// Helix answered with an error status (after refreshing the token once on 401).
export class TwitchRequestError extends ConfigurationError {
  public constructor(readonly status: number) {
    super(`Twitch request failed (${status})`)
    this.name = "TwitchRequestError"
  }
}

export class SessionChangedError extends Error {
  public constructor() {
    super("The Twitch session changed while an operation was in progress")
    this.name = "SessionChangedError"
  }
}

export class TwitchUnavailableError extends Error {
  public constructor(status: number) {
    super(`Twitch authentication is unavailable (${status})`)
    this.name = "TwitchUnavailableError"
  }
}
