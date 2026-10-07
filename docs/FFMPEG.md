# Electron's FFmpeg source

BUPA SCUPA uses FFmpeg through Electron. FFmpeg is licensed under LGPL-2.1-or-later;
`COPYING.LGPLv2.1` accompanies this document in `resources/ffmpeg`. The library is
the replaceable `ffmpeg.dll` beside the desktop executable. There is no separate
SCUPA EULA restricting modification or reverse engineering.

## What is included

`PROVENANCE.json` records the Electron version, Chromium version, FFmpeg revision,
Windows x64 DLL hash, official Electron ZIP hash and each source download's URL
and SHA-256. The DLL was compared with Electron's official Windows x64 release
archive; SCUPA does not modify it.

Source tarballs use `hashFormat: "tar-content-v1"`: SHA-256 of a sorted JSON list
of each entry's path, type, mode, UID, GID, owner/group names, link target, size
and file-content SHA-256. Archive timestamps and compression are excluded because
upstream regenerates them on download. Duplicate paths are rejected. Other inputs
use SHA-256 of the downloaded bytes. The implementation is `sourceHash` in
`scripts/ffmpeg-source.js`; release checksums cover the final binary downloads byte
for byte.

The source archives contain:

- The complete Chromium FFmpeg tree, including its upstream changes, generated
  Windows configurations, headers, assembler sources and GN build definitions.
- Electron's complete tagged source, including its patch series, patch application
  scripts, release arguments, dependency pins and platform build instructions.
- Chromium's Opus source and GN definitions. FFmpeg links Opus into this DLL.
- Chromium's build scripts, buildtools, Clang setup scripts and Windows export-stub
  generator, plus NASM source and build integration.
- Chromium's root build definitions, dependency manifest and licence, and
  Electron's official release checksum manifest.

The `checkout` fields in `PROVENANCE.json` identify where each input belongs in
an upstream checkout. Electron's tarball has an `electron-44.5.1/` enclosing
directory; the Chromium and FFmpeg tarballs have no enclosing directory.
Preserve every archive and its notices when redistributing the app. Sources
travel inside both the portable EXE and the extracted-app ZIP, so they are
available from the same download as the binary.

## Build or modify the library

These are the upstream source and build instructions for the shipped component,
not a claim of a byte-for-byte reproducible build. SCUPA uses Electron's prebuilt
runtime and has not rebuilt Electron or FFmpeg locally. Compiler, SDK and profile
differences can change the resulting bytes.

Use a separate build workspace. Electron's build system needs a full pinned
Chromium dependency checkout, Git, Node, Python, depot_tools and the Windows C++
toolchain. Allow substantial disk space and network access for that checkout;
the source bundle is not a complete offline Electron SDK. The matching upstream
instructions are in the Electron archive at
`docs/development/build-instructions-windows.md` and `build-instructions-gn.md`.

1. Extract the Electron source archive to inspect those instructions and the
   release settings. Configure depot_tools to use the installed Windows toolchain
   with `DEPOT_TOOLS_WIN_TOOLCHAIN=0`.
2. From a new workspace, configure and sync the exact release:

   ```powershell
   gclient config --name "src/electron" --unmanaged https://github.com/electron/electron
   gclient sync --revision src/electron@v44.5.1 --with_branch_heads --with_tags
   ```

   This resolves Chromium 152.0.7977.130 and FFmpeg revision
   `2b68d2babae73714846961fb0ee47e3b3d2e39a9` from the included DEPS manifests.
   Electron's hooks apply `patches/config.json`, including the FFmpeg patch series.
   The sole FFmpeg patch changes a macOS install name; retain it even for a Windows
   build. All patches and their application scripts are in the Electron archive.

3. Use the supplied archives as the source reference for the matching checkout.
   FFmpeg's release configuration is `chromium/config/Chrome/win/x64`, with
   `CONFIG_GPL=0`, `CONFIG_GPLV3=0`, `CONFIG_NONFREE=0` and `CONFIG_LIBOPUS=1`.
   Electron's ordinary release uses `ffmpeg_branding="Chrome"`,
   `proprietary_codecs=true` and `is_component_ffmpeg=true`. Do not substitute
   `electron/build/args/ffmpeg.gn`: that selects Electron's different, optional
   Chromium-codec-only download.
4. In `src`, create `out/Release/args.gn` containing:

   ```gn
   import("//electron/build/args/release.gn")
   target_cpu = "x64"
   ```

   Generate and build the library using the tools supplied by the pinned checkout:

   ```powershell
   gn gen out/Release
   autoninja -C out/Release ffmpeg
   ```

   This uses the FFmpeg GN source lists and pre-generated configuration, rather
   than running FFmpeg's generic configure script with guessed options. Opus,
   NASM and the export-stub generator are built or invoked by those targets.

5. For a modified compatible build, close SCUPA, back up the extracted app's
   `ffmpeg.dll`, and replace it with the resulting DLL. Use the extracted-app ZIP
   for this; the portable launcher recreates its runtime on every launch.
   The replacement must preserve the expected ABI and exported functions.
   SCUPA performs no runtime DLL hash check; its hash checks apply only when
   preparing and validating the original release.

## Verify a SCUPA release

`node scripts/ffmpeg-source.js` downloads only the locked inputs and prepares
`vendor/ffmpeg`. Packaging includes that directory unchanged. `npm run
release:check` rejects a changed DLL, source archive, provenance manifest or
build guide, and confirms that the tested ZIP contains those same files.

When updating Electron, review its DEPS, FFmpeg/Opus changes, patches and build
settings, verify the new DLL against the official Electron archive, and update
the pins deliberately. Do not regenerate hashes blindly or reuse this source
package with a different Electron version.
