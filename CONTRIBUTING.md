# Contributing

Thanks for helping make Twitch nicer to watch from the couch. Bug reports, testing on real
hardware (mini PCs, TVs, remotes) and code are all welcome. Issues can be written in English or
Spanish.

## Before you start

- Read [docs/arquitectura.md](docs/arquitectura.md) for how the app is put together and
  [docs/decisiones.md](docs/decisiones.md) for why. Both are in Spanish for now; feel free to ask
  in an issue.
- For a substantial feature, open an issue first so we can agree on scope. GoodTTV stays small on
  purpose: live channels, search, playback and chat.

## Ground rules

- **Remote first.** Every task must work with the arrows, OK, Back and Play/Pause. Focus must
  always be visible, and Back must never lose your place.
- **Nothing covers the player.** Twitch disables autoplay, and may revoke embedding, when the
  video is obscured. Controls, notices and chat go beside or below it.
- **Documented Twitch APIs only.** No scripts injected into Twitch's frames, no private
  endpoints, and **no ad blocking or other circumvention** of Twitch's player.
- **Tokens stay in the main process.** The renderer never sees them. New IPC goes through
  `src/shared/contracts.ts` with Zod validation on both sides.
- Never commit tokens, personal profiles or logs. The Client ID in `settings-store.ts` is public
  on purpose; forks should register their own (see [docs/desarrollo.md](docs/desarrollo.md)).

## Checks

```bash
bun install --frozen-lockfile
bun run verify          # Biome, strict TypeScript, unit tests, build
bun run build && bun run test:e2e   # real app, real key events; needs Xvfb and xdotool
```

Add or update tests when you change behaviour. If you could not test something (hardware, a
signed-in account), say so in the pull request rather than implying it passed.

## Pull requests

Keep each pull request focused, explain the outcome and how you checked it, and include a
screenshot for interface changes. Contributions are licensed under the project's
[MIT license](LICENSE).
