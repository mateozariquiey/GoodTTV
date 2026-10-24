# Privacy

GoodTTV is a personal open-source project. Its apps have no servers of their own: nothing you do in them is sent to
the developer, and there are no analytics, ads or trackers. This page describes the browser extension; the Android and
TV apps work the same way.

## What stays on your device

The extension keeps its data in your browser profile, in the extension's own storage. It is not encrypted there.
- **Your Twitch session,** if you link your account: the access and refresh tokens Twitch gives GoodTTV, and your
  account's login, id and granted permissions.
- **Your settings:** the delay mode, chat size and visibility, the order of your followed channels, and the volume.
- **What you have watched:** the channels you opened recently, where you left each VOD, how many minutes you watch each
  channel (only to sort your followed channels; it fades over time), and the last Home screen, to show it at once
  when you open GoodTTV.
- **A cache** of channel profile pictures (kept for a week) and of the connection speed measured on the last VOD.

"Log out" in Settings deletes the Twitch session and the saved Home screen. Removing the extension deletes everything.

## What is sent, and to whom

- **Twitch** (`twitch.tv`, `ttvnw.net`, `live-video.net`, `cloudfront.net`, `jtvnw.net`): the requests needed to play
  streams and VODs, search, and show their chat, as any Twitch player does. If you link your account, its token goes
  with the requests that need it: your followed channels, reading chat and, if you allow it, the messages you write in
  chat and your emotes. Linking uses Twitch's own sign-in page, so GoodTTV never sees your password.
- **7TV, BetterTTV and FrankerFaceZ:** the Twitch id of the channel you open, to load its emotes.

Nothing else is sent anywhere. Twitch's and those services' own privacy policies apply to what they receive.

## Permissions

- **`storage`:** to keep the data above on your device.
- **`contextMenus`:** for "Abrir en GoodTTV" when you right-click a twitch.tv link.
- **Access to the sites listed above:** to play streams and VODs and to load chat and emotes from the extension's own
  tab.

## Contact

Questions or concerns: open an issue at [github.com/mateozariquiey/GoodTTV](https://github.com/mateozariquiey/GoodTTV/issues),
or see [SECURITY.md](SECURITY.md) to report something privately. English or Spanish is fine.
