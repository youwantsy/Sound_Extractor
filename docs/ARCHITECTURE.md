# Architecture and security

## Trust boundaries

The renderer only loads three packaged resources through `sonora://app`: HTML, CSS, and JavaScript. CSP prohibits network connections and inline scripts. Node integration is off; context isolation and sandboxing are on. New windows, navigation, webviews, and permission requests are blocked.

The frozen preload API exposes task-shaped actions. Main verifies the exact WebContents, top-level frame, and URL on every IPC invocation. Native dialogs select input/output paths. Drop paths come from Electron's `webUtils.getPathForFile`, not a renderer-supplied path API. Main applies URL, ID, file type, count, and settings validation again. No raw IPC or executable selection API is exposed.

## Queue and persistence

States: `queued → validating → acquiring (YouTube only) → converting → finalizing → done`. Errors become `failed`; collisions under skip policy become `skipped`; cancellation becomes `canceled` after process termination. Only queued jobs can be reordered. Retries are explicit and increment an attempt counter. One job runs at a time.

Settings and output-folder choices are snapshotted for waiting jobs at Start all. JSON state is atomically replaced in the per-user application-data directory. Full source URLs are omitted; the video ID is retained for retry. No raw process stderr is displayed or persisted. Local source paths are retained privately for retry.

On restart, unfinished jobs are marked interrupted and their owned temporary directories are cleaned. Completed history is retained. A crash immediately after final output commit can leave an intact output while the job is marked interrupted; retry still cannot overwrite that output. An unclean termination can temporarily leave an external worker; the app does not claim an OS-level service supervisor. Normal cancellation and exit wait for the process tree to terminate.

## Sources and network policy

Local input must be a regular supported media file, with bounded size and duration. ffprobe/FFmpeg use a format allowlist and only `file,pipe` protocols, preventing embedded network playlists. They never modify the selected source.

YouTube input is parsed as HTTPS, restricted to exact known YouTube hosts, and normalized to one validated 11-character video ID. Query strings, playlist IDs, credentials, custom ports, shell fragments, and arbitrary destination URLs never become provider options.

yt-dlp runs with configuration/cache ignored, no cookies, no remote components, and an explicit bundled Node runtime. Downloads use direct HTTPS formats and native fetching. Its authenticated loopback proxy permits only reviewed `youtube.com`, `googlevideo.com`, `ytimg.com`, and `youtubei.googleapis.com` host boundaries on port 443. Each tunnel resolves and validates globally routable IPv4, then connects to the validated IP rather than re-resolving. Private/reserved/IPv6 addresses and ordinary HTTP requests are rejected. Redirects requiring a new host must pass the same CONNECT policy. TLS certificate checks remain enabled. Transfer size and process time are bounded.

This is application-level network mediation, not a general OS sandbox for a compromised third-party executable. Only pinned, reviewed tools are shipped. yt-dlp service changes may require allowlist/provider maintenance; the app fails rather than widening the policy automatically.

## Processes and output

Executable locations are fixed by the application. Arguments are arrays with `shell:false`, no shell expansion, and a reduced child environment. Stderr stays internal and errors are mapped to useful Korean messages. Timeouts and AbortControllers use Windows `taskkill /T /F` for owned workers and wait for exit.

Each job creates a unique `.sonora-work-<UUID>` directory in the chosen output folder. MP3 is written as `audio.part`, independently probed, flushed, and then hard-linked to its final normalized name. Hard-link creation is atomic and fails if the destination exists; suffix selection retries that atomic operation. Skip policy preserves the original. Source and destination share a volume. No unsafe copy/overwrite fallback is used on unsupported filesystems.

Temporary cleanup is scoped to the job's recorded directory. Errors leave a visible cleanup warning instead of deleting unrelated paths. Filename normalization removes Windows separators, reserved characters, trailing dots/spaces, and device names. Output filenames are bounded.

## Deliberate omissions

No DRM/paywall bypass, cookie extraction, account login, arbitrary command execution, plugin loading, telemetry, auto updater, playlists, live streams, or public binary publishing. Code signing and broader OS/filesystem coverage remain release work.

## Upstream references

- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security)
- [Node child processes](https://nodejs.org/api/child_process.html)
- [FFmpeg documentation](https://ffmpeg.org/ffmpeg.html)
- [yt-dlp and EJS runtime documentation](https://github.com/yt-dlp/yt-dlp/wiki/EJS)
- [Electron download helper 5.x](https://github.com/electron/get/releases)
