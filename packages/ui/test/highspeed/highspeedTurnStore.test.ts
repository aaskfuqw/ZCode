import { describe, expect, it } from "vitest";
import {
  claimHighspeedHealthyAttempt,
  completeHighspeedTurn,
  discardHighspeedTurn,
  getHighspeedTurnByCommandId,
  getHighspeedTurnVersion,
  hydrateHighspeedTurnsFromTranscript,
  listExpiredHighspeedCardsAwaitingTps,
  recordHighspeedTurn,
  listHighspeedTurnsAwaitingMetricsPersistence,
  resolveNextHighspeedMetricsRefreshAt,
  setHighspeedCardTps,
  markHighspeedTurnMetricsPersisted,
} from "@/highspeed/highspeedTurnStore.js";
import { claimHighspeedFallbackToast } from "@/highspeed/highspeedToastClaims.js";

const card = {
  cardId: "hsc-aggregate-test",
  taskId: "task-aggregate-test",
  provider: "zai",
  model: "glm-highspeed",
  issuedAt: Date.now(),
  expiresAt: Date.now() + 60_000,
  regularTps: 75,
};

describe("highspeed turn store", () => {
  it("claims a fallback toast once across SessionPane remounts", () => {
    const sourceCommandId = "command-fallback-toast-once";

    expect(claimHighspeedFallbackToast(sourceCommandId)).toBe(true);
    // 第二个 pane 或组件重挂载不能为同一降级事件再次弹 Toast。
    expect(claimHighspeedFallbackToast(sourceCommandId)).toBe(false);
  });

  it("limits healthy sampling to one expiry attempt and one final-turn补查 per card", () => {
    const cardId = "hsc-healthy-attempt-guard";

    expect(claimHighspeedHealthyAttempt(cardId, false)).toBe(true);
    expect(claimHighspeedHealthyAttempt(cardId, false)).toBe(false);
    // SessionPane 重挂载后仍复用 store 里的卡级防重状态。
    expect(claimHighspeedHealthyAttempt(cardId, false)).toBe(false);
    expect(claimHighspeedHealthyAttempt(cardId, true)).toBe(true);
    expect(claimHighspeedHealthyAttempt(cardId, true)).toBe(false);
  });

  it("hydrates persisted transcript rows after a renderer cold start", () => {
    const sourceCommandId = "command-cold-recovery";
    const cardId = "hsc-cold-recovery";
    const expiresAt = Date.now() - 1;

    expect(
      hydrateHighspeedTurnsFromTranscript("session-cold-recovery", [
        {
          sourceCommandId,
          createdAt: 10,
          highspeed: {
            cardId,
            taskId: "task-cold-recovery",
            provider: "zai",
            model: "glm-highspeed",
            issuedAt: 1,
            expiresAt,
            regularTps: 80,
            outputTokens: 120,
            durationMs: 1_000,
            highspeedTps: 120,
            savedDurationMs: 500,
          },
        },
      ]),
    ).toBe(1);

    const record = getHighspeedTurnByCommandId(sourceCommandId);
    expect(record?.metrics).toMatchObject({
      outputTokens: 120,
      durationMs: 1_000,
      highspeedTps: 120,
      savedDurationMs: 500,
    });
    expect(record?.metricsPersistedAt).toBeDefined();
    expect(listExpiredHighspeedCardsAwaitingTps("session-cold-recovery", Date.now())).toEqual([]);
  });

  it("merges late authoritative metadata into an already registered turn", () => {
    // CR-04 回归：远控 Renderer 先按运行中的 user row 登记记录；桌面端随后完成 CLI 统计持久化并
    // 投影到 transcript。旧实现发现同 sourceCommandId 已存在就跳过，远端永远缺完成态，卡级 TPS、
    // 节省时间无法收口。水合必须按 sourceCommandId 幂等合并权威字段。
    const sessionId = "session-late-merge";
    const sourceCommandId = "command-late-merge";
    const cardId = "hsc-late-merge";
    const runningRow = {
      sourceCommandId,
      createdAt: 10,
      highspeed: {
        cardId,
        taskId: sessionId,
        provider: "zai",
        model: "glm-highspeed",
        issuedAt: 1,
        expiresAt: 50,
        regularTps: 80,
      },
    };
    expect(hydrateHighspeedTurnsFromTranscript(sessionId, [runningRow])).toBe(1);
    expect(getHighspeedTurnByCommandId(sourceCommandId)?.metrics).toBeUndefined();
    const versionBefore = getHighspeedTurnVersion();
    const completedRow = {
      ...runningRow,
      highspeed: {
        ...runningRow.highspeed,
        outputTokens: 120,
        durationMs: 1_000,
        modelDurationMs: 800,
        toolDurationMs: 100,
        otherDurationMs: 100,
        highspeedTps: 120,
        savedDurationMs: 500,
      },
    };
    expect(hydrateHighspeedTurnsFromTranscript(sessionId, [completedRow])).toBe(1);
    // 迟到的完整 metadata 只产生一次 store 通知。
    expect(getHighspeedTurnVersion()).toBe(versionBefore + 1);
    expect(getHighspeedTurnByCommandId(sourceCommandId)).toMatchObject({
      metrics: {
        outputTokens: 120,
        durationMs: 1_000,
        modelDurationMs: 800,
        toolDurationMs: 100,
        otherDurationMs: 100,
        regularTps: 80,
        highspeedTps: 120,
        savedDurationMs: 500,
      },
    });
    expect(getHighspeedTurnByCommandId(sourceCommandId)?.metricsPersistedAt).toBeDefined();
    // 完全相同的再次水合是幂等 no-op：不改记录、不通知。
    const versionAfter = getHighspeedTurnVersion();
    expect(hydrateHighspeedTurnsFromTranscript(sessionId, [completedRow])).toBe(0);
    expect(getHighspeedTurnVersion()).toBe(versionAfter);
  });

  it("never clears a live completion when the transcript row is still running", () => {
    const sessionId = "session-keep-live-completion";
    const sourceCommandId = "command-keep-live-completion";
    const liveCard = { ...card, cardId: "hsc-keep-live-completion", taskId: sessionId };
    recordHighspeedTurn({ sessionId, sourceCommandId, card: liveCard, createdAt: 1 });
    completeHighspeedTurn({ sourceCommandId, outputTokens: 90, durationMs: 700 });

    const versionBefore = getHighspeedTurnVersion();
    // transcript 仍是运行态（无完成字段）：运行态字段不得覆盖已完成字段，也不应产生通知。
    expect(
      hydrateHighspeedTurnsFromTranscript(sessionId, [
        {
          sourceCommandId,
          createdAt: 1,
          highspeed: {
            cardId: liveCard.cardId,
            taskId: sessionId,
            provider: liveCard.provider,
            model: liveCard.model,
            issuedAt: liveCard.issuedAt,
            expiresAt: liveCard.expiresAt,
            regularTps: liveCard.regularTps,
          },
        },
      ]),
    ).toBe(0);
    expect(getHighspeedTurnByCommandId(sourceCommandId)?.metrics).toMatchObject({
      outputTokens: 90,
      durationMs: 700,
    });
    expect(getHighspeedTurnVersion()).toBe(versionBefore);
  });

  it("discards a queued Highspeed record when promotion falls back to the session model", () => {
    recordHighspeedTurn({
      sessionId: card.taskId,
      sourceCommandId: "command-queued-expired",
      card,
      createdAt: 0,
    });

    expect(discardHighspeedTurn("command-queued-expired")).toBe(true);
    expect(getHighspeedTurnByCommandId("command-queued-expired")).toBeNull();
  });
});

