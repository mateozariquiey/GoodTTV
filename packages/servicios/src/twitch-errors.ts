export class ConfigurationError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = "ConfigurationError"
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
