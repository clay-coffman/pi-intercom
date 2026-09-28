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

/**
 * Focus with bounded retries. A single slow or failed CLI answer under load must
 * not strand an unfocused recipient's queue; a definite answer ends the retries.
 * Still fails closed (undefined) when every attempt is unavailable.
 */
export async function readHerdrFocusWithRetry(
  env: NodeJS.ProcessEnv = process.env,
  attempts = 3,
  delayMs = 250,
  read: (env: NodeJS.ProcessEnv) => Promise<boolean | undefined> = readHerdrFocus,
): Promise<boolean | undefined> {
  if (env.HERDR_ENV !== "1") return undefined;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const focused = await read(env);
    if (typeof focused === "boolean") return focused;
    if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  return undefined;
}

/**
 * Why a held message cannot be injected right now.
 *
 * `draft` and `pending` are signs of a human at the keyboard and always hold.
 * `busy` is not a hold reason on its own: a working recipient that nobody is
 * looking at is reached through Pi's steer queue at the next tool boundary.
 * `unavailable` covers a disposed or throwing context.
 */
export type HoldReason = "draft" | "pending" | "unavailable";

export function humanHoldReason(ctx: ExtensionContext): HoldReason | undefined {
  try {
    if (ctx.hasPendingMessages?.()) return "pending";
    if (ctx.hasUI) {
      const text = ctx.ui.getEditorText?.();
      if (typeof text !== "string" || text.length > 0) return "draft";
    }
    return undefined;
  } catch { return "unavailable"; }
}

/** How a message may be injected once no human hold applies. */
export type DeferredDeliveryMode = "steer" | "followUp";

export function deferredDeliveryMode(ctx: ExtensionContext): DeferredDeliveryMode | undefined {
  try {
    return ctx.isIdle() ? "followUp" : "steer";
  } catch { return undefined; }
}

/**
 * Rechecked immediately before injection, including after an async focus read.
 * True only when the recipient is idle and free of any human hold; used by the
 * explicit release command, which never steers a working turn.
 */
export function recipientReady(ctx: ExtensionContext): boolean {
  try {
    if (!ctx.isIdle()) return false;
    return humanHoldReason(ctx) === undefined;
  } catch { return false; }
}
