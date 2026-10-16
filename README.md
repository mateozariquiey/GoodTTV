# GoodTTV

**English** · [Español](README.es.md)

Twitch without ads, with clients of its own for watching live streams on the TV and in the browser. An Android
version is in development.

> [!WARNING]
> Removing ads breaks Twitch's terms of service. GoodTTV is a personal project: use it at your own risk. It is not in
> any store and has no relationship with Twitch.

| Version | For | Status |
| --- | --- | --- |
| [TV](#tv) (`apps/tele`) | A Linux mini PC connected to the TV, with a remote | 0.2.2; first tests on the mini PC |
| [Browser](#browser) (`apps/navegador`) | Chrome, Chromium, Firefox and Zen, with mouse and keyboard | 0.2.2 |
| [Android](#android) | Phones | In development |

The interfaces are in Spanish for now.

![Extension: the video with its controls on top, the channel info and chat; on the left, followed channels that are live](docs/media/escritorio-canal.jpg)

## How it removes ads

Twitch inserts ads into the stream itself, and each viewer session gets them separately. GoodTTV:
- opens several guest sessions of the same channel at once: the web player's, the embedded player's, the popout's and
  the Android app's;
- takes each video segment from a session that is not showing an ad and splices them together using the sequence
  numbers Twitch gives them;
- if every session is in an ad at the same time, fills the gap with the stream's recording (the VOD) until the
  broadcast is back.

The fill needs the channel's VOD to be public and to arrive in time; otherwise the picture freezes while the break
lasts. Video plays through [hls.js](https://github.com/video-dev/hls.js) in a `<video>` element of its own. There are
three delay modes: Adaptive (the default), No stalls and Live. Chat is delayed as much as the picture, so they stay
roughly in step.

In the extension, across several channels and 12 starts, the first frame arrives in 0.86 s (median) and 0.06 % of
frames are dropped, with no stalls ([details](docs/verificacion.md#rendimiento-del-reproductor-propio), in Spanish).

## TV

Made to be used from the couch on a Linux mini PC with a small remote: arrows, OK, Back and Play/Pause. Watch the live
channels you follow, search for channels, and read chat with **7TV, BTTV, FFZ** and Twitch emotes. There are no VODs,
clips or categories.

![TV home: followed channels that are live and a preview of the focused one](docs/media/inicio.jpg)

From 0.1.0, with Twitch's official player: [playback](docs/media/reproduccion.jpg) ·
[demo video (84 s, remote keys only)](docs/media/demo.mp4) ·
[search with the on-screen keyboard](docs/media/buscar.jpg) · [quality chooser](docs/media/calidad.jpg)

- **Guide-style home.** On the left, the channels you follow that are live, with viewers, category and uptime, then
  channels you watched recently and popular streams. On the right, a large preview of the focused channel.
- **Its own ad-free player.** The video takes the full height, with chat on the right. The title and controls appear
  on top when you press a key and hide by themselves. If the own player fails, you can switch to Twitch's official
  one, with the controls below it. ↑/↓ switch channel without leaving playback, and Play/Pause always works.
- **Read-only chat of its own**, through EventSub. It shows Twitch, 7TV, BTTV and FFZ emotes (global and per channel),
  zero-width emotes, badges and mentions, in two text sizes.
- **Search** with an on-screen keyboard driven by the remote; a physical keyboard works too.
- **Back keeps your place.** Leaving playback returns focus to the channel you came from.
- **Account linking from your phone**, with a QR code or a Twitch code. It only asks for read access: your follows and
  chat.
- **Remote test** in Settings: shows which key each button sends.

| Remote | Action |
| --- | --- |
| Arrows | Move. During playback, ↑/↓ switch channel |
| OK (Enter) | Select |
| Back (Escape, Back, Backspace) | Go back |
| Play/Pause (or Space) | Pause or resume at any time |

**Install:** download the AppImage from the [releases](https://github.com/mateozariquiey/GoodTTV/releases) (Linux
x86_64) and run it; it starts full screen and needs `libfuse2`. To build it:

```bash
bun install --frozen-lockfile
bun run build && bun run start   # in a window, for testing
bun run package:appimage         # apps/tele/dist/GoodTTV-0.2.2-x86_64.AppImage
```

**Status:** [docs/verificacion.md](docs/verificacion.md) (in Spanish) separates what was checked in a lab from what
remains to be tested on the mini PC, the TV and the physical remote. HDMI audio, hardware video decoding, smoothness on
the GMKtec M6 Ultra, the physical remote and suspend/resume are still to be tested.

## Browser

An extension that opens GoodTTV in a tab of its own, with an interface made for mouse and keyboard. The same code
works in Chrome and Firefox.

- **Home** with thumbnails of your followed channels that are live and of popular ones, and "Continue watching".
- **A column of followed channels that are live**, which can be collapsed.
- **Search always at the top** (`/` shortcut). Enter opens the channel with that name.
- **Controls on top of the video**, hidden when the mouse rests: quality, theater mode (`T`), full screen (`F`), chat
  (`C`) and mute (`M`). ↑/↓ switch channel.
- **Starts sooner** if the mouse rests on a channel: it gets it ready.
- **"Abrir en GoodTTV"** (open in GoodTTV) in the context menu of twitch.tv links.
- **Account linking** with a code, as on the TV.
- **Keeps pace in a hidden tab**, even though the browser slows its timers down.

**Install:** it is not in the stores. Download `goodttv-0.2.2.xpi` from the
[releases](https://github.com/mateozariquiey/GoodTTV/releases):
- **Zen** (and Firefox Developer Edition or Nightly): in `about:config`, set `xpinstall.signatures.required` to
  `false`. Then, in `about:addons`, gear menu → "Install Add-on From File…".
- **Firefox:** it only accepts unsigned add-ons temporarily: `about:debugging` → "This Firefox" → "Load Temporary
  Add-on…". It is removed when Firefox closes.
- **Chrome and Chromium:** unzip the `.xpi` (it is a ZIP file) into a folder. In `chrome://extensions`, turn on
  "Developer mode" and click "Load unpacked".

To build it, `bun run build:navegador` (the extension ends up in `apps/navegador/dist`) or `bun run pack:navegador`
(the `.xpi`). More in [docs/desarrollo.md](docs/desarrollo.md#extensión-de-navegador) (in Spanish).

## Android

In development. The interface will run in a WebView, the splicing in JavaScript and the video with Media3, and it will
keep playing with the screen off.

## The code

A monorepo with Bun workspaces:

| Folder | Contents |
| --- | --- |
| `apps/tele` | The TV app (Electron) |
| `apps/navegador` | The extension (Manifest V3) |
| `packages/sin-anuncios` | Session splicing and VOD fill |
| `packages/interfaz` | What the interfaces share: player, chat and data |
| `packages/servicios` | Account, Twitch API (Helix), chat and storage |
| `packages/contratos` | The API types shared by every version |

Requirements: Node.js 24 or later and Bun 1.4.2.

```bash
bun install --frozen-lockfile
bun run verify   # Biome, TypeScript, unit tests and builds
```

The design documents are in Spanish: [architecture](docs/arquitectura.md), [decisions](docs/decisiones.md),
[development](docs/desarrollo.md) and [verification](docs/verificacion.md). Some paths they mention
(`investigacion/`, `herramientas/`, `.lab/`) belong to the working repo and are not published.

## Origin

GoodTTV started as a variant of [VacuumStream](https://github.com/eliottness/VacuumStream) 0.2.1 by Eliott Bouhana,
MIT licensed. This repository keeps its full history. From VacuumStream, the TV app keeps:
- the main process and its security model: isolation, verified IPC and a local HTTPS server with a pinned
  certificate;
- code-based sign-in and the token store;
- the Helix adapter and the Twitch SDK loader;
- the spatial focus algorithm and packaging with electron-builder.

The rest is GoodTTV's own: the TV and desktop interfaces, chat with third-party emotes, the ad-free player and the
extension. The reasons behind each decision are in [docs/decisiones.md](docs/decisiones.md).

## Contributing

Issues and pull requests are welcome, in English or Spanish. See [CONTRIBUTING.md](CONTRIBUTING.md) and, for security
reports, [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE), keeping VacuumStream's original attribution. Twitch is a trademark of Twitch Interactive, Inc. GoodTTV
is not affiliated with or endorsed by Twitch. Third-party emotes are loaded from the public 7TV, BetterTTV and
FrankerFaceZ services.
