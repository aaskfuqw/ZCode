// ConversationTopicPublisher × workflowRuns 键级增量（DESIGN §5/§6）。
// Both current delivery profiles consume native workflow deltas and the current snapshot budget.
import { describe, expect, it, vi } from "vitest";
import type {
  EventId,
  SessionEvent,
  SessionEventType as SessionEventTypeUnion,
  SessionId,
  TraceId,
} from "@zcode/contracts";
import { SessionEventType } from "@zcode/contracts";
import type {
  ConversationDelta,
  ConversationSnapshot,
  ConversationTopicFrame,
  WorkflowRunsState,
} from "@zcode/shared/zcode-protocol-v4";
import {
  PROTOCOL_V4_LIMITS,
  WORKFLOW_RUNS_LIMITS,
  applyConversationDeltas,
  conversationTopicFrameSchema,
} from "@zcode/shared/zcode-protocol-v4";
import {
  ConversationTopicPublisher,
  PROJECTION_TERMINAL_RESERVE_BYTES,
  ProductProjection,
} from "../src/zcode-protocol-v4/index.js";

const RUN_ID = "dwfrun-1";

class EventLog {
  private seq = 0;
  private progressSequence = -1;
  readonly events: SessionEvent[] = [];

  push(type: SessionEventTypeUnion, payload: unknown): SessionEvent {
    this.seq += 1;
    const event: SessionEvent = {
      id: `event-${this.seq}` as EventId,
      sessionId: "session-1" as SessionId,
      type,
      timestamp: new Date(1_700_000_000_000 + this.seq * 1000),
      traceId: "trace-1" as TraceId,
      sequenceNumber: this.seq,
      payload,
    };
    this.events.push(event);
    return event;
  }

  progress(eventType: string, payload: Record<string, unknown>): SessionEvent {
    this.progressSequence += 1;
    return this.push(SessionEventType.DynamicWorkflowRunProgress, {
      runId: RUN_ID,
      toolCallId: "tc-1",
      sequence: this.progressSequence,
      eventType,
      payload,
    });
  }

  started(): SessionEvent {
    this.push(SessionEventType.SessionCreated, { mode: "default", contextWindow: 200_000 });
    return this.progress("run-started", { runId: RUN_ID, caps: { maxConcurrency: 4 } });
  }

  /** `count` 个不同实例各排队一次——宽 fan-out 的最小形态。 */
  fanOut(count: number): void {
    for (let ordinal = 1; ordinal <= count; ordinal += 1) {
      this.progress("node-queued", { instance: { siteId: "ask#1", ordinal }, kind: "ask" });
    }
  }
}

function publisherWith(events: readonly SessionEvent[]): ConversationTopicPublisher {
  const publisher = new ConversationTopicPublisher("session-1", "epoch-1", { now: () => 0 });
  for (const event of events) publisher.ingest(event);
  return publisher;
}

function snapshotOf(frame: ConversationTopicFrame | null): ConversationSnapshot {
  expect(frame?.payload.kind).toBe("snapshot");
  return (frame!.payload as { kind: "snapshot"; snapshot: ConversationSnapshot }).snapshot;
}

function deltasOf(frame: ConversationTopicFrame | null): ConversationDelta[] {
  expect(frame?.payload.kind).toBe("deltas");
  return (frame!.payload as { kind: "deltas"; deltas: ConversationDelta[] }).deltas;
}

