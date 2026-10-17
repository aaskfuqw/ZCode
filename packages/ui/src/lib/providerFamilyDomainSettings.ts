import type { ISettingService } from "@zcode/services";
import {
  type AppSettings,
  type ProviderFamilyConnectionSelectionSettings,
  type ProviderFamilyDomain,
} from "@zcode/shared";

export function resolveLogoutProviderFamilyDomain(params: {
  currentDomain: ProviderFamilyDomain | null | undefined;
}): ProviderFamilyDomain | null {
  void params;
  return null;
}

export async function setProviderFamilyDomain(
  settingService: Pick<ISettingService, "get" | "update">,
  domain: ProviderFamilyDomain,
): Promise<void> {
  const currentSettings = await settingService.get();
  await settingService.update({
    providerFamilyDomain: domain,
    providerFamilyDomainUpdatedAt: Date.now(),
    // OAuth 登录选择当前 family 的个人 Coding Plan，保留其他 family 的连接选择。
    providerFamilyConnectionSelections: buildOAuthProviderFamilySelections(
      domain,
      currentSettings.providerFamilyConnectionSelections,
    ),
  });
}

function buildOAuthProviderFamilySelections(
  domain: ProviderFamilyDomain,
  currentSelections: ProviderFamilyConnectionSelectionSettings | null | undefined,
): ProviderFamilyConnectionSelectionSettings {
  return {
    ...currentSelections,
    [domain]: { kind: "individual-coding-plan" },
  };
}

export async function clearProviderFamilyDomain(
  settingService: Pick<ISettingService, "update">,
): Promise<void> {
  await settingService.update({
    // 清理原因：providerFamilyDomain 通过 RPC 传 undefined 容易被吞掉。
    // settingService 会把空串归一成 undefined，确保退出/解绑后不会继续过滤到旧 domain。
    providerFamilyDomain: "" as AppSettings["providerFamilyDomain"],
    providerFamilyDomainUpdatedAt: Date.now(),
  });
}
