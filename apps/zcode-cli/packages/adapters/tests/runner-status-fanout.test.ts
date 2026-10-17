import { describe, expect, it, vi } from "vitest";
import {
  createModelId,
  createModelProviderId,
  type ModelNetworkStatusEvent,
} from "@zcode/contracts";
import { createStatusContext, publishModelStatus } from "../src/model/runner-status.js";

const event: ModelNetworkStatusEvent = {
  attempt: 1,
  maxAttempts: 1,
  providerId: createModelProviderId("provider"),
  modelId: createModelId("model"),
  requestId: "request",
  timestamp: "2026-07-22T00:00:00.000Z",
  traceId: "trace" as never,
  transport: "http",
  type: "model_request_started",
};

describe("publishModelStatus", () => {
  it("把 Core stream recovery attribution 带入所有 Adapter status event", () => {
    const streamRecovery = {
      attemptId: "recovery-attempt",
      maxRetries: 10,
      recoveredFromRequestId: "failed-request",
      retryNumber: 2,
    };
    const context = createStatusContext({
      maxAttempts: 1,
      request: {
        messages: [],
        streamRecovery,
      },
      resolved: {
        baseURL: "https://api.example.com/v1",
        providerKind: "anthropic",
        providerId: event.providerId,
        modelId: event.modelId,
      } as never,
      transport: "sse",
    });

    expect(context.streamRecovery).toEqual(streamRecovery);
  });

  it("同时投递 request sink 与 adapter status observer", async () => {
    const requestPublish = vi.fn();
    const observerPublish = vi.fn();
    await publishModelStatus(event, {
      requestStatusSink: { publish: requestPublish },
      statusSink: { publish: observerPublish },
    });
    expect(requestPublish).toHaveBeenCalledWith(event);
    expect(observerPublish).toHaveBeenCalledWith(event);
  });

  it("同一个 sink 不重复投递", async () => {
    const publish = vi.fn();
    const sink = { publish };
    await publishModelStatus(event, { requestStatusSink: sink, statusSink: sink });
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("原始失败只交给进程级观测 sink，不进入 request sink", async () => {
    const failureEvent: ModelNetworkStatusEvent = {
      ...event,
      durationMs: 10,
      message: "Provider request failed.",
      reason: "network_error",
      retryable: false,
      type: "model_request_failed",
    };
    const rawError = Object.assign(new Error("socket reset by peer"), {
      code: "ECONNRESET",
    });
    const requestPublish = vi.fn();
    const observerPublish = vi.fn();
    const observerFailure = vi.fn();

    await publishModelStatus(failureEvent, {
      failureError: rawError,
      requestStatusSink: { publish: requestPublish },
      statusSink: {
        publish: observerPublish,
        publishFailure: observerFailure,
      },
    });

    expect(requestPublish).toHaveBeenCalledWith(failureEvent);
    expect(requestPublish).not.toHaveBeenCalledWith(failureEvent, rawError);
    expect(observerPublish).not.toHaveBeenCalled();
    expect(observerFailure).toHaveBeenCalledWith(failureEvent, rawError);
  });

  it("一个 sink 失败时仍投递另一个 sink，且不污染模型主链路", async () => {
    const logger = {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
    const observerPublish = vi.fn();
    await expect(
      publishModelStatus(event, {
        logger: logger as never,
        requestStatusSink: {
          publish: () => {
            throw new Error("usage sink unavailable");
          },
        },
        statusSink: { publish: observerPublish },
      }),
    ).resolves.toBeUndefined();
    expect(observerPublish).toHaveBeenCalledWith(event);
    expect(logger.warn).toHaveBeenCalledOnce();
  });
});
