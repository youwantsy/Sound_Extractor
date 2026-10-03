# Third-party software

Sonora application code is MIT licensed. External programs run as separate processes and retain their own licenses. No third-party tool is modified by this application.

| Component                            | Source / license                                                                                                                            | Distribution                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Electron 44.5.1                      | [electron/electron](https://github.com/electron/electron), MIT; Chromium and other notices                                                  | Electron LICENSE and LICENSES.chromium.html accompany the application                              |
| FFmpeg 9.0 branch, LGPL shared build | [FFmpeg](https://ffmpeg.org/legal.html), LGPL v3; [BtbN build recipes](https://github.com/BtbN/FFmpeg-Builds)                               | Separate EXEs and replaceable shared DLLs in `resources/tools/ffmpeg/bin`; LICENSE.txt is included |
| yt-dlp 2026.08.19                    | [source](https://github.com/yt-dlp/yt-dlp/tree/2026.08.19), Unlicense source; executable bundles additional libraries under their own terms | YT-DLP-LICENSE.txt and YT-DLP-THIRD-PARTY.txt included                                             |
| Node.js 24.17.0                      | [source](https://nodejs.org/dist/v24.17.0/), MIT and bundled notices                                                                        | Separate node.exe and NODE-LICENSE.txt included                                                    |

The exact binary source URLs and upstream SHA-256 checks are in `scripts/fetch-tools.ps1`; downloaded tool identities are recorded in `resources/tools/manifest.json`. FFmpeg is obtained from a Windows build provider linked by the [official FFmpeg download page](https://ffmpeg.org/download.html), not an unrelated executable mirror. The LGPL variant excludes GPL-only codec libraries. MP3 encoding uses libmp3lame.

FFmpeg corresponding source and build instructions: [FFmpeg commit 2a571b6068](https://github.com/FFmpeg/FFmpeg/tree/2a571b6068), [BtbN release/build configuration](https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-09-30-13-08), and dependencies identified by the BtbN `scripts.d` recipes. Users may replace the tool binaries/DLLs with compatible builds; this application does not restrict reverse engineering to debug modifications of LGPL components.

These locally built packages are unsigned evaluation builds. No public binary release or automatic update feed is published. Before redistributing a binary release, retain all upstream notices and supply the complete corresponding source/build materials required by each included license; the application MIT license does not supersede those obligations.

Development-only tooling includes electron-builder (MIT) and Playwright (Apache-2.0). They are not shipped as application dependencies. `@electron/get` is overridden to official 5.1.0 for the builder's download helper to avoid its older HTTP cache dependency; clean installation and actual packaging validate this override.
