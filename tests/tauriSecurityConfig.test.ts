import assert from "node:assert/strict";
import fs from "node:fs";

type Csp = Record<string, string | string[]>;

const config = JSON.parse(
  fs.readFileSync(
    new URL("../src-tauri/tauri.conf.json", import.meta.url),
    "utf8",
  ),
) as {
  app?: { security?: { csp?: unknown; devCsp?: unknown } };
};
const capability = JSON.parse(
  fs.readFileSync(
    new URL("../src-tauri/capabilities/default.json", import.meta.url),
    "utf8",
  ),
) as {
  permissions?: unknown;
  windows?: unknown;
};

function requireCsp(value: unknown, name: string): Csp {
  assert.ok(
    value && typeof value === "object" && !Array.isArray(value),
    `${name} must be a CSP directive object`,
  );
  return value as Csp;
}

function sources(csp: Csp, directive: string): string[] {
  const value = csp[directive];
  assert.ok(value, `${directive} must be configured`);
  return Array.isArray(value) ? value : value.trim().split(/\s+/);
}

const csp = requireCsp(config.app?.security?.csp, "production CSP");
const devCsp = requireCsp(config.app?.security?.devCsp, "development CSP");

assert.deepEqual(sources(csp, "default-src"), [
  "'self'",
  "customprotocol:",
  "asset:",
]);
assert.deepEqual(sources(csp, "script-src"), ["'self'"]);
assert.deepEqual(sources(csp, "connect-src"), [
  "ipc:",
  "http://ipc.localhost",
]);
assert.deepEqual(sources(csp, "font-src"), ["'self'", "data:"]);
assert.deepEqual(sources(csp, "img-src"), [
  "'self'",
  "data:",
  "blob:",
  "asset:",
  "http://asset.localhost",
  "http:",
  "https:",
]);
assert.deepEqual(sources(csp, "style-src"), [
  "'self'",
  "'unsafe-inline'",
]);
for (const directive of ["object-src", "base-uri", "frame-src"]) {
  assert.deepEqual(sources(csp, directive), ["'none'"]);
}

assert.deepEqual(sources(devCsp, "default-src"), [
  ...sources(csp, "default-src"),
  "http:",
  "ws:",
]);
assert.deepEqual(sources(devCsp, "connect-src"), [
  ...sources(csp, "connect-src"),
  "http:",
  "ws:",
]);
for (const directive of [
  "script-src",
  "font-src",
  "img-src",
  "style-src",
  "object-src",
  "base-uri",
  "frame-src",
]) {
  assert.deepEqual(sources(devCsp, directive), sources(csp, directive));
}

assert.deepEqual(capability.windows, ["main", "scholium-window-*"]);
assert.deepEqual(capability.permissions, [
  "core:event:allow-listen",
  "core:event:allow-unlisten",
  "core:window:allow-is-fullscreen",
  "core:window:allow-scene-identifier",
  "dialog:allow-open",
  "dialog:allow-save",
  "opener:allow-open-url",
  "opener:allow-default-urls",
]);

console.log("Tauri CSP and capability regression: PASS");
