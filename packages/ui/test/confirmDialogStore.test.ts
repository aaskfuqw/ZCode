import { describe, expect, it } from "vitest";
import { useConfirmDialogStore } from "@/store/confirmDialogStore.js";
describe("confirmation dialog compatibility", () => {
  it("closing a binary confirmation settles it as false", async () => {
    const pending = useConfirmDialogStore.getState().requestConfirmation({ title: "delete" });
    useConfirmDialogStore.getState().settleChoice("dismiss");
    await expect(pending).resolves.toBe(false);
  });
});
