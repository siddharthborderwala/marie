#!/bin/sh
# Build Marie, ad-hoc sign it, and install to /Applications (personal use).
set -e
cd "$(dirname "$0")/.."
# Builds now also produce signed updater bundles; use the local updater key if present.
if [ -z "$TAURI_SIGNING_PRIVATE_KEY" ] && [ -f "$HOME/.tauri/marie-updater.key" ]; then
  export TAURI_SIGNING_PRIVATE_KEY="$(cat "$HOME/.tauri/marie-updater.key")"
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
fi
pnpm tauri build --bundles app
SRC=src-tauri/target/release/bundle/macos/Marie.app
codesign --force --deep --sign - --identifier app.marie.viewer "$SRC"
pkill -x marie 2>/dev/null || true
rm -rf /Applications/Marie.app
ditto "$SRC" /Applications/Marie.app
xattr -dr com.apple.quarantine /Applications/Marie.app 2>/dev/null || true
echo "Installed /Applications/Marie.app"
