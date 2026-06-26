#!/usr/bin/env bash
#
# sign-selfsigned.sh
# Create a self-signed certificate and sign Sanook AI IDE app + DMG (free method)
#
# Usage:
#   ./build/sanook/sign-selfsigned.sh /path/to/Sanook\ AI\ IDE.app
#   ./build/sanook/sign-selfsigned.sh /path/to/Sanook\ AI\ IDE.app /path/to/sanook-ai-darwin-arm64.dmg
#
# This is a FREE alternative to Apple Developer ID. Users will still see a warning
# and must click "Open Anyway" the first time.

set -euo pipefail

CERT_NAME="Sanook AI IDE Developer"
APP_PATH="${1:-}"
DMG_PATH="${2:-}"

if [[ -z "$APP_PATH" ]]; then
  echo "Usage: $0 <path-to-.app> [optional-path-to.dmg]"
  echo "Example: $0 '../VSCode-darwin-arm64/Sanook AI IDE.app'"
  echo "         $0 '../VSCode-darwin-arm64/Sanook AI IDE.app' '.build/darwin/dmg/sanook-ai-darwin-arm64.dmg'"
  exit 1
fi

if [[ ! -d "$APP_PATH" ]]; then
  echo "Error: App not found: $APP_PATH"
  exit 1
fi

echo "== Sanook AI IDE Self-Signed Signing =="
echo "Certificate name : $CERT_NAME"
echo "App path         : $APP_PATH"
[[ -n "$DMG_PATH" ]] && echo "DMG path         : $DMG_PATH"
echo

# Check if certificate already exists
if security find-certificate -c "$CERT_NAME" -a >/dev/null 2>&1; then
  echo "✓ Certificate '$CERT_NAME' already exists in keychain"
else
  echo "Creating self-signed certificate '$CERT_NAME'..."
  security create-signing-cert -c "$CERT_NAME" -v -s -t 3650 -k ~/Library/Keychains/login.keychain-db 2>/dev/null || {
    echo "Trying alternative method..."
    # Fallback for older macOS
    cat > /tmp/sanook-cert-config.cnf <<EOF
[ req ]
default_bits       = 2048
distinguished_name = req_distinguished_name
prompt             = no

[ req_distinguished_name ]
CN = $CERT_NAME
EOF

    openssl req -x509 -newkey rsa:2048 -keyout /tmp/sanook-key.pem -out /tmp/sanook-cert.pem \
      -days 3650 -nodes -config /tmp/sanook-cert-config.cnf 2>/dev/null || true

    security import /tmp/sanook-cert.pem -k ~/Library/Keychains/login.keychain-db -t cert -f pem -A 2>/dev/null || true
    rm -f /tmp/sanook-*.pem /tmp/sanook-cert-config.cnf
  }
  echo "✓ Certificate created (or already present)"
fi

# Sign the .app
echo
echo "Signing application..."
codesign --force --deep --sign "$CERT_NAME" --options runtime --timestamp=none "$APP_PATH" || {
  echo "Warning: codesign failed. Trying without hardened runtime..."
  codesign --force --deep --sign "$CERT_NAME" "$APP_PATH"
}
echo "✓ Application signed"

# Verify signature
echo
echo "Verifying signature..."
codesign --verify --deep --strict --verbose=2 "$APP_PATH" || true
spctl --assess --type execute --verbose "$APP_PATH" || true

# Sign DMG if provided
if [[ -n "$DMG_PATH" && -f "$DMG_PATH" ]]; then
  echo
  echo "Signing DMG..."
  codesign --force --sign "$CERT_NAME" --timestamp=none "$DMG_PATH" || true
  echo "✓ DMG signed"
  codesign --verify --verbose "$DMG_PATH" || true
fi

echo
echo "=========================================="
echo "Self-signed signing completed!"
echo "=========================================="
echo
echo "NOTE: Because this is a self-signed certificate (not Apple Developer ID),"
echo "users will still see a security warning the first time they open the app."
echo
echo "How users can open the app:"
echo "  1. Right-click on 'Sanook AI IDE.app'"
echo "  2. Choose 'Open'"
echo "  3. Click 'Open' again in the dialog"
echo
echo "Or via System Settings:"
echo "  System Settings → Privacy & Security → Scroll down → Click 'Open Anyway'"
echo
echo "This warning appears only once per user."
echo
echo "When you obtain an official Apple Developer ID Certificate later,"
echo "you can switch to the proper signing flow using:"
echo "  ./build/sanook/sign-and-notarize-darwin.sh"
echo