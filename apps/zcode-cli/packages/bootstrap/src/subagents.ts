import { parseRuntimeSubagentConfig } from "./subagent-runtime-config.js";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  parseAgentProfileFromMarkdown,
  type AgentProfile,
  type AgentProfileParseDiagnostic,
} from "@zcode/core";
import type { Logger, PluginMetadata } from "@zcode/contracts";
import {
  createPluginAgentStateId,
  subagentStateFileSchema,
  InvalidSubagentStateError,
  type BuiltInSubagentModelSelectionOverrides,
  type PluginSubagentModelSelectionOverrides,
} from "@zcode/shared";

interface LoadZCodeAgentProfilesInput {
  logger?: Logger;
  storageRoot: string;
  workingDirectory: string;
}

interface LoadZCodeAgentProfilesResult {
  builtInModelSelectionOverrides: BuiltInSubagentModelSelectionOverrides;
  pluginAgentModelSelectionOverrides: PluginSubagentModelSelectionOverrides;
  diagnostics: AgentProfileParseDiagnostic[];
  profiles: AgentProfile[];
}

interface LoadPluginAgentProfilesInput {
  logger?: Logger;
  plugins: readonly PluginMetadata[];
  reservedProfileNames?: Iterable<string>;
  /** Current startup snapshot; the plugin loader does not reload files or account state. */
  modelSelectionOverrides?: PluginSubagentModelSelectionOverrides;
}

interface ParsedPluginAgentProfile {
  bareName: string;
  plugin: PluginMetadata;
  profile: AgentProfile;
}

const RESERVED_AGENT_NAMES = new Set(["general-purpose", "Explore"]);

export async function loadZCodeAgentProfiles(
  input: LoadZCodeAgentProfilesInput,
): Promise<LoadZCodeAgentProfilesResult> {
  const roots = [
    { path: join(input.storageRoot, "agents"), source: "user" as const },
    { path: join(input.workingDirectory, ".zcode-next", "agents"), source: "project" as const },
  ];
  const agentState = await readAgentState(input.storageRoot);
  const documents = roots.flatMap((root) =>
    listMarkdownFiles(root.path).map((path) => ({
      path,
      source: root.source,
      content: readFileSync(path, "utf8"),
    })),
  );
  const parsed = parseRuntimeSubagentConfig({
    documents,
    state: agentState,
  });
  for (const diagnostic of parsed.diagnostics)
    input.logger?.warn("Agent profile diagnostic", {
      ...diagnostic,
      module: "bootstrap.subagents",
    });
  return parsed;
}

export function loadPluginAgentTemplates(
  input: Pick<LoadPluginAgentProfilesInput, "plugins" | "logger">,
): { profiles: ParsedPluginAgentProfile[]; diagnostics: AgentProfileParseDiagnostic[] } {
  const parsedProfiles: ParsedPluginAgentProfile[] = [];
  const diagnostics: AgentProfileParseDiagnostic[] = [];
  for (const plugin of input.plugins) {
    if (!plugin.enabled) continue;
    const agents = plugin.components.find((group) => group.kind === "agent")?.items ?? [];
    for (const agent of agents) {
      const filePath = join(plugin.rootPath, "agents", `${agent.name}.md`);
      const result = parsePluginAgentProfile({ filePath, logger: input.logger, plugin });
      if (result.diagnostic) diagnostics.push(result.diagnostic);
      if (result.parsed) parsedProfiles.push(result.parsed);
    }
  }

  return { profiles: parsedProfiles, diagnostics };
}

