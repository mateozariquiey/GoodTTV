# Security

Please report vulnerabilities privately through
[GitHub's private vulnerability reporting](https://github.com/mateozariquiey/GoodTTV/security/advisories/new),
not in public issues. English or Spanish is fine.

Useful details: the GoodTTV version, how you installed it, what an attacker could do, and the
steps to reproduce it. This is a personal open-source project maintained in spare time, so
there is no guaranteed response time, but reports are taken seriously.

## What GoodTTV protects

- **Twitch tokens** live only in the Electron main process. They are encrypted with the system
  keyring when one is available, or stored owner-only (`0600`) otherwise. They never reach the
  interface.
- **The interface** runs sandboxed, with context isolation and no Node.js. It can only call a
  small set of validated IPC methods, and only from the app's own top-level page.
- **Twitch's player** runs in a cross-origin iframe. The app never scripts it. The only input it
  forwards is Tab, Shift+Tab and Enter, in the explicit «Controles de Twitch» mode, and only to
  the focused player frame.
- **Third-party emote images** are accepted only from Twitch's, 7TV's, BetterTTV's and
  FrankerFaceZ's CDNs.

Release AppImages come with SHA-256 checksums. They are not cryptographically signed.
