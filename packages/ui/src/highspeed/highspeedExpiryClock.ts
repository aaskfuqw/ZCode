/** Refresh time-dependent Highspeed styling at expiry and when a suspended window wakes. */

type ExpiryClockWindow = Pick<
  Window & typeof globalThis,
  "setTimeout" | "clearTimeout" | "addEventListener" | "removeEventListener"
>;

type ExpiryClockDocument = Pick<
  Document,
  "visibilityState" | "addEventListener" | "removeEventListener"
>;

export interface HighspeedExpiryClockDeps {
  windowTarget?: ExpiryClockWindow;
  documentTarget?: ExpiryClockDocument;
  now?: () => number;
}

/**
 * 在下一张卡的到期边界唤醒一次 `onExpire`，并在窗口恢复可见/获得焦点时补偿唤醒。
 * 返回 dispose，用于清理定时器与监听（供 React effect 的 cleanup 调用）。
 */
export function armHighspeedExpiryClock(
  nextExpiryMs: number,
  onExpire: () => void,
  deps: HighspeedExpiryClockDeps = {},
): () => void {
  const windowTarget = deps.windowTarget ?? window;
  const documentTarget = deps.documentTarget ?? document;
  const now = deps.now ?? Date.now;

  // +20ms 缓冲确保触发时确实已越过 expiresAt，避免边界抖动导致卡片仍判定为有效。
  const delayMs = Math.max(0, nextExpiryMs - now()) + 20;
  const timer = windowTarget.setTimeout(onExpire, delayMs);

  const catchUpFromWindowWake = () => {
    // 切到隐藏态不补偿（与 SessionPane 同口径）；只在回到前台时追平时钟。
    if (documentTarget.visibilityState === "hidden") return;
    onExpire();
  };
  documentTarget.addEventListener("visibilitychange", catchUpFromWindowWake);
  windowTarget.addEventListener("focus", catchUpFromWindowWake);

  return () => {
    windowTarget.clearTimeout(timer);
    documentTarget.removeEventListener("visibilitychange", catchUpFromWindowWake);
    windowTarget.removeEventListener("focus", catchUpFromWindowWake);
  };
}
