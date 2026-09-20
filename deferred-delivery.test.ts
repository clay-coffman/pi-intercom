import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recipientReady, readHerdrFocus } from "./deferred-delivery.ts";

const context = (extra = {}) => ({
  isIdle: () => true, hasPendingMessages: () => false, hasUI: true,
  ui: { getEditorText: () => "" }, ...extra,
}) as any;

test("deferred safety rejects busy, pending, draft, and unavailable state", () => {
  assert.equal(recipientReady(context()), true);
  assert.equal(recipientReady(context({ isIdle: () => false })), false);
  assert.equal(recipientReady(context({ hasPendingMessages: () => true })), false);
  assert.equal(recipientReady(context({ ui: { getEditorText: () => " " } })), false);
  assert.equal(recipientReady(context({ ui: {} })), false);
  assert.equal(recipientReady(context({ isIdle: () => { throw Error("disposed"); } })), false);
});

test("Herdr focus query is explicit, bounded, and fails closed", async () => {
  const root = mkdtempSync(join(tmpdir(), "intercom-focus-"));
  const binary = join(root, "herdr-fixture");
  const env = { ...process.env, HERDR_ENV: "1", HERDR_SOCKET_PATH: "fixture", HERDR_PANE_ID: "fixture", HERDR_BIN_PATH: binary };
  try {
    for (const focus of [true, false]) {
      writeFileSync(binary, `#!/bin/sh\n[ "$*" = "pane current --current" ] || exit 2\nprintf '%s\\n' '${JSON.stringify({ result: { pane: { focused: focus } } })}'\n`);
      chmodSync(binary, 0o700);
      assert.equal(await readHerdrFocus(env), focus);
    }
    writeFileSync(binary, "#!/bin/sh\nprintf '%s\\n' '{bad json}'\n");
    assert.equal(await readHerdrFocus(env), undefined);
    writeFileSync(binary, "#!/bin/sh\nexit 1\n");
    assert.equal(await readHerdrFocus(env), undefined);
    assert.equal(await readHerdrFocus({ ...env, HERDR_PANE_ID: "" }), undefined);
    assert.equal(await readHerdrFocus({ ...env, HERDR_ENV: "0" }), undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
