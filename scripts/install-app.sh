#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="Scholium"
APP_BUNDLE="${APP_NAME}.app"
BUILT_APP="${ROOT_DIR}/src-tauri/target/release/bundle/macos/${APP_BUNDLE}"
INSTALLED_APP="/Applications/${APP_BUNDLE}"
INSTALLED_BINARY="${INSTALLED_APP}/Contents/MacOS/scholium"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

if [[ "${INSTALLED_APP}" != "/Applications/Scholium.app" ]]; then
  echo "Refusing to replace unexpected app path: ${INSTALLED_APP}" >&2
  exit 1
fi

export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/opt/rustup/bin:${PATH}"

cd "${ROOT_DIR}"
npm run tauri build -- --bundles app

osascript -e "tell application \"${APP_NAME}\" to quit" >/dev/null 2>&1 || true
sleep 1

if [[ ! -d "${BUILT_APP}" ]]; then
  echo "Built app not found: ${BUILT_APP}" >&2
  exit 1
fi

rm -rf "${INSTALLED_APP}"
ditto "${BUILT_APP}" "${INSTALLED_APP}"
codesign --force --deep --sign - "${INSTALLED_APP}"
"${LSREGISTER}" -f "${INSTALLED_APP}"
touch "${INSTALLED_APP}"
open "${INSTALLED_APP}"
sleep 1

pgrep -fl "${INSTALLED_BINARY}" || pgrep -fl scholium || true
