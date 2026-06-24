#!/usr/bin/env bash
set -euo pipefail

APP_PATH="${1:-../VSCode-darwin-arm64/Sanook AI IDE.app}"
DMG_PATH="${2:-../VSCode-darwin-arm64/Sanook AI IDE.dmg}"
IDENTITY="${APPLE_DEVELOPER_ID_APPLICATION:-}"

if [[ -z "$IDENTITY" ]]; then
  echo "Set APPLE_DEVELOPER_ID_APPLICATION to your Developer ID Application certificate name." >&2
  exit 2
fi
if [[ ! -d "$APP_PATH" ]]; then
  echo "App not found: $APP_PATH" >&2
  exit 2
fi

echo "Signing app: $APP_PATH"
codesign --force --deep --options runtime --timestamp --sign "$IDENTITY" "$APP_PATH"
codesign --verify --deep --strict --verbose=2 "$APP_PATH"
spctl --assess --type execute --verbose=2 "$APP_PATH" || true

if [[ -f "$DMG_PATH" ]]; then
  echo "Signing dmg: $DMG_PATH"
  codesign --force --timestamp --sign "$IDENTITY" "$DMG_PATH"
fi

if [[ -n "${APPLE_ID:-}" && -n "${APPLE_TEAM_ID:-}" && -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" ]]; then
  TARGET="$APP_PATH"
  if [[ -f "$DMG_PATH" ]]; then TARGET="$DMG_PATH"; fi
  echo "Submitting for notarization: $TARGET"
  xcrun notarytool submit "$TARGET" \
    --apple-id "$APPLE_ID" \
    --team-id "$APPLE_TEAM_ID" \
    --password "$APPLE_APP_SPECIFIC_PASSWORD" \
    --wait
  if [[ -f "$DMG_PATH" ]]; then
    xcrun stapler staple "$DMG_PATH"
    xcrun stapler validate "$DMG_PATH"
  else
    xcrun stapler staple "$APP_PATH"
    xcrun stapler validate "$APP_PATH"
  fi
else
  echo "APPLE_ID / APPLE_TEAM_ID / APPLE_APP_SPECIFIC_PASSWORD not set; signed but skipped notarization."
fi
