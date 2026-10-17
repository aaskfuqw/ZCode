import type { HighspeedCardSnapshot, HighspeedMessageMeta } from "@zcode/shared";
import { planHighspeedTranscriptHydration } from "@/highspeed/highspeedTurnHydration.js";

export interface HighspeedTranscriptRow {
  sourceCommandId?: string;
  createdAt: number;
  highspeed?: HighspeedMessageMeta;
}

export interface HighspeedTurnMetrics {
  outputTokens: number;
  durationMs: number;
  modelDurationMs?: number;
  toolDurationMs?: number;
  otherDurationMs?: number;
  regularTps: number;
  highspeedTps?: number;
  savedDurationMs?: number;
}

export interface HighspeedTurnRecord {
  sessionId: string;
  sourceCommandId: string;
  card: HighspeedCardSnapshot;
  createdAt: number;
  completedAt?: number;
  metrics?: HighspeedTurnMetrics;
  metricsPersistedAt?: number;
}

const MAX_RECORDS = 300;

let records: HighspeedTurnRecord[] = [];
const highspeedTpsByCardId = new Map<string, number>();
const healthyAttemptsByCardId = new Map<
  string,
  { expiryAttempted: boolean; completionRetryAttempted: boolean }
>();
let version = 0;
const listeners = new Set<() => void>();

function publishChange(): void {
  version += 1;
  for (const listener of listeners) listener();
}

export function recordHighspeedTurn(record: HighspeedTurnRecord): void {
  records = [
    record,
    ...records.filter((candidate) => candidate.sourceCommandId !== record.sourceCommandId),
  ].slice(0, MAX_RECORDS);
  publishChange();
}

/**
 * 冷启动恢复与跨端追平：到期时 renderer 可能不在场，内存 store 没有机会登记/收口这张卡；
 * 远控 Renderer 也可能先登记运行中 row、桌面端随后才把完成态持久化进 transcript。
 * 合并口径见 planHighspeedTranscriptHydration；这里只负责按序落库并发一次通知。
 * 返回产生变化的 row 数；无变化不发通知，重复水合不会造成渲染抖动。
 */
export function hydrateHighspeedTurnsFromTranscript(
  sessionId: string,
  rows: readonly HighspeedTranscriptRow[],
): number {
  const plan = planHighspeedTranscriptHydration(rows, {
    sessionId,
    now: Date.now(),
    findRecord: getHighspeedTurnByCommandId,
    getCardTps: getHighspeedCardTps,
  });
  for (const [cardId, highspeedTps] of plan.cardTps) {
    highspeedTpsByCardId.set(cardId, highspeedTps);
  }
  for (const { record, existed } of plan.records) {
    records = existed
      ? records.map((candidate) =>
          candidate.sourceCommandId === record.sourceCommandId ? record : candidate,
        )
      : [record, ...records].slice(0, MAX_RECORDS);
  }
  if (plan.changedRows > 0) publishChange();
  return plan.changedRows;
}

export function discardHighspeedTurn(sourceCommandId: string): boolean {
  const nextRecords = records.filter((record) => record.sourceCommandId !== sourceCommandId);
  if (nextRecords.length === records.length) return false;
  records = nextRecords;
  publishChange();
  return true;
}

export function completeHighspeedTurn(params: {
  sourceCommandId: string;
  outputTokens: number;
  durationMs: number;
  modelDurationMs?: number;
  toolDurationMs?: number;
  otherDurationMs?: number;
  completedAt?: number;
}): HighspeedTurnRecord | null {
  const current = getHighspeedTurnByCommandId(params.sourceCommandId);
  if (!current) return null;
  if (current.metrics) return current;
  const completed: HighspeedTurnRecord = {
    ...current,
    completedAt: params.completedAt ?? Date.now(),
    metrics: {
      outputTokens: Math.max(0, Math.floor(params.outputTokens)),
      durationMs: Math.max(0, params.durationMs),
      ...(params.modelDurationMs !== undefined
        ? { modelDurationMs: Math.max(0, params.modelDurationMs) }
        : {}),
      ...(params.toolDurationMs !== undefined
        ? { toolDurationMs: Math.max(0, params.toolDurationMs) }
        : {}),
      ...(params.otherDurationMs !== undefined
        ? { otherDurationMs: Math.max(0, params.otherDurationMs) }
        : {}),
      regularTps: current.card.regularTps ?? 0,
    },
  };
  records = records.map((record) =>
    record.sourceCommandId === params.sourceCommandId ? completed : record,
  );
  publishChange();
  return completed;
}

