import { z } from "zod";
import { REMOTE_ASSET_INSTALL_MODES } from "./remoteAssetInstallMode.js";
import { wslUserSchema } from "./wslUserValidation.js";
import { ZCODE_ENABLED_AGENT_PROVIDERS } from "./zcode-agent-policy.js";
import { DYNAMIC_WORKFLOW_MODES } from "./dynamic-workflow-feature.js";
import { normalizeZCodeEndpointOrigin } from "./zcodeEndpoint.js";
import {
  DEFAULT_EMBEDDED_BROWSER_VIEWPORT_PREFERENCE,
  embeddedBrowserViewportPreferenceSchema,
} from "./browser-use/command-metadata.js";
import { providerFamilyConnectionSelectionSettingsSchema } from "./provider-family-connection-selection.js";

/** 引导职业枚举；单独导出供 onboarding 记录回填 settings 时做窄化校验。 */
const appSettingsOccupationSchema = z.enum([
  "office",
  "developer",
  "independent",
  "infrastructure",
  "product",
  "design",
  "student",
  "creator",
  "operations",
  "marketing",
  "finance",
  "accounting",
  "legal",
  "other",
]);
export const appSettingsOccupationEnum = appSettingsOccupationSchema;

const nonEmptyStringSchema = z.string().trim().min(1);

export const localeSchema = z.enum(["zh-CN", "en-US"]);
const localePreferenceSchema = z.enum(["system", "zh-CN", "en-US"]);
const zcodeInteractionBehaviorSchema = z.enum(["queue", "guide"]);
// launch.md「The user's choice」：读文件时未知取值（降级后读到新版本写的值）按「跟随」处理，
// 不能让一个偏好字段把整份设置读坏。
const dynamicWorkflowModeSettingSchema = z.enum(DYNAMIC_WORKFLOW_MODES).optional().catch(undefined);
const desktopZoomLevelSchema = z.number().int().min(-3).max(5);
const desktopWindowSizeSchema = z.object({
  width: z.number().int().min(480),
  height: z.number().int().min(640),
  maximized: z.boolean(),
});
export const integratedTerminalShellSelectionSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("auto"),
  }),
  z.object({
    mode: z.literal("shell"),
    dialect: z.enum(["cmd", "git-bash"]),
    id: nonEmptyStringSchema,
    label: nonEmptyStringSchema,
    path: nonEmptyStringSchema,
  }),
]);
const enabledBuiltinAgentCliProvidersSchema = z
  .array(z.enum(ZCODE_ENABLED_AGENT_PROVIDERS))
  // The current runtime always enables its single built-in Agent.
  .transform(() => [...ZCODE_ENABLED_AGENT_PROVIDERS]);
const providerFamilyDomainSchema = z.enum(["zai", "bigmodel"]);

const currentSettingsInputSchema = z.unknown().superRefine((value, context) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const raw = value as Record<string, unknown>;
  const obsoleteAccount =
    !Object.hasOwn(raw, "providerFamilyConnectionSelections") &&
    (Object.hasOwn(raw, "modelProviderFamilySelectedKeys") ||
      Object.hasOwn(raw, "modelProviderFamilyModes"));
  const obsoleteLocale =
    localeSchema.safeParse(raw.locale).success && !Object.hasOwn(raw, "localePreference");
  const obsoleteProviders =
    Array.isArray(raw.enabledBuiltinAgentCliProviders) &&
    raw.enabledBuiltinAgentCliProviders.some((provider) =>
      ["claude", "opencode", "gemini", "codex"].includes(provider),
    );
  const obsoleteWorkspace =
    Object.hasOwn(raw, "lastOpenTabs") ||
    Object.hasOwn(raw, "remoteWorkspaceHistory") ||
    (Array.isArray(raw.lastWorkspaceSession) &&
      raw.lastWorkspaceSession.some((entry: unknown) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
        const session = entry as Record<string, unknown>;
        if (session.kind !== "remote") return false;
        if (Object.hasOwn(session, "historyId")) return true;
        const target = session.target;
        return (
          target !== null &&
          typeof target === "object" &&
          "kind" in target &&
          target.kind === "ssh" &&
          Object.hasOwn(target, "resourcePackages")
        );
      }));
  if (obsoleteAccount || obsoleteLocale || obsoleteProviders || obsoleteWorkspace) {
    context.addIssue({
      code: "custom",
      message:
        "Unsupported historical AppSettings format; reset the affected settings file manually",
      params: { incompatibleSettingsFormat: true },
    });
  }
});

const remoteWorkspaceTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ssh"),
    host: nonEmptyStringSchema,
    port: z.number().int().positive().max(65535).optional(),
    username: nonEmptyStringSchema,
    sshConfigAlias: nonEmptyStringSchema.optional(),
    privateKeyPath: z.string().optional(),
    assetInstallMode: z.enum(REMOTE_ASSET_INSTALL_MODES).optional(),
    passwordCredentialKey: nonEmptyStringSchema.optional(),
    privateKeyPassphraseCredentialKey: nonEmptyStringSchema.optional(),
  }),
  z.object({
    kind: z.literal("wsl"),
    distro: z.string().optional(),
    // 远程历史重连会直接使用 settings 中的 WSL user，必须和连接入口共用校验，避免绕过 UI 后污染 identity/日志。
    user: wslUserSchema.optional(),
  }),
  z.object({
    kind: z.literal("docker"),
    container: nonEmptyStringSchema,
  }),
  z.object({
    kind: z.literal("server"),
    url: z.string().url(),
    name: nonEmptyStringSchema.optional(),
    workspacePath: z.string().optional(),
    serverId: nonEmptyStringSchema.optional(),
    tokenCredentialKey: nonEmptyStringSchema.optional(),
  }),
]);

const appWorkspaceSessionEntrySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("local"),
    workspacePath: nonEmptyStringSchema,
    workspacePurpose: z.enum(["project", "conversation"]).default("project"),
  }),
  z.object({
    kind: z.literal("remote"),
    workspacePath: nonEmptyStringSchema,
    localWorkspacePath: nonEmptyStringSchema.optional(),
    workspaceIdentity: nonEmptyStringSchema.optional(),
    target: remoteWorkspaceTargetSchema,
    lastOpenedAt: z.number().int().nonnegative(),
    lastConnectionStatus: z.enum(["connected", "failed"]),
    lastConnectionError: z.string().optional(),
  }),
]);

const webRemoteControlExternalRelayDeviceSchema = z.object({
  deviceSid: nonEmptyStringSchema,
});
const webRemoteControlLastEnabledContextSchema = z.object({
  workspacePath: nonEmptyStringSchema,
  workspaceIdentity: nonEmptyStringSchema.optional(),
  initialTaskId: nonEmptyStringSchema.optional(),
});
const zcodeEndpointOriginSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    return normalizeZCodeEndpointOrigin(trimmed);
  } catch {
    return undefined;
  }
}, z.string().optional());

function sanitizeZCodeEndpointOrigin(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const raw = value as Record<string, unknown>;
  if (!("zcodeEndpointOrigin" in raw)) {
    return value;
  }
  const parsed = zcodeEndpointOriginSchema.safeParse(raw.zcodeEndpointOrigin);
  if (parsed.success && typeof parsed.data === "string") {
    return { ...raw, zcodeEndpointOrigin: parsed.data };
  }
  const { zcodeEndpointOrigin: _zcodeEndpointOrigin, ...next } = raw;
  // 非生产 endpoint override 是开发辅助字段，坏值只丢弃该字段，不能拖垮整个 settings 读取。
  return next;
}

function sanitizeDesktopWindowSize(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const raw = value as Record<string, unknown>;
  if (!("desktopWindowSize" in raw)) {
    return value;
  }
  const parsed = desktopWindowSizeSchema.safeParse(raw.desktopWindowSize);
  if (parsed.success) {
    return value;
  }
  const { desktopWindowSize: _desktopWindowSize, ...next } = raw;
  // 窗口尺寸是非关键偏好，坏值若参与整份 schema 校验，会让其他合法设置全部回退默认。
  // 读取历史设置时只丢弃损坏字段；写入 patch 仍保持严格校验，避免继续产生坏数据。
  return next;
}

