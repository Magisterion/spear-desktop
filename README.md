# Spear

Spear is an **AI-assisted adaptation of [Pear Desktop](https://github.com/pear-devs/pear-desktop)** for people who grew up in the 1990s with classic desktop music players. It keeps Pear's web music player and plugin ecosystem, with a compact, tray-first desktop experience.

This is an independent fork, not an official Google or YouTube application. Credit for the original application belongs to the Pear contributors. The original MIT license is retained.

## Windows x64, portable by default

Download **YouTube-Music-Spear.exe** from this repository's [Releases](https://github.com/Magisterion/spear-desktop/releases). Put it in a writable folder and run it. There is no installer and no administrator access is required.

Settings, sign-in session, cache and logs live in a **data** folder next to the executable. Keep that folder when upgrading or moving the app. It contains private account data: never commit, publish or share it. Releases are built from tracked source on a clean GitHub Actions runner, not from a developer's local profile.

Spear starts in the notification area by default. Single-click the tray icon to play or pause; double-click to open the player. Preferences can swap these actions. An empty queue attempts to start liked songs; right-click for the current track, playback controls, settings and exit. Windows may initially put the icon in the notification area's overflow menu.

## Classic desktop experience

- Dedicated preferences window, searchable settings and categorized plugins.
- Back, forward, home, library and settings buttons in the title bar.
- Compact visualizer above the queue; click for fullscreen and press Escape to return.
- Right-click the visualizer to select Butterchurn, Vudio, Wave, or the original Spear spectrum, oscilloscope and spectrum-history renderers.
- Graphite, green-phosphor and amber display colors, plus upstream custom CSS themes.
- A narrow initial window near the lower-right corner of the work area. User-adjusted size and position are remembered.
- Playback-state tray icons and an inactivity-confirmation plugin for long listening sessions.
- Live updates where plugin lifecycle support permits them. Changes requiring restart are collected in one preferences notice.

## Portable updates

Update checks use **this repository only**. A newer stable release offers to download and restart. Spear verifies the release's SHA-256 checksum, stages the replacement locally, waits for the running process to exit and replaces the portable EXE. The old executable is retained as `.previous`; the data folder is preserved. Windows PowerShell is required for replacement. Failed checks leave the current application untouched. Checksums verify download integrity, not publisher identity; builds are not code-signed.

## Downloads

The downloader uses Pear's upstream YouTube integration. Initialization is retried after failure and refreshed when sign-in cookies change. Service-side changes or restrictions can still prevent downloading. Only download content you have permission to save. No account cookies or downloaded media belong in this repository.

## Development

Node.js 24 and pnpm 11:

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm typecheck
pnpm dist:win:x64
```

Only Windows x64 portable artifacts are published. Branches and pull requests produce build artifacts; successful master builds and `v*` tags publish releases containing the fixed executable name and its checksum. The tag must match the version in `package.json`.

## Credits and licenses

- [Pear Desktop](https://github.com/pear-devs/pear-desktop): original application, MIT.
- Butterchurn, Vudio and Wave retain their upstream licenses and attribution in the bundled dependency notices.
- Spear's three Canvas visualizers are original implementations under this repository's MIT license. No Winamp skins, logos or proprietary artwork are bundled.

## Verification notes

A successful build is not a substitute for Windows testing. Before promoting a release, verify first launch, Google sign-in, audio, tray interaction, settings, each visualizer, downloads and a real update between two versions. Layout patches depend on the upstream web UI and may need maintenance when it changes.
