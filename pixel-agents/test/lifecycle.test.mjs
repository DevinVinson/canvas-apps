import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
test("self-contained bundle registers only its manifest page and returns unregister cleanup", async () => {
  const code = fs.readFileSync(
    new URL("../extension.js", import.meta.url),
    "utf8",
  );
  const meta = JSON.parse(
    fs.readFileSync(new URL("../build-meta.json", import.meta.url), "utf8"),
  );
  assert.equal(Object.keys(meta.outputs).length, 1);
  assert.equal(meta.outputs["extension.js"].imports.length, 0);
  const module = await import(
    "data:text/javascript;base64," + Buffer.from(code).toString("base64")
  );
  let cleaned = false;
  const pages = [];
  const dispose = module.activate({
    registerPage: (id, mount) => {
      pages.push(id);
      assert.equal(typeof mount, "function");
      return () => (cleaned = true);
    },
  });
  assert.deepEqual(pages, ["office"]);
  dispose();
  assert.equal(cleaned, true);
});
