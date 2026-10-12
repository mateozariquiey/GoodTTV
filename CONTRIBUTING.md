# Contributing

Thanks for helping make Twitch nicer to watch. Bug reports, testing on real hardware (mini PCs, TVs, remotes, other
browsers) and code are all welcome. Issues can be written in English or Spanish.

> GoodTTV removes Twitch's ads, which breaks Twitch's terms of service (see the README). Contributions are welcome
> on that understanding; please do not open issues asking for store releases.

## Before you start

- Read [docs/arquitectura.md](docs/arquitectura.md) for how the apps are put together and
  [docs/decisiones.md](docs/decisiones.md) for why. Both are in Spanish for now; feel free to ask in an issue.
- For a substantial feature, open an issue first so we can agree on scope. GoodTTV stays small on purpose: live
  channels, search, playback and chat.
- This repository receives one commit per release from the author's working repository, so a merged pull request
  will be carried over into the next release.

## Ground rules

- **The TV app is remote first.** Every task must work with the arrows, OK, Back and Play/Pause. Focus must always be
  visible, and Back must never lose your place.
- **The browser extension is mouse and keyboard first,** with its own desktop screens (`apps/navegador/src/escritorio`).
- **Shared logic lives in `packages/`.** The ad-free splicing (`packages/sin-anuncios`) runs unchanged in Electron and
  in the extension: keep it free of Node and browser-specific APIs, and add tests for any change to it.
- **Nothing covers Twitch's official player** when the TV app falls back to it: Twitch disables autoplay when the
  embed is obscured.
- **Tokens never reach the TV app's renderer.** New IPC goes through `packages/contratos/src/contracts.ts` with Zod
  validation on both sides.
- Never commit tokens, personal profiles or logs. The Client ID in `packages/servicios/src/settings.ts` is public on
  purpose; forks should register their own (see [docs/desarrollo.md](docs/desarrollo.md)).

## Checks

```bash
bun install --frozen-lockfile
bun run verify                       # Biome, strict TypeScript, unit tests, builds
bun run build && bun run test:e2e    # TV app: real app, real key events; needs Xvfb and xdotool
bun run build:navegador && bun run test:interfaz -- --canales channel1,channel2   # extension, Chrome and Firefox
```

Add or update tests when you change behaviour. If you could not test something (hardware, a signed-in account, a
browser), say so in the pull request rather than implying it passed.

## Pull requests

Keep each pull request focused, explain the outcome and how you checked it, and include a screenshot for interface
changes. Contributions are licensed under the project's [MIT license](LICENSE).
