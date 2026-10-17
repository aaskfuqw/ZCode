import { describe, expect, it } from "vitest";
import { CRON_DEFAULT_GROUP_ID } from "@zcode/shared";
import { getTaskGroupDisplayTitle } from "../src/workspace-grouped-tasks/group-title.js";

describe("task group titles after retiring idle automation", () => {
  it("uses the editable title of a historical group", () => {
    expect(
      getTaskGroupDisplayTitle(
        { id: "zcode-default-group-off-peak", title: "My work" },
        { cron: "Scheduled" },
      ),
    ).toBe("My work");
  });
  it("continues localizing the scheduled-task system group", () => {
    expect(
      getTaskGroupDisplayTitle({ id: CRON_DEFAULT_GROUP_ID, title: "cron" }, { cron: "定时任务" }),
    ).toBe("定时任务");
  });
});
