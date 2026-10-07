# Bundled component review — 7 October 2026

The identified browser, FFmpeg source-delivery and Xpdf build-provenance findings
are addressed by the current packaging. Keep these checks when updating dependencies.
This records technical distribution evidence, not a legal opinion.

| Component                  | Distribution evidence                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| SCUPA                      | GPL-3.0-or-later LICENSE, NOTICE, source ZIP and build recipe                                                       |
| Electron 44.5.1            | MIT licence and Chromium aggregate notices accompany the runtime                                                    |
| Electron's FFmpeg          | Matching source, Electron patches, Opus source, build materials, LGPL text and DLL provenance in `resources/ffmpeg` |
| Playwright 1.63.0          | Apache LICENSE, NOTICE, ThirdPartyNotices.txt and dependency licences retained in app.asar                          |
| Installed Edge/Chrome      | Launched through supported Playwright channels; no sync browser is distributed                                      |
| Playwright's FFmpeg helper | Not downloaded or packaged; release checks reject the unused recorder                                               |
| Xpdf pdftotext 4.06        | Built from verified unmodified source; source, recipe, GPL texts and build provenance accompany the binary          |

## Electron and FFmpeg

Electron 44.5.1 pins Chromium 152.0.7977.130, whose DEPS pins FFmpeg revision
`2b68d2babae73714846961fb0ee47e3b3d2e39a9`. The installed DLL was compared with
Electron's official Windows x64 ZIP after verifying that ZIP against the official
release checksum manifest. Both contain the same DLL, recorded in `vendor-lock.json`.

`scripts/ffmpeg-source.js` collects and verifies the matching upstream source,
Electron's complete patch series and build scripts, Chromium's FFmpeg build support,
Opus and NASM. Electron's FFmpeg patch applies to the supplied source. The shipped
Windows configuration enables Opus and disables FFmpeg's GPL, GPLv3 and non-free
features. The ordinary Electron release uses Chrome codec branding and a shared
FFmpeg library; its optional Chromium-codec-only download is a different build.

Both binary formats include these sources and their original notices under
`resources/ffmpeg`. Its README explains the pinned upstream build and how to replace
the DLL in the extracted app. NOTICE and release notes identify FFmpeg and
its LGPL terms. SCUPA imposes no reverse-engineering restriction or runtime DLL
hash enforcement. See [FFMPEG.md](FFMPEG.md) for the inventory and build procedure.

This closes the source-delivery finding for the pinned runtime. Electron/FFmpeg
has not been rebuilt locally, and byte-for-byte reproducibility is not claimed.
The build guide requires the upstream dependency checkout and Windows toolchain;
the delivered component sources are not a complete offline Electron SDK.
The approach follows [FFmpeg's source and dynamic-linking guidance](https://ffmpeg.org/legal.html)
and the [pinned Electron release settings](https://github.com/electron/electron/blob/v44.5.1/build/args/release.gn).

## Browser dependency

Sync uses installed Edge, falling back to Chrome, through
[Playwright's supported channels](https://playwright.dev/docs/browsers#google-chrome--microsoft-edge).
Each launch uses a fresh session; SCUPA does not copy the user's browser or profile.
Users install and update their browser through its publisher. Managed browser
policies may prevent automation. Electron's own Chromium runtime remains part of
the desktop app and retains its notices.

## Xpdf

Xpdf's README permits GPL version 2 or 3, not automatically later versions. SCUPA
distributes the unmodified reader under GPL v3, with its source and documentation.
`scripts/build-pdf.ps1` builds the text-only target with optional libraries disabled
and the MSVC runtime linked statically. It does not link Qt, FreeType, libpaper,
lcms or fontconfig. Its direct PE imports are Windows system libraries.
`resources/xpdf/BUILD.json` records the source, compiler, SDK and binary hashes.

## Automated checks

`vendor-lock.json` pins source and binary hashes. `npm run release:check` verifies
the FFmpeg DLL/source pairing, complete source directory, notices, provenance,
Xpdf hashes, exact application/source ZIP contents and release checksums. Tests
reject altered source inputs, manifests and DLLs. CI requires this coverage for
the release build. Private claim archives, personal settings and developer caches are excluded
from the public application source and release artifacts.
