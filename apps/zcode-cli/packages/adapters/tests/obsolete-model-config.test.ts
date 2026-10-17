import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { loadFileConfig } from "../src/config/file-config.adapter.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it.each([
  ["string model", { model: "fixture/model" }],
  ["main/lite model", { model: { main: "fixture/main", lite: "fixture/lite" } }],
  ["inline model target", { model: { provider: "fixture", model: "model" } }],
  ["provider map", { provider: { fixture: { kind: "openai-compatible", models: { model: {} } } } }],
  ["small_model", { small_model: "fixture/small" }],
] as const)("rejects obsolete %s config without changing the file", async (_name, config) => {
  const root = await mkdtemp(join(tmpdir(), "zcode-obsolete-model-config-"));
  roots.push(root);
  const path = join(root, "overridden-config.json");
  const content = JSON.stringify(config);
  await writeFile(path, content);
  expect(() => loadFileConfig(path)).toThrow(
    `Incompatible legacy CLI model/provider configuration at ${JSON.stringify(path)}`,
  );
  expect(() => loadFileConfig(path)).toThrow("ZCODE_PERSONAL_PROVIDER_CONFIG_FILE");
  expect(() => loadFileConfig(path)).toThrow("Keep all project and workspace files");
  expect(await readFile(path, "utf8")).toBe(content);
});

it("loads current runtime configuration independently of provider_config.json", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-current-runtime-config-"));
  roots.push(root);
  const path = join(root, "config.json");
  const content = JSON.stringify({ storage: { sessionDbPath: join(root, "sessions.sqlite") } });
  await writeFile(path, content);
  expect(loadFileConfig(path)).toMatchObject({ loaded: true, diagnostics: [] });
  expect(await readFile(path, "utf8")).toBe(content);
});