describe("current workflow delivery profiles", () => {
  it.each(["continuous", "replayable"] as const)(
    "%s receives native deltas and complete wide snapshots",
    (deliveryProfile) => {
      const log = new EventLog();
      log.started();
      log.fanOut(300);
      const publisher = publisherWith(log.events);
      const initial = publisher.subscribe({ connectionId: deliveryProfile, deliveryProfile });
      expect(snapshotOf(initial.frame).workflowRuns?.runs[0]?.nodes).toHaveLength(300);
      expect(snapshotOf(initial.frame).workflowRuns?.runs[0]?.truncated).toBeUndefined();
      const base = { logEpoch: "epoch-1", seq: publisher.getSnapshot().seq };
      publisher.ingest(
        log.progress("node-dispatched", { instance: { siteId: "ask#1", ordinal: 300 } }),
      );
      expect(
        deltasOf(publisher.flush(initial.ack.subscriptionId)).map((delta) => delta.op),
      ).toEqual(["workflowRun.updated"]);
      const resumed = publisher.subscribe({ connectionId: deliveryProfile, deliveryProfile, base });
      expect(resumed.ack.mode).toBe("resume");
      expect(deltasOf(resumed.frame).map((delta) => delta.op)).toEqual(["workflowRun.updated"]);
      expect(
        snapshotOf(publisher.resync(resumed.ack.subscriptionId)).workflowRuns?.runs[0]?.nodes,
      ).toHaveLength(300);
    },
  );
});

describe("扇出宽度与订阅者 op 上界", () => {
  /**
   * 改造前这里是 600 条整键 patch（相邻的会并掉，但每条都带整张表）；改造后是 600 条键级增量，
   * 经 coalesce 规则 6 并成个位数。600 > 500 的 op 硬上界，所以"每个实例一条 op"的天真编码
   * 会在这里翻成 overflow → 全量快照，比改造前更差。这一条就是防那个。
   */
  it("一个 flush 窗口内 600 路 fan-out：增量订阅者的 op 数远低于 500 硬上界", () => {
    const log = new EventLog();
    log.started();
    const publisher = publisherWith(log.events);
    publisher.subscribe({ connectionId: "modern" });
    publisher.flush("sub-epoch-1-1");

    log.fanOut(600);
    for (const event of log.events.slice(-600)) publisher.ingest(event);

    const frame = publisher.flush("sub-epoch-1-1");
    const deltas = deltasOf(frame);
    expect(deltas.length).toBeLessThan(10);
    expect(deltas.length).toBeLessThan(PROTOCOL_V4_LIMITS.subscriberBufferMaxOps);
    expect(() => conversationTopicFrameSchema.parse(frame)).not.toThrow();
    // 600 个实例一个不少地进了表（界是 1024）。
    expect(publisher.getSnapshot().workflowRuns?.runs[0]?.nodes).toHaveLength(600);
  });
});

