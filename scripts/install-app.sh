#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="Scholium"
APP_BUNDLE="${APP_NAME}.app"
BUILT_APP="${ROOT_DIR}/src-tauri/target/release/bundle/macos/${APP_BUNDLE}"
INSTALLED_APP="/Applications/${APP_BUNDLE}"
INSTALLED_BINARY="${INSTALLED_APP}/Contents/MacOS/scholium"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

unregister_app_bundle() {
  local app_path="$1"

  if [[ -d "${app_path}" && "${app_path}" != "${INSTALLED_APP}" ]]; then
    "${LSREGISTER}" -u "${app_path}" >/dev/null 2>&1 || true
  fi
}

unregister_noninstalled_scholium_apps() {
  local search_roots=(
    "${ROOT_DIR}/src-tauri/target"
    "${ROOT_DIR}/src-tauri/gen/apple/build"
  )

  if [[ -n "${HOME:-}" ]]; then
    search_roots+=("${HOME}/Library/Developer/Xcode/DerivedData")
  fi

  for search_root in "${search_roots[@]}"; do
    [[ -d "${search_root}" ]] || continue

    while IFS= read -r -d '' app_path; do
      unregister_app_bundle "${app_path}"
    done < <(find "${search_root}" -path "*/${APP_BUNDLE}" -type d -prune -print0)
  done
}

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

unregister_noninstalled_scholium_apps

rm -rf "${INSTALLED_APP}"
ditto "${BUILT_APP}" "${INSTALLED_APP}"
codesign --force --deep --sign - "${INSTALLED_APP}"
unregister_noninstalled_scholium_apps
"${LSREGISTER}" -f "${INSTALLED_APP}"
touch "${INSTALLED_APP}"
open "${INSTALLED_APP}"
sleep 1

pgrep -fl "${INSTALLED_BINARY}" || pgrep -fl scholium || true
