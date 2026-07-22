import assert from "node:assert/strict";
import { documentTabIdsAfterClosingOthers } from "../src/documentTabs.ts";

assert.deepEqual(
  documentTabIdsAfterClosingOthers(["first", "second", "third"], "second"),
  ["second"],
);
assert.deepEqual(documentTabIdsAfterClosingOthers(["first"], "missing"), ["first"]);
console.log("document tab close-others regression: PASS");
