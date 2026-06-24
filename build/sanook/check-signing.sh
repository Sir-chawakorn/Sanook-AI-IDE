#!/usr/bin/env bash
set -euo pipefail

echo "== Sanook AI IDE signing readiness =="
echo "Host: $(sw_vers -productName 2>/dev/null || uname -s) $(sw_vers -productVersion 2>/dev/null || true)"
echo

echo "-- Developer ID signing identities --"
if command -v security >/dev/null 2>&1; then
  security find-identity -v -p codesigning || true
else
  echo "security CLI not available on this platform"
fi

echo
if command -v xcrun >/dev/null 2>&1; then
  echo "-- notarytool --"
  xcrun notarytool --version || true
else
  echo "xcrun not available"
fi

echo
missing=0
for var in APPLE_ID APPLE_TEAM_ID APPLE_APP_SPECIFIC_PASSWORD; do
  if [[ -z "${!var:-}" ]]; then
    echo "missing env: $var"
    missing=1
  else
    echo "env present: $var"
  fi
done

echo
if [[ $missing -eq 0 ]]; then
  echo "Ready to notarize with Apple ID credentials."
else
  echo "Not ready to notarize yet. Provide Apple Developer ID certificate in Keychain and APPLE_ID / APPLE_TEAM_ID / APPLE_APP_SPECIFIC_PASSWORD env vars."
fi
