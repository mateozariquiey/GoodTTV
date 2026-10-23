// Los VOD (VOD-1; la extensión y Android, D24). Los da @goodttv/sin-anuncios (vods.ts), como invitado; aquí, la forma
// con la que llegan a la interfaz por window.api.vods.

export type VideoKind = "archive" | "highlight" | "upload"

export type VideoCard = {
  readonly id: string
  readonly title: string
  readonly seconds: number
  readonly createdAt: string // ISO
  readonly views: number
  readonly kind: VideoKind
  readonly category: string | null
  readonly thumbnail: string | null // 320 × 180
  readonly storyboard: string | null // las miniaturas de la barra (info.json)
}

export type VideoOwner = {
  readonly id: string
  readonly login: string
  readonly displayName: string
  readonly avatar: string | null
}

export type VideoList = { readonly owner: VideoOwner; readonly videos: readonly VideoCard[] }
export type VideoDetail = VideoCard & { readonly owner: VideoOwner }

// Las miniaturas de la barra: hojas de cols × rows imágenes, una cada «interval» s.
export type Storyboard = {
  readonly cols: number
  readonly rows: number
  readonly width: number
  readonly height: number
  readonly interval: number
  readonly count: number
  readonly sheets: readonly string[]
}

export type ReplayInput = {
  readonly videoId: string
  readonly channelId: string // para los emotes y las insignias del canal
  readonly offset: number // s
}

// La emisión en curso y su VOD (DVR-1); null si no emite.
export type LiveArchive = {
  readonly startedAt: string // ISO
  readonly archiveId: string | null // null si el canal no guarda sus emisiones
  readonly recordedAt: string | null // ISO
}
