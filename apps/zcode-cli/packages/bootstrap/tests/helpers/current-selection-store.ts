import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteSessionStore } from "@zcode/adapters/storage";

export async function createCurrentSelectionStoreFixture() {
  const root = await mkdtemp(join(tmpdir(), "app-current-selection-"));
  const store = createSqliteSessionStore({ dbPath: join(root, "sessions.sqlite") });
  return {
    store,
    async dispose() {
      store.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
