#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
test "$(uname -s)" = Darwin
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/scholium-native-menu.XXXXXX")"
trap 'rm -rf "$test_dir"' EXIT

./node_modules/.bin/esbuild tests/nativeMenuFixture.ts --bundle --format=iife \
  --global-name=ContextMenuSelection --outfile="$test_dir/selection.js"
clang -fobjc-arc -framework AppKit -framework WebKit \
  tests/textContextMenu.native.m -o "$test_dir/test-menu"
"$test_dir/test-menu" "$test_dir/selection.js"
