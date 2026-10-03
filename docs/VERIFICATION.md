# Verification record — 0.1.0

Verified on Windows x64, 2026-10-03. Media used in deterministic tests is generated locally from a solid-color video and a sine wave. No personal media is used or committed.

| Check                                        | Result                                                                                       |
| -------------------------------------------- | -------------------------------------------------------------------------------------------- |
| JavaScript syntax (`npm run check`)          | 14 source/test/tool files passed                                                             |
| Engine and security (`npm test`)             | 21 tests passed                                                                              |
| Development Electron UI (`npm run test:e2e`) | 14 checks passed                                                                             |
| Packaged `dist/win-unpacked/Sonora.exe` UI   | Same 14 checks passed                                                                        |
| Dependency audit (`npm audit`)               | 0 vulnerabilities at verification time                                                       |
| Windows portable + NSIS build                | Both EXEs built successfully                                                                 |
| Code signing                                 | Not signed; evaluation builds                                                                |
| Live YouTube adapter                         | Big Buck Bunny successfully acquired and converted; ffprobe verified MP3, 596.474208 seconds |

ESLint recommended rules passed with explicit browser-evaluation globals and intentional filename-control-character handling. The application is plain JavaScript; no separate TypeScript compiler step applies.

## Engine/security coverage

All four MP3 bitrate choices (128/192/256/320 kbps), codec/duration inspection, original-file preservation, suffix/skip collisions, concurrent atomic commits, damaged media and retry, silent video, active cancellation, immediate cancel/restart, queue reorder/removal, interrupted state recovery, cleanup path boundaries, all-or-nothing file selection, process abort, proxy authentication, canonical URL parsing, spoofed hosts, credentials, command-like input, Windows device filenames, settings enumerations, private/reserved IPs, host suffix boundaries, and restricted-provider error mapping.

## UI coverage

Bundled tools, narrow isolated preload bridge, source and output selection through **stubbed native dialog results**, invalid URL rejection through real IPC, **real local File objects through the drop bridge**, actual conversion, completed history, independent output probing, settings, cancellation/retry, 760px layout, Tab navigation, and no renderer console errors. The desktop screenshot comes from this actual Electron app with a synthetic test file; its output-folder label is changed to a generic label to avoid publishing machine paths.

The OS's native file-dialog controls are not manually automated. A physical drag gesture is not emulated; the real file-to-preload path used by that gesture is exercised. Windows 10, ARM, non-NTFS destinations, prolonged multi-hour workloads, installed NSIS upgrade/uninstall, and code signing were not tested. The installer is built, not installed automatically.

## Live source

Blender Foundation, **Big Buck Bunny**, https://www.youtube.com/watch?v=YE7VzlLtp-4. The film is openly licensed; attribution: © Blender Foundation / www.bigbuckbunny.org. Test output is kept locally and excluded from Git. Live testing used no login, browser cookies, or access-control bypass. One public-video success does not establish universal YouTube compatibility. The deterministic CI suite does not perform this network test.

## Reproduce

```powershell
npm ci
npm run tools
npm run check
npm test
npm run test:e2e
npm run build
$env:SONORA_PACKAGED = (Resolve-Path 'dist/win-unpacked/Sonora.exe').Path
npm run test:e2e
```

Raw local test outputs live under ignored `test-results/`. The build embeds the actual tool version/checksum manifest. `tools-lock.json` fixes the reviewed upstream artifacts, and no media, binaries, or private test profiles are committed.