function sanitizeEmbeddedBrowserViewportPreference(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const raw = value as Record<string, unknown>;
  if (!("embeddedBrowserViewportPreference" in raw)) {
    return value;
  }
  const parsed = embeddedBrowserViewportPreferenceSchema.safeParse(
    raw.embeddedBrowserViewportPreference,
  );
  if (parsed.success) {
    return value;
  }
  const { embeddedBrowserViewportPreference: _embeddedBrowserViewportPreference, ...next } = raw;
  // 显示偏好不是关键启动状态，单字段损坏不应让整份 setting.json 被隔离。
  // 读取时只丢弃坏偏好并回到默认值；patch 写入仍严格拒绝非法尺寸与缩放。
  return next;
}

const appSettingsObjectSchema = z.object({
  recentProjects: z.array(z.string()).default([]),
  locale: localeSchema.default("zh-CN"),
  // 快捷键用户覆盖（语义校验在 ui/src/shortcuts 生效表阶段容错，schema 只管形状）
  shortcutBindings: z.record(z.string(), z.array(z.string())).optional(),
  localePreference: localePreferenceSchema.default("system"),
  terminalInheritSystemProfile: z.boolean().default(true),
  terminalFontFamily: nonEmptyStringSchema.optional(),
  integratedTerminalShell: integratedTerminalShellSelectionSchema.optional(),
  httpProxy: nonEmptyStringSchema.optional(),
  httpProxyNoProxy: nonEmptyStringSchema.optional(),
  httpProxyCaCertPath: nonEmptyStringSchema.optional(),
  embeddedBrowserAllowInsecureCertificates: z.boolean().default(false),
  embeddedBrowserViewportPreference: embeddedBrowserViewportPreferenceSchema.default(
    DEFAULT_EMBEDDED_BROWSER_VIEWPORT_PREFERENCE,
  ),
  // 输入框电脑操作入口改为默认不展示，设置项保留、默认关闭。
  // default 只对缺省字段生效，显式存过 false 的用户仍保持展示。
  computerUseComposerEntryHidden: z.boolean().default(true),
  taskAutoArchiveEnabled: z.boolean().default(false),
  taskAutoArchiveOlderThanDays: z.number().int().positive().max(365).default(7),
  closeToTrayOnWindows: z.boolean().optional(),
  keepAwakeWhileRunning: z.boolean().default(false),
  desktopZoomLevel: desktopZoomLevelSchema.optional(),
  desktopWindowSize: desktopWindowSizeSchema.optional(),
  desktopChromiumHardwareAccelerationEnabled: z.boolean().default(true),
  messageStreamShowReasoning: z.boolean().default(true),
  messageStreamShowTodos: z.boolean().default(false),
  toolGroupingExploreEnabled: z.boolean().default(true),
  toolGroupingTerminalEnabled: z.boolean().default(true),
  toolGroupingChangesEnabled: z.boolean().default(false),
  zcodeInteractionBehavior: zcodeInteractionBehaviorSchema.default("queue"),
  askUserQuestionAutoResolutionEnabled: z.boolean().default(true),
  modelIoFullRetentionEnabled: z.boolean().default(false),
  dynamicWorkflowMode: dynamicWorkflowModeSettingSchema,
  enabledBuiltinAgentCliProviders: enabledBuiltinAgentCliProvidersSchema.default([
    ...ZCODE_ENABLED_AGENT_PROVIDERS,
  ]),
  providerFamilyConnectionSelections: providerFamilyConnectionSelectionSettingsSchema.default({}),
  providerFamilyDomain: providerFamilyDomainSchema.optional(),
  providerFamilyDomainUpdatedAt: z.number().int().nonnegative().optional(),
  nativeSearchEnhancementsEnabled: z.boolean().default(true),
  onboardingOccupation: appSettingsOccupationSchema.nullish(),
  proactiveSuggestionsEnabled: z.boolean().optional(),
  memoryEnabled: z.boolean().default(false),
  lastWorkspaceSession: z.array(appWorkspaceSessionEntrySchema).default([]),
  lastActiveTabIndex: z.number().int().nonnegative().default(0),
  lastActiveTaskByWorkspace: z.record(z.string(), z.string()).optional(),
  dataBaseDir: z.string().trim().min(1).optional(),
  settingsSyncFirstRunPromptHandled: z.boolean().optional(),
  webRemoteControlExternalRelayDevice: webRemoteControlExternalRelayDeviceSchema.optional(),
  webRemoteControlLastEnabledContext: webRemoteControlLastEnabledContextSchema.optional(),
  zcodeEndpointOrigin: zcodeEndpointOriginSchema.optional(),
});

