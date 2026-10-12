import type { ChannelCard, RecentChannel, StreamCard } from "@goodttv/contratos"

// What the player and the lists need to know about a channel, whatever list it came from.
export type Channel = {
  readonly category?: string
  readonly displayName: string
  readonly live?: boolean
  readonly login: string
  readonly profileImageUrl?: string
  readonly startedAt?: string
  readonly thumbnailUrl?: string
  readonly title?: string
  readonly userId?: string
  readonly viewerCount?: number
}

export const fromStream = (stream: StreamCard): Channel => ({
  category: stream.category,
  displayName: stream.userName,
  live: true,
  login: stream.userLogin,
  ...(stream.profileImageUrl === undefined ? {} : { profileImageUrl: stream.profileImageUrl }),
  startedAt: stream.startedAt,
  thumbnailUrl: stream.thumbnailUrl,
  title: stream.title,
  userId: stream.userId,
  viewerCount: stream.viewerCount,
})

export const fromSearch = (card: ChannelCard): Channel => ({
  category: card.category,
  displayName: card.displayName,
  live: card.isLive,
  login: card.login,
  profileImageUrl: card.thumbnailUrl,
  title: card.title,
  userId: card.id,
})

export const fromRecent = (recent: RecentChannel, stream: StreamCard | undefined): Channel =>
  stream === undefined
    ? {
        displayName: recent.displayName,
        live: false,
        login: recent.login,
        ...(recent.profileImageUrl === undefined
          ? {}
          : { profileImageUrl: recent.profileImageUrl }),
        ...(recent.userId === undefined ? {} : { userId: recent.userId }),
      }
    : {
        ...fromStream(stream),
        ...(recent.profileImageUrl === undefined || stream.profileImageUrl !== undefined
          ? {}
          : { profileImageUrl: recent.profileImageUrl }),
      }

export const toRecent = (channel: Channel): RecentChannel => ({
  displayName: channel.displayName.slice(0, 60) || channel.login,
  login: channel.login,
  ...(channel.profileImageUrl === undefined ? {} : { profileImageUrl: channel.profileImageUrl }),
  ...(channel.userId === undefined ? {} : { userId: channel.userId }),
  watchedAt: Date.now(),
})

// Twitch preview URLs end in -{width}x{height}.jpg; ask for a sharper one for large previews.
export const previewAt = (url: string | undefined, width: number, height: number) =>
  url?.replace(/-\d+x\d+\.(jpg|png|webp)$/, `-${width}x${height}.$1`)

export const initials = (name: string): string =>
  name
    .replace(/[^\p{L}\p{N} _]/gu, "")
    .split(/[\s_]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?"