describe("ingest 快路径", () => {
  /** 保守上界是私有字段；这一组断言的是它的**方向**与**自纠**，没有别的观察面。 */
  function upperBoundOf(publisher: ConversationTopicPublisher): number {
    return (publisher as unknown as { wireSnapshotBytesUpperBound: number })
      .wireSnapshotBytesUpperBound;
  }

  function setUpperBound(publisher: ConversationTopicPublisher, value: number): void {
    (publisher as unknown as { wireSnapshotBytesUpperBound: number }).wireSnapshotBytesUpperBound =
      value;
  }

  /** 私有测量入口：这一条断言的就是"整份快照没有被再序列化一遍"，没有别的观察面。 */
  function spyOnExactMeasurement(publisher: ConversationTopicPublisher) {
    return vi.spyOn(
      publisher as unknown as {
        measureWireSnapshotBytes: (snapshot: ConversationSnapshot) => number;
      },
      "measureWireSnapshotBytes",
    );
  }

  it("只产键级增量的事件不再量整份快照", () => {
    const log = new EventLog();
    log.started();
    const publisher = publisherWith(log.events);
    const measure = spyOnExactMeasurement(publisher);

    publisher.ingest(log.progress("node-queued", { instance: { siteId: "ask#1", ordinal: 1 } }));
    publisher.ingest(
      log.progress("node-dispatched", { instance: { siteId: "ask#1", ordinal: 1 } }),
    );

    expect(measure).not.toHaveBeenCalled();
    measure.mockRestore();
  });

  /**
   * 一条 delta 都不产的事件（归约判了同一条事件重放）对快照的全部改动就是 `seq` 那个数字。
   * 让它落回精确路径等于为"什么都没发生"付一次整份序列化。
   */
  it("幂等重放一条都不产 delta，同样不量整份快照", () => {
    const log = new EventLog();
    log.started();
    const queued = log.progress("node-queued", { instance: { siteId: "ask#1", ordinal: 1 } });
    const publisher = publisherWith([...log.events]);
    const measure = spyOnExactMeasurement(publisher);

    publisher.ingest(queued);

    expect(measure).not.toHaveBeenCalled();
    measure.mockRestore();
    expect(publisher.getSnapshot().workflowRuns?.runs[0]?.nodes).toHaveLength(1);
  });

  /**
   * 判据是「每一条都是键级增量」，空批次**空过**这个判据——所以这条快路径按类型说是 dwf 之外
   * 也适用的：任何归约出零条 delta 的事件都只改了 `seq`。刻意不缩到 DynamicWorkflowRunProgress：
   * 那会是一条为了看起来保守而加的限制，论证却与 dwf 无关（论证靠的是「零条 delta」，不是事件类型）。
   *
   * 安全性不靠这条判据独撑：快接受还要过 `上界 + 增长 <= 闸门`，所以真的贴着 16MiB 时它照样
   * 落回精确路径并照常抛 ProjectionPayloadTooLargeError。
   */
  it("非 dwf 的零 delta 事件同样不量整份快照", () => {
    const publisher = new ConversationTopicPublisher("session-1", "epoch-1", { now: () => 0 });
    const log = new EventLog();
    const measure = spyOnExactMeasurement(publisher);

    // draft 语义：SessionCreated 刻意不产可见 delta。
    const created = log.push(SessionEventType.SessionCreated, {
      mode: "default",
      contextWindow: 200_000,
    });
    publisher.ingest(created);

    expect(measure).not.toHaveBeenCalled();
    measure.mockRestore();
    expect(upperBoundOf(publisher)).toBeGreaterThanOrEqual(publisher.getWireSnapshotLogicalBytes());
  });

  it("非 dwf 事件仍走精确路径，并把保守上界重置回精确值", () => {
    const log = new EventLog();
    log.started();
    const publisher = publisherWith(log.events);
    publisher.ingest(log.progress("node-queued", { instance: { siteId: "ask#1", ordinal: 1 } }));
    const measure = spyOnExactMeasurement(publisher);

    publisher.ingest(
      log.push(SessionEventType.SessionTitleUpdated, { title: "重置一下上界", source: "user" }),
    );

    expect(measure).toHaveBeenCalled();
    measure.mockRestore();
    expect(upperBoundOf(publisher)).toBe(publisher.getWireSnapshotLogicalBytes());
  });

  /**
   * 快路径只加不减，所以它**必然**向上漂移：一条 op 的字节数远大于它让快照长的那几个字。
   * 这一条钉的是漂移的方向永远安全（上界 ≥ 精确值，16MiB 闸门不会被算松）。
   */
  it("一串快路径事件之后，保守上界仍不低于精确字节数", () => {
    const log = new EventLog();
    log.started();
    const publisher = publisherWith(log.events);
    log.fanOut(120);
    for (const event of log.events.slice(-120)) publisher.ingest(event);
    for (let ordinal = 1; ordinal <= 120; ordinal += 1) {
      publisher.ingest(
        log.progress("node-settled", { instance: { siteId: "ask#1", ordinal }, outcome: "ok" }),
      );
    }

    const exact = publisher.getWireSnapshotLogicalBytes();
    expect(exact).toBeGreaterThan(0);
    expect(upperBoundOf(publisher)).toBeGreaterThanOrEqual(exact);
  });

  /**
   * 漂移的另一半：它必须**收得回来**。把上界推到闸门边上（真实快照仍然很小），下一条事件的
   * 快路径判据就不再成立，于是精确测量一次并把上界重置回真值——而不是把一个还小得很的 run
   * 判成超限。没有这条自纠，上界只涨不落，久跑的会话早晚会被自己的保守估计噎死。
   */
  it("上界漂到闸门边上时下一条事件精确重测并收回，不误判超限", () => {
    const log = new EventLog();
    log.started();
    const publisher = publisherWith(log.events);
    log.fanOut(20);
    for (const event of log.events.slice(-20)) publisher.ingest(event);
    const exact = publisher.getWireSnapshotLogicalBytes();

    setUpperBound(
      publisher,
      PROTOCOL_V4_LIMITS.logicalFrameAssemblyMaxBytes - PROJECTION_TERMINAL_RESERVE_BYTES - 8,
    );
    const measure = spyOnExactMeasurement(publisher);
    expect(() =>
      publisher.ingest(
        log.progress("node-dispatched", { instance: { siteId: "ask#1", ordinal: 1 } }),
      ),
    ).not.toThrow();

    expect(measure).toHaveBeenCalledTimes(1);
    measure.mockRestore();
    const corrected = upperBoundOf(publisher);
    expect(corrected).toBe(publisher.getWireSnapshotLogicalBytes());
    // 收回的是**真值**，不是刚才那个贴着闸门的数字。
    expect(corrected).toBeLessThan(exact + 4096);
  });
});