export const appSettingsSchema = currentSettingsInputSchema.pipe(
  z.preprocess(
    (value) =>
      sanitizeEmbeddedBrowserViewportPreference(
        sanitizeDesktopWindowSize(sanitizeZCodeEndpointOrigin(value)),
      ),
    appSettingsObjectSchema,
  ),
);

export const appSettingsPatchSchema = z.object({
  recentProjects: z.array(z.string()).optional(),
  locale: localeSchema.optional(),
  shortcutBindings: z.record(z.string(), z.array(z.string())).optional(),
  localePreference: localePreferenceSchema.optional(),
  terminalInheritSystemProfile: z.boolean().optional(),
  terminalFontFamily: nonEmptyStringSchema.optional(),
  integratedTerminalShell: integratedTerminalShellSelectionSchema.optional(),
  httpProxy: nonEmptyStringSchema.optional(),
  httpProxyNoProxy: nonEmptyStringSchema.optional(),
  httpProxyCaCertPath: nonEmptyStringSchema.optional(),
  embeddedBrowserAllowInsecureCertificates: z.boolean().optional(),
  embeddedBrowserViewportPreference: embeddedBrowserViewportPreferenceSchema.optional(),
  computerUseComposerEntryHidden: z.boolean().optional(),
  taskAutoArchiveEnabled: z.boolean().optional(),
  taskAutoArchiveOlderThanDays: z.number().int().positive().max(365).optional(),
  closeToTrayOnWindows: z.boolean().optional(),
  keepAwakeWhileRunning: z.boolean().optional(),
  desktopZoomLevel: desktopZoomLevelSchema.optional(),
  desktopWindowSize: desktopWindowSizeSchema.optional(),
  desktopChromiumHardwareAccelerationEnabled: z.boolean().optional(),
  messageStreamShowReasoning: z.boolean().optional(),
  messageStreamShowTodos: z.boolean().optional(),
  toolGroupingExploreEnabled: z.boolean().optional(),
  toolGroupingTerminalEnabled: z.boolean().optional(),
  toolGroupingChangesEnabled: z.boolean().optional(),
  zcodeInteractionBehavior: zcodeInteractionBehaviorSchema.optional(),
  askUserQuestionAutoResolutionEnabled: z.boolean().optional(),
  modelIoFullRetentionEnabled: z.boolean().optional(),
  // 空串是「删除选择、回到跟随」的哨兵：RPC 会吞掉 undefined，normalizeSettingsPatch 把它归一成删除。
  dynamicWorkflowMode: z.union([z.enum(DYNAMIC_WORKFLOW_MODES), z.literal("")]).optional(),
  enabledBuiltinAgentCliProviders: enabledBuiltinAgentCliProvidersSchema.optional(),
  providerFamilyConnectionSelections: providerFamilyConnectionSelectionSettingsSchema.optional(),
  providerFamilyDomain: z.union([providerFamilyDomainSchema, z.literal("")]).optional(),
  providerFamilyDomainUpdatedAt: z.number().int().nonnegative().optional(),
  nativeSearchEnhancementsEnabled: z.boolean().optional(),
  onboardingOccupation: z
    .enum([
      "office",
      "developer",
      "independent",
      "infrastructure",
      "product",
      "design",
      "student",
      "creator",
      "operations",
      "marketing",
      "finance",
      "accounting",
      "legal",
      "other",
    ])
    .nullish(),
  proactiveSuggestionsEnabled: z.boolean().optional(),
  memoryEnabled: z.boolean().optional(),
  lastWorkspaceSession: z.array(appWorkspaceSessionEntrySchema).optional(),
  lastActiveTabIndex: z.number().int().nonnegative().optional(),
  lastActiveTaskByWorkspace: z.record(z.string(), z.string()).optional(),
  dataBaseDir: z.string().trim().min(1).optional(),
  settingsSyncFirstRunPromptHandled: z.boolean().optional(),
  webRemoteControlExternalRelayDevice: webRemoteControlExternalRelayDeviceSchema.optional(),
  webRemoteControlLastEnabledContext: webRemoteControlLastEnabledContextSchema.optional(),
  zcodeEndpointOrigin: zcodeEndpointOriginSchema.optional(),
});
