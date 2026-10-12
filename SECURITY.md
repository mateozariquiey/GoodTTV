# Security

Please report vulnerabilities privately through
[GitHub's private vulnerability reporting](https://github.com/mateozariquiey/GoodTTV/security/advisories/new),
not in public issues. English or Spanish is fine.

Useful details: the GoodTTV version and which app (TV or browser extension), how you installed it, what an attacker
could do, and the steps to reproduce it. This is a personal open-source project maintained in spare time, so there is
no guaranteed response time, but reports are taken seriously.

## What GoodTTV protects

**TV app (Electron):**
- **Twitch tokens** live only in the main process. They are encrypted with the system keyring when one is available,
  or stored owner-only (`0600`) otherwise. They never reach the interface.
- **The interface** runs sandboxed, with context isolation and no Node.js. It can only call a small set of validated
  IPC methods, and only from the app's own top-level page, served by a local HTTPS server with a pinned certificate.
- **Twitch's official player**, used only as a fallback, runs in a cross-origin iframe. The app never scripts it.

**Browser extension (Manifest V3):**
- **Twitch tokens** are kept in the extension's own storage (`chrome.storage.local`), **unencrypted**, as the
  Settings screen says. Web pages cannot read it, but anyone with access to your browser profile can.
- **Network access** is limited by the manifest's host permissions to Twitch, the CDNs its video comes from and the
  emote services. The extension loads no remote code.

**Both:**
- **Third-party emote images** are accepted only from Twitch's, 7TV's, BetterTTV's and FrankerFaceZ's CDNs.
- **Only read scopes** are requested when you link your Twitch account: your follows and chat.

Release files come with SHA-256 checksums. They are not cryptographically signed, and the extension is not signed by
Mozilla or published in any store.
