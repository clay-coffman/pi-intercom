import { execFile } from "node:child_process";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** No user text is sent to Herdr. Unknown focus fails closed. */
export function readHerdrFocus(env: NodeJS.ProcessEnv = process.env): Promise<boolean | undefined> {
  if (env.HERDR_ENV !== "1") return Promise.resolve(undefined);
  if (!env.HERDR_PANE_ID || !env.HERDR_SOCKET_PATH) return Promise.resolve(undefined);
  return new Promise(resolve => {
    execFile(env.HERDR_BIN_PATH || "herdr", ["pane", "current", "--current"], {
      env, encoding: "utf8", timeout: 1500, maxBuffer: 256 * 1024, shell: false,
    }, (error, stdout) => {
      if (error) return resolve(undefined);
      try {
        const focused = JSON.parse(stdout)?.result?.pane?.focused;
        resolve(typeof focused === "boolean" ? focused : undefined);
      } catch { resolve(undefined); }
    });
  });
}

/** Rechecked immediately before injection, including after an async focus read. */
export function recipientReady(ctx: ExtensionContext): boolean {
  try {
    if (!ctx.isIdle() || ctx.hasPendingMessages?.()) return false;
    if (ctx.hasUI) {
      const text = ctx.ui.getEditorText?.();
      if (typeof text !== "string" || text.length > 0) return false;
    }
    return true;
  } catch { return false; }
}
