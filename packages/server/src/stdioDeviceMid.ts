import { ensureDeviceMid } from "@zcode/services/node";

export interface EnsureRemoteServerDeviceMidOptions {
  /** 仅测试注入；生产固定使用 services 的 ensureDeviceMid。 */
  ensureDeviceMid?: () => Promise<string>;
  log: (...args: unknown[]) => void;
}

/** Remote entitlement requests require the same stable business identity as the local CLI. */
export async function ensureRemoteServerDeviceMid(
  options: EnsureRemoteServerDeviceMidOptions,
): Promise<string | undefined> {
  const ensureIdentity = options.ensureDeviceMid ?? ensureDeviceMid;
  try {
    return await ensureIdentity();
  } catch (error) {
    options.log(
      "business deviceMid 初始化失败，ZCode endpoint 请求将不带 X-Device-Mid:",
      error instanceof Error ? error.message : String(error),
    );
    return undefined;
  }
}
