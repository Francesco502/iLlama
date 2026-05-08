# Release Checklist

Current release target: `v1.0.0`.

## macOS

- [ ] Confirm no old app/source branding leftovers remain
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `cd src-tauri && cargo test`
- [ ] `cd src-tauri && cargo fmt --check`
- [ ] `cd src-tauri && cargo clippy --all-targets -- -D warnings`
- [ ] Confirm `src-tauri/binaries/` contains no release sidecar except `.gitkeep`
- [ ] `APPLE_SIGNING_IDENTITY="Developer ID Application: <Name> (<TEAMID>)" APPLE_NOTARY_PROFILE=illama-notary npm run release:macos`
- [ ] Confirm `iLlama.app/Contents/MacOS/illama`
- [ ] Confirm the DMG has a stapled notarization ticket
- [ ] Open generated `.app`
- [ ] Add a model directory containing at least one `.gguf`
- [ ] Select model
- [ ] Verify Balanced preset command preview
- [ ] Start with a valid `llama-server`
- [ ] Confirm logs appear
- [ ] Confirm local health status
- [ ] Send one chat message
- [ ] Stop model and confirm process exits
- [ ] Check app remains responsive during streaming output

## Windows

- [ ] `npm test`
- [ ] `npm run build`
- [ ] `cd src-tauri && cargo test`
- [ ] `npm run tauri:build`
- [ ] Open generated installer/app
- [ ] Repeat launch/chat/stop flow with a Windows `llama-server.exe`
- [ ] Verify file paths with spaces
- [ ] Verify port occupied error

## Visual QA

- [ ] Screenshot at `1180x760`
- [ ] Screenshot at `1440x900`
- [ ] Screenshot near `1000px` width
- [ ] No overlapping controls
- [ ] No clipped labels
- [ ] Start/Stop remain obvious
- [ ] UI reads as a native-style desktop utility, not a web dashboard
