# GoodTTV browser extension

The extension's code is here; what it shares with the other apps is in `packages/`. What it does and how to install it
is in the [main README](../../README.md#browser).

## Building it

The build is reproducible: the same sources give the same files, byte for byte, on Linux x86_64 and arm64.

Requirements: Node.js 24 and [Bun](https://bun.sh) 1.4.2 (`npm install -g bun@1.4.2`). From the repository root:

```bash
bun install --frozen-lockfile
bun run pack:navegador
```

- `apps/navegador/dist/` is the unpacked extension.
- `apps/navegador/out/goodttv-<version>.xpi` is the Firefox package (what is submitted to addons.mozilla.org).
- `apps/navegador/out/goodttv-<version>-chrome.zip` is the Chrome package. Its `manifest.json` leaves out
  `browser_specific_settings` and `background.scripts`, which only Firefox uses; every other file is the same.

To compare with a submitted package, unzip it and compare it with `dist/` (`diff -r`). A package signed by Mozilla
also has a `META-INF/` folder with the signature.

The bundles in `dist/` are made by Vite from the TypeScript and React sources in this folder and in `packages/`, with
the dependencies pinned in `bun.lock`. They are neither minified nor obfuscated. There is no remote code: everything
the extension runs is in the package.

`web-ext lint --self-hosted` gives no errors and these warnings, none from GoodTTV's own code:
- **The Function constructor is eval:** [Zod](https://zod.dev)'s check of whether `eval` is allowed
  (`new Function("")` inside a `try`). The extension's content security policy does not allow it, so Zod never
  evaluates code.
- **Unsafe assignment to innerHTML (two):** React DOM's handling of `dangerouslySetInnerHTML`, which GoodTTV never
  uses.
- **`background.service_worker` is ignored by Firefox:** on purpose. The same manifest gives Chrome a service worker
  and Firefox a background script (`background.scripts`).
- **`data_collection_permissions` needs Firefox for Android 142:** the extension is for desktop browsers.
