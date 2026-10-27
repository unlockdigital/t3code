#!/bin/zsh
set -euo pipefail

T3_TRIAL_ROOT="${HOME}/Library/Application Support/T3 Code Unlock Digital Trial"
T3_TRIAL_APP="${T3CODE_TRIAL_APP_PATH:-/Applications/T3 Code Unlock Digital Preview.app}"
if [[ ! -d "$T3_TRIAL_APP" ]]; then
  print -u2 'Install the fork preview as /Applications/T3 Code Unlock Digital Preview.app, then run this launcher again.'
  exit 1
fi
T3_TRIAL_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$T3_TRIAL_APP/Contents/Info.plist")"
if [[ "$T3_TRIAL_VERSION" != *-unlock.*-preview.* ]]; then
  print -u2 'The selected application does not identify itself as an Unlock Digital preview.'
  exit 1
fi
T3_TRIAL_EXECUTABLE="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$T3_TRIAL_APP/Contents/Info.plist")"
mkdir -p "$T3_TRIAL_ROOT"
chmod 700 "$T3_TRIAL_ROOT"
export T3CODE_HOME="$T3_TRIAL_ROOT/server"
export T3CODE_DESKTOP_APP_DATA_DIR="$T3_TRIAL_ROOT/desktop"
export T3CODE_TELEMETRY_ENABLED=false
export T3CODE_OTEL_SDK_DISABLED=true
export T3CODE_DISABLE_AUTO_UPDATE=true
unset VITE_DEV_SERVER_URL VITE_HTTP_URL VITE_WS_URL T3CODE_PORT
unset T3CODE_DESKTOP_DEV T3CODE_DESKTOP_DEV_LAUNCH_SCRIPT T3CODE_DESKTOP_DEV_LAUNCH_ACTIVE
exec "$T3_TRIAL_APP/Contents/MacOS/$T3_TRIAL_EXECUTABLE" "$@"
