import type { ConversationDelta } from "@zcode/shared/zcode-protocol-v4";
import { utf8JsonByteLength } from "@zcode/shared/zcode-protocol-v4";

/** JSON 外壳（`{"kind":"deltas","deltas":[…]}` 与帧信封）留的余量，与流式追加快路径同值。 */
const WORKFLOW_RUN_DELTA_ENVELOPE_SLACK_BYTES = 64;

/**
 * 一批 delta **只含**键级增量时，快照增长的字节上界；含任何其它 op 时返回 null（必须精确测量）。
 *
 * 上界成立的理由：`workflowRun.updated` 写进快照的全部内容都在这条 op 的载荷里（header 键整体
 * 替换、条目整条 upsert），所以快照最多长它自己那么多；`workflowRun.removed` 只会让快照变小。
 *
 * **空批次**同样满足这个判据（没有一条不是键级增量），而且它的增长论证更强：一条不产 delta 的
 * 事件对快照的全部改动就是 `seq` 那个数字——余量绰绰有余。这一支不是特例，它就是判据读到底的
 * 结果，而且正是它让「归约判幂等、一条 delta 都不产」的重放事件不再为一次整份序列化买单。
 *
 * null 覆盖的那一半同样是契约的一部分：diff 认不出结构变化时会退化成整键 `state.updated`，
 * 那条 op 的字节数**不是**增长的上界（它替换的是整个键，旧值的字节不在其中），必须落回精确
 * 路径。判据因此是「每一条都是键级增量」，而不是「有键级增量」。
 *
 * 余量是**每批**一份而不是每条一份：这一份既盖 JSON 外壳，也盖 `seq` 十进制位数的增长。
 */
export function workflowRunDeltaGrowthUpperBound(
  deltas: readonly ConversationDelta[],
): number | null {
  for (const delta of deltas) {
    if (delta.op !== "workflowRun.updated" && delta.op !== "workflowRun.removed") return null;
  }
  return utf8JsonByteLength(deltas) + WORKFLOW_RUN_DELTA_ENVELOPE_SLACK_BYTES;
}
