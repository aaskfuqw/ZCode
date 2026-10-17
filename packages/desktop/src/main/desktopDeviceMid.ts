import { createUuid } from "@zcode/shared";
import { ensureBusinessDeviceMid } from "@zcode/shared/node";
import { getAppConfigDir } from "@zcode/services/node";

/** Initialize before constructing clients that require the business device identity. */
export async function ensureDesktopDeviceMid(
  options: {
    configDir?: string;
    createId?: () => string;
  } = {},
): Promise<string> {
  const createId = options.createId ?? createUuid;
  try {
    return await ensureBusinessDeviceMid(options.configDir ?? getAppConfigDir(), createId);
  } catch {
    // Storage failure must not prevent opening a window; this process retains the returned identity.
    return createId();
  }
}
