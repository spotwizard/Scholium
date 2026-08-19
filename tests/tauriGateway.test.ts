import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const rust = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
const gateway = readFileSync(new URL("../src/tauriGateway.ts", import.meta.url), "utf8");

const handlerBlock = rust.match(/tauri::generate_handler!\[([\s\S]*?)\]/)?.[1];
assert.ok(handlerBlock, "Tauri command registration should exist");

const registeredCommands = [...handlerBlock.matchAll(/^\s*([a-z0-9_]+),?$/gm)].map(
  (match) => match[1],
);
const gatewayCommands = [...gateway.matchAll(/\binvoke(?:<[^>]+>)?\("([a-z0-9_]+)"/g)].map(
  (match) => match[1],
);

assert.equal(new Set(registeredCommands).size, registeredCommands.length);
assert.equal(new Set(gatewayCommands).size, gatewayCommands.length);
assert.deepEqual([...gatewayCommands].sort(), [...registeredCommands].sort());

const sourceDirectory = new URL("../src/", import.meta.url);
for (const relativePath of readdirSync(sourceDirectory, { recursive: true }) as string[]) {
  if (!/\.[cm]?[jt]sx?$/.test(relativePath) || relativePath === "tauriGateway.ts") continue;

  const source = readFileSync(new URL(relativePath, sourceDirectory), "utf8");
  assert.doesNotMatch(
    source,
    /(?:from\s+["']@tauri-apps\/api\/core["']|\binvoke(?:<[^>]+>)?\()/,
    `${relativePath} must call Tauri through tauriGateway`,
  );
}

console.log(`Tauri gateway coverage (${gatewayCommands.length} commands): PASS`);