it("keeps factual turn metrics through expiry and persists them once without a sharing threshold", () => {
  const sessionId = "session-metrics-without-promotion";
  const sourceCommandId = "command-metrics-without-promotion";
  const metricCard = {
    ...card,
    taskId: sessionId,
    cardId: "card-metrics-without-promotion",
    expiresAt: 100,
  };
  recordHighspeedTurn({ sessionId, sourceCommandId, card: metricCard, createdAt: 1 });
  expect(resolveNextHighspeedMetricsRefreshAt(sessionId)).toBe(100);
  expect(listExpiredHighspeedCardsAwaitingTps(sessionId, 99)).toEqual([]);
  expect(listExpiredHighspeedCardsAwaitingTps(sessionId, 100)).toEqual([
    { cardId: metricCard.cardId, allTurnsCompleted: false },
  ]);
  completeHighspeedTurn({ sourceCommandId, outputTokens: 40, durationMs: 1000 });
  expect(listExpiredHighspeedCardsAwaitingTps(sessionId, 100)).toEqual([
    { cardId: metricCard.cardId, allTurnsCompleted: true },
  ]);
  setHighspeedCardTps(metricCard.cardId, 60);
  expect(resolveNextHighspeedMetricsRefreshAt(sessionId)).toBeNull();
  expect(listHighspeedTurnsAwaitingMetricsPersistence(sessionId)).toHaveLength(1);
  markHighspeedTurnMetricsPersisted(sourceCommandId, 0, 110);
  expect(getHighspeedTurnByCommandId(sourceCommandId)).toMatchObject({
    metricsPersistedAt: 110,
    metrics: {
      outputTokens: 40,
      durationMs: 1000,
      regularTps: 75,
      highspeedTps: 60,
      savedDurationMs: 0,
    },
  });
  const version = getHighspeedTurnVersion();
  markHighspeedTurnMetricsPersisted(sourceCommandId, 500, 120);
  expect(getHighspeedTurnVersion()).toBe(version);
  expect(listHighspeedTurnsAwaitingMetricsPersistence(sessionId)).toEqual([]);
  expect(getHighspeedTurnByCommandId(sourceCommandId)?.metrics?.savedDurationMs).toBe(0);
});