export function resolvePluginAgentProfiles(
  input: LoadPluginAgentProfilesInput,
  templates: ReturnType<typeof loadPluginAgentTemplates>,
): LoadZCodeAgentProfilesResult {
  const diagnostics = [...templates.diagnostics];
  const parsedProfiles = templates.profiles;
  const reservedProfileNames = new Set([
    ...RESERVED_AGENT_NAMES,
    ...(input.reservedProfileNames ?? []),
  ]);
  const bareNameCounts = countBareProfileNames(parsedProfiles);
  const profiles: AgentProfile[] = [];
  for (const parsed of parsedProfiles) {
    const override =
      input.modelSelectionOverrides?.[createPluginAgentStateId(parsed.plugin.id, parsed.bareName)];
    // 先替换完整选择再展开别名，避免同一插件的两个调用入口使用不同模型/档位。
    const canonical = {
      ...namespacePluginAgentProfile(parsed),
      ...(override ? { modelSelection: override } : {}),
    };
    profiles.push(canonical);

    const bareName = parsed.bareName.trim();
    if (bareNameCounts.get(bareName) === 1 && !reservedProfileNames.has(bareName)) {
      profiles.push({ ...canonical, name: bareName });
    } else if (reservedProfileNames.has(bareName)) {
      diagnostics.push({
        code: "agent_ambiguous_name",
        message: `Plugin agent bare name conflicts with an existing profile; use ${canonical.name}: ${bareName}`,
        path: canonical.path,
      });
    } else if ((bareNameCounts.get(bareName) ?? 0) > 1) {
      diagnostics.push({
        code: "agent_ambiguous_name",
        message: `Plugin agent bare name is ambiguous; use ${canonical.name}: ${bareName}`,
        path: canonical.path,
      });
    }
  }

  input.logger?.debug("Plugin agent profiles loaded", {
    diagnosticCount: diagnostics.length,
    module: "bootstrap.subagents",
    profileCount: profiles.length,
  });

  return {
    builtInModelSelectionOverrides: {},
    pluginAgentModelSelectionOverrides: {},
    diagnostics,
    profiles,
  };
}

function parsePluginAgentProfile(input: {
  filePath: string;
  logger?: Logger;
  plugin: PluginMetadata;
}): { diagnostic?: AgentProfileParseDiagnostic; parsed?: ParsedPluginAgentProfile } {
  try {
    const content = readFileSync(input.filePath, "utf8");
    const result = parseAgentProfileFromMarkdown({
      content,
      path: input.filePath,
      source: "user",
    });
    if (result.diagnostic) {
      input.logger?.warn("Plugin agent profile diagnostic", {
        code: result.diagnostic.code,
        message: result.diagnostic.message,
        module: "bootstrap.subagents",
        path: input.filePath,
        pluginId: input.plugin.id,
      });
      if (!result.profile) return { diagnostic: result.diagnostic };
    }
    if (!result.profile) return {};
    return {
      ...(result.diagnostic ? { diagnostic: result.diagnostic } : {}),
      parsed: {
        bareName: result.profile.name,
        plugin: input.plugin,
        profile: result.profile,
      },
    };
  } catch (error) {
    return {
      diagnostic: {
        code: "agent_read_failed",
        message:
          error instanceof Error ? error.message : `Failed to read plugin agent: ${input.filePath}`,
        path: input.filePath,
      },
    };
  }
}

function namespacePluginAgentProfile(parsed: ParsedPluginAgentProfile): AgentProfile {
  return {
    ...parsed.profile,
    name: `${parsed.plugin.name}:${parsed.bareName}`,
  };
}

function countBareProfileNames(
  parsedProfiles: readonly ParsedPluginAgentProfile[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const parsed of parsedProfiles) {
    const name = parsed.bareName.trim();
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

async function readAgentState(storageRoot: string) {
  const path = join(storageRoot, "v2", "agents-state.json");
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return subagentStateFileSchema.parse({});
    throw error;
  }
  try {
    return subagentStateFileSchema.parse(JSON.parse(raw));
  } catch (cause) {
    throw new InvalidSubagentStateError(path, cause);
  }
}

function listMarkdownFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  if (!statSync(root).isDirectory()) return [];

  const result: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    // 与 Host / Settings 一致，只加载根目录直接文件；插件使用独立发现入口。
    if (entry.isFile() && /\.(md|markdown)$/iu.test(entry.name)) {
      result.push(path);
    }
  }
  return result.sort((left, right) => left.localeCompare(right));
}
