# iLlama Release Strategy

## macOS v1.0

iLlama v1.0 ships as a launcher-only app. It does not bundle `llama-server`.
Users must either install `llama-server` so it is discoverable on `PATH`, or choose
an existing executable from the app.

This is intentional for the first public build. The currently validated local
binary at `/opt/homebrew/bin/llama-server` depends on Homebrew dynamic libraries
under `/opt/homebrew`, so copying only that executable into the app bundle would
produce a package that works on this machine but fails on a clean user's Mac.

## Sidecar Policy

Do not place release sidecars in `src-tauri/binaries/` unless the binary is known
to be relocatable or the required dynamic libraries are bundled and the install
names are fixed. The macOS release script rejects non-placeholder files in that
directory to prevent accidental non-portable releases.

The future bundled-sidecar path is:

1. Build or obtain a notarization-compatible universal or architecture-specific
   `llama-server`.
2. Verify its dynamic library closure with `otool -L`.
3. Bundle required non-system libraries or produce a self-contained binary.
4. Re-sign nested binaries and libraries with Developer ID and hardened runtime.
5. Re-enable bundle resources or Tauri `externalBin` intentionally.
6. Repeat a clean-machine launch test before publishing.

## Signing And Notarization

The release DMG must be built with a Developer ID Application certificate and
submitted to Apple notarization before public distribution.

Expected local prerequisites:

- A valid `Developer ID Application` identity in the login keychain.
- A notarytool keychain profile. The default profile name used by the release
  script is `illama-notary`.

Create the notary profile with:

```bash
xcrun notarytool store-credentials illama-notary \
  --apple-id <apple-id> \
  --team-id <team-id> \
  --password <app-specific-password>
```

Then build, sign, notarize, and staple with:

```bash
APPLE_SIGNING_IDENTITY="Developer ID Application: <Name> (<TEAMID>)" \
APPLE_NOTARY_PROFILE=illama-notary \
npm run release:macos
```

If `APPLE_SIGNING_IDENTITY` is omitted, the script uses the first installed
`Developer ID Application` identity it can find.
