import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deferredDeliveryMode, humanHoldReason, readHerdrFocus, readHerdrFocusWithRetry, recipientReady,
} from "./deferred-delivery.ts";

const context = (extra = {}) => ({
  isIdle: () => true, hasPendingMessages: () => false, hasUI: true,
  ui: { getEditorText: () => "" }, ...extra,
}) as any;

test("human hold reasons: draft, queued input, unavailable; busy alone is not a hold", () => {
  assert.equal(humanHoldReason(context()), undefined);
  assert.equal(humanHoldReason(context({ isIdle: () => false })), undefined);
  assert.equal(humanHoldReason(context({ hasPendingMessages: () => true })), "pending");
  assert.equal(humanHoldReason(context({ ui: { getEditorText: () => " " } })), "draft");
  assert.equal(humanHoldReason(context({ ui: {} })), "draft");
  assert.equal(humanHoldReason(context({ hasPendingMessages: () => { throw Error("disposed"); } })), "unavailable");
  assert.equal(humanHoldReason(context({ hasUI: false, ui: undefined })), undefined);
});

test("delivery mode follows idleness: busy steers, idle follows up", () => {
  assert.equal(deferredDeliveryMode(context()), "followUp");
  assert.equal(deferredDeliveryMode(context({ isIdle: () => false })), "steer");
  assert.equal(deferredDeliveryMode(context({ isIdle: () => { throw Error("disposed"); } })), undefined);
});

test("manual release readiness still rejects busy, pending, draft, and unavailable state", () => {
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

test("focus retry survives a transient failure, stops on a definite answer, and still fails closed", async () => {
  const env = { HERDR_ENV: "1" } as NodeJS.ProcessEnv;
  const script = (answers: Array<boolean | undefined>) => {
    const calls: number[] = [];
    const read = async () => { calls.push(1); return answers.shift(); };
    return { read, calls };
  };
  let s = script([undefined, false]);
  assert.equal(await readHerdrFocusWithRetry(env, 3, 1, s.read), false);
  assert.equal(s.calls.length, 2);
  s = script([true]);
  assert.equal(await readHerdrFocusWithRetry(env, 3, 1, s.read), true);
  assert.equal(s.calls.length, 1);
  s = script([undefined, undefined, undefined, false]);
  assert.equal(await readHerdrFocusWithRetry(env, 3, 1, s.read), undefined);
  assert.equal(s.calls.length, 3);
  s = script([false]);
  assert.equal(await readHerdrFocusWithRetry({ HERDR_ENV: "0" } as NodeJS.ProcessEnv, 3, 1, s.read), undefined);
  assert.equal(s.calls.length, 0);
});