describe("冷重物化", () => {
  /**
   * `tryBatchHydration` 按 op 逐类记账 wire 字节；键级增量是 `state.updated` 之外第二个不属于
   * 60 行 wire tail 的 op 类别，漏掉分支就会按 row op 去查 rowId（根本没有）。这一条钉的是
   * 批量路径**走得通**且终态与逐事件 live 逐字节一致。
   */
  it("批量重放一串 dwf 事件：走批量路径，终态与逐事件 live 一致", () => {
    const log = new EventLog();
    log.started();
    log.fanOut(40);
    for (let ordinal = 1; ordinal <= 40; ordinal += 1) {
      log.progress("node-settled", { instance: { siteId: "ask#1", ordinal }, outcome: "ok" });
    }

    const live = publisherWith(log.events);
    const rehydrated = new ConversationTopicPublisher("session-1", "epoch-1", { now: () => 0 });
    rehydrated.rehydrate(log.events);

    expect(JSON.stringify(rehydrated.getSnapshot().workflowRuns)).toBe(
      JSON.stringify(live.getSnapshot().workflowRuns),
    );
    // 批量路径在当前 seq 立了 snapshot recovery boundary（保留日志被清空），所以窗内的 base
    // 也只能拿到 snapshot——这正是"走了批量路径"的可观察面。
    const ack = rehydrated.subscribe({
      connectionId: "after-batch",
      base: { logEpoch: "epoch-1", seq: 2 },
    }).ack;
    expect(ack.mode).toBe("snapshot");
  });
});

describe("snapshot(W) + 续流 ≡ 全量重放（带键级增量）", () => {
  function authoritative(events: readonly SessionEvent[]): ConversationSnapshot {
    const projection = new ProductProjection("session-1", "epoch-1");
    for (const event of events) projection.applyEvent(event);
    return projection.getSnapshot();
  }

  it("continuous and replayable subscribers converge to the authoritative state", () => {
    const log = new EventLog();
    log.started();
    log.fanOut(30);
    const prefix = log.events.length;
    const publisher = publisherWith(log.events);

    const modernStore = {
      snapshot: snapshotOf(
        publisher.subscribe({ connectionId: "modern", deliveryProfile: "continuous" }).frame,
      ),
    };
    const replayableStore = {
      snapshot: snapshotOf(
        publisher.subscribe({ connectionId: "replayable", deliveryProfile: "replayable" }).frame,
      ),
    };

    for (let ordinal = 1; ordinal <= 30; ordinal += 1) {
      log.progress("node-settled", { instance: { siteId: "ask#1", ordinal }, outcome: "ok" });
    }
    for (const event of log.events.slice(prefix)) publisher.ingest(event);

    modernStore.snapshot = applyConversationDeltas(
      modernStore.snapshot,
      deltasOf(publisher.flush("sub-epoch-1-1")),
    );
    replayableStore.snapshot = applyConversationDeltas(
      replayableStore.snapshot,
      deltasOf(publisher.flush("sub-epoch-1-2")),
    );

    const replayed = authoritative(log.events).workflowRuns;
    expect(JSON.stringify(modernStore.snapshot.workflowRuns)).toBe(JSON.stringify(replayed));
    expect(JSON.stringify(replayableStore.snapshot.workflowRuns)).toBe(JSON.stringify(replayed));
  });
});
