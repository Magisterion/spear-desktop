# Spear

Spear is an **AI-assisted adaptation of [Pear Desktop](https://github.com/pear-devs/pear-desktop)** for people who grew up in the 1990s with classic desktop music players. It keeps Pear's web music player and plugin ecosystem, with a compact, tray-first desktop experience.

This is an independent fork, not an official Google or YouTube application. Credit for the original application belongs to the Pear contributors. The original MIT license is retained.

## Windows x64, portable by default

Download **YouTube-Music-Spear.exe** from this repository's [Releases](https://github.com/Magisterion/spear-desktop/releases). Put it in a writable folder and run it. There is no installer and no administrator access is required.

Settings, sign-in session, cache and logs live in a **data** folder next to the executable. Keep that folder when upgrading or moving the app. It contains private account data: never commit, publish or share it. Releases are built from tracked source on a clean GitHub Actions runner, not from a developer's local profile.

Manual launches open the player, including the first launch for sign-in. Windows autostart minimizes to the notification area by default; this can be changed in preferences. Single-click the tray icon to play or pause; double-click to open the player. Preferences can swap these actions. An empty queue attempts to start liked songs; right-click for the current track, playback controls, settings and exit. Windows may initially put the icon in the notification area's overflow menu.

## What Spear adds to Pear

- **Classic desktop controls:** compact navigation buttons, a wider default window near the tray, and remembered window placement.
- **Proper preferences:** searchable settings, categorized plugins, language selection, and live changes wherever supported.
- **A richer tray widget:** track information, playback controls, quick access to settings, games and visualizers, a visible exit button, and optional audio-reactive speakers.
- **Retro themes:** eleven original color palettes, including silver decks, phosphor displays and pixel-inspired styles. Shell and music-page themes can be selected separately; the widget follows the shell.
- **More visualizers:** original spectrum, oscilloscope, spectrum history, radial, mirrored, starfield and ribbon modes alongside Pear's existing engines. Compact playback view, fullscreen shortcuts and a right-click mode selector.
- **Night Run:** an original pixel-art runner with track-seeded scenery, audio-reactive motion, two lanes, jumping and an autopilot. Play without music or let your current track bring it to life. Space jumps, arrow keys switch lanes, and Escape returns to the player.
- **Windows portable releases:** one executable, adjacent local data, and updates from this fork with download progress, cancellation and saved verified downloads for later.

Pear's music player and plugin ecosystem remain the foundation. Spear adds the desktop interface and features above; it does not claim authorship of upstream plugins.

## Portable updates

Update checks use **this repository only**. A newer stable release offers a separate, minimizable download window with a Cancel button. Verified downloads survive Later and application restarts, so applying a saved update does not download it again. Spear verifies the release's SHA-256 checksum, stages the replacement locally, waits for the running process to exit and replaces the portable EXE. The old executable is retained as `.previous`; the data folder is preserved. Windows PowerShell is required for replacement. Failed checks leave the current application untouched. Checksums verify download integrity, not publisher identity; builds are not code-signed.

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
- Spear's added Canvas visualizers, Night Run artwork and theme palettes are original implementations under this repository's MIT license. No Winamp skins, logos or proprietary artwork are bundled.

## Verification notes

A successful build is not a substitute for Windows testing. Before promoting a release, verify first launch, Google sign-in, audio, tray interaction, settings, each visualizer, downloads and a real update between two versions. Layout patches depend on the upstream web UI and may need maintenance when it changes.