export function setHighspeedCardTps(cardId: string, highspeedTps: number): void {
  if (!Number.isFinite(highspeedTps) || highspeedTps <= 0) return;
  if (highspeedTpsByCardId.get(cardId) === highspeedTps) return;
  highspeedTpsByCardId.set(cardId, highspeedTps);
  publishChange();
}

export function getHighspeedCardTps(cardId: string): number | undefined {
  return highspeedTpsByCardId.get(cardId);
}

/**
 * 卡级 healthy 查询防重必须跨 SessionPane 生命周期存在；组件 ref 会在重挂载后清空，
 * 导致同一张已过期卡持续请求并放大服务端限流。每张卡最多允许到期查询一次，
 * 若当时仍有 Turn 运行，再允许最后一轮结束后补查一次。
 */
export function claimHighspeedHealthyAttempt(cardId: string, allTurnsCompleted: boolean): boolean {
  const attempts = healthyAttemptsByCardId.get(cardId) ?? {
    expiryAttempted: false,
    completionRetryAttempted: false,
  };
  if (allTurnsCompleted) {
    if (attempts.completionRetryAttempted) return false;
    attempts.completionRetryAttempted = true;
  } else {
    if (attempts.expiryAttempted) return false;
    attempts.expiryAttempted = true;
  }
  healthyAttemptsByCardId.set(cardId, attempts);
  return true;
}

export function markHighspeedTurnMetricsPersisted(
  sourceCommandId: string,
  savedDurationMs: number,
  persistedAt = Date.now(),
): void {
  let changed = false;
  records = records.map((record) => {
    if (
      record.sourceCommandId !== sourceCommandId ||
      !record.metrics ||
      record.metricsPersistedAt !== undefined
    ) {
      return record;
    }
    const highspeedTps = getHighspeedCardTps(record.card.cardId);
    if (!highspeedTps) return record;
    changed = true;
    return {
      ...record,
      metricsPersistedAt: persistedAt,
      metrics: {
        ...record.metrics,
        highspeedTps,
        savedDurationMs: Math.max(0, savedDurationMs),
      },
    };
  });
  if (changed) publishChange();
}

export function getHighspeedTurnByCommandId(
  sourceCommandId: string | undefined,
): HighspeedTurnRecord | null {
  if (!sourceCommandId) return null;
  return records.find((record) => record.sourceCommandId === sourceCommandId) ?? null;
}

function listHighspeedTurnsBySession(sessionId: string): HighspeedTurnRecord[] {
  return records.filter((record) => record.sessionId === sessionId);
}

export function listPendingHighspeedTurns(sessionId: string): HighspeedTurnRecord[] {
  return listHighspeedTurnsBySession(sessionId).filter((record) => record.metrics === undefined);
}

export function listExpiredHighspeedCardsAwaitingTps(
  sessionId: string,
  now: number,
): Array<{ cardId: string; allTurnsCompleted: boolean }> {
  const sessionRecords = listHighspeedTurnsBySession(sessionId);
  const cardIds = [...new Set(sessionRecords.map((record) => record.card.cardId))];
  return cardIds.flatMap((cardId) => {
    const cardRecords = sessionRecords.filter((record) => record.card.cardId === cardId);
    if (
      highspeedTpsByCardId.has(cardId) ||
      cardRecords.every((record) => record.card.expiresAt > now)
    ) {
      return [];
    }
    return [{ cardId, allTurnsCompleted: cardRecords.every((record) => record.metrics) }];
  });
}

export function listHighspeedTurnsAwaitingMetricsPersistence(
  sessionId: string,
): HighspeedTurnRecord[] {
  return listHighspeedTurnsBySession(sessionId).filter(
    (record) =>
      record.metrics !== undefined &&
      record.metricsPersistedAt === undefined &&
      getHighspeedCardTps(record.card.cardId) !== undefined,
  );
}

export function resolveNextHighspeedMetricsRefreshAt(sessionId: string): number | null {
  const pending = listHighspeedTurnsBySession(sessionId).filter(
    (record) =>
      record.metricsPersistedAt === undefined &&
      getHighspeedCardTps(record.card.cardId) === undefined,
  );
  return pending.length > 0 ? Math.min(...pending.map((record) => record.card.expiresAt)) : null;
}

export function subscribeHighspeedTurns(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getHighspeedTurnVersion(): number {
  return version;
}
