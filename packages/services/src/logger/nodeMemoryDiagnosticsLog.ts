import {
  createMemorySampleWriteGate,
  formatMemorySampleLine,
  MEMORY_SAMPLE_INTERVAL_MS,
  memoryUsageToSampleFields,
  type MemorySample,
} from "@zcode/shared";

interface NodeMemoryDiagnosticsLogger {
  info(...args: unknown[]): void;
}

interface NodeMemoryDiagnosticsTimerHandle {
  unref?(): void;
}

export interface StartNodeMemoryDiagnosticsLogOptions {
  logger: NodeMemoryDiagnosticsLogger;
  /** services 层的领域计数器（`collectServiceMemoryDiagnostics`）。 */
  collectCounters(): Record<string, number>;
  readMemoryUsage?: () => NodeJS.MemoryUsage;
  role?: MemorySample["role"];
  now?: () => number;
  intervalMs?: number;
  timer?: {
    setInterval(callback: () => void, intervalMs: number): NodeMemoryDiagnosticsTimerHandle;
    clearInterval(handle: NodeMemoryDiagnosticsTimerHandle): void;
  };
}

export interface NodeMemoryDiagnosticsLog {
  /** 立即采样一次（供测试与手动触发），返回是否写盘。 */
  sampleNow(): boolean;
  stop(): void;
}

/**
 * Local Host 进程自身的内存诊断日志。
 * 60s 采样、变化/心跳门控后写一行 `[memory] role=utility_host ...`，经既有 host logger
 * 转发到 Desktop 主日志；不新增 parentPort 消息类型。
 */
export function startNodeMemoryDiagnosticsLog(
  options: StartNodeMemoryDiagnosticsLogOptions,
): NodeMemoryDiagnosticsLog {
  const readMemoryUsage = options.readMemoryUsage ?? (() => process.memoryUsage());
  const now = options.now ?? (() => Date.now());
  const timer = options.timer ?? {
    setInterval: (callback: () => void, intervalMs: number) => setInterval(callback, intervalMs),
    clearInterval: (handle: NodeMemoryDiagnosticsTimerHandle) =>
      clearInterval(handle as ReturnType<typeof setInterval>),
  };
  const gate = createMemorySampleWriteGate();

  const sampleNow = (): boolean => {
    let memoryUsage: NodeJS.MemoryUsage;
    try {
      memoryUsage = readMemoryUsage();
    } catch {
      // Failed local readings are discarded.
      return false;
    }

    try {
      const sample: MemorySample = {
        role: options.role ?? "utility_host",
        ...memoryUsageToSampleFields(memoryUsage),
        counters: options.collectCounters(),
      };
      const reason = gate.evaluate(sample, now());
      if (!reason) {
        return false;
      }
      options.logger.info(formatMemorySampleLine(sample, reason));
      return true;
    } catch {
      // 诊断采样失败只丢当前样本，不能影响 Host 服务。
      return false;
    }
  };

  let handle: NodeMemoryDiagnosticsTimerHandle | undefined = timer.setInterval(
    sampleNow,
    options.intervalMs ?? MEMORY_SAMPLE_INTERVAL_MS,
  );
  try {
    handle.unref?.();
  } catch {
    // unref 不可用时仍保留 handle 供 stop 回收。
  }

  return {
    sampleNow,
    stop() {
      if (!handle) {
        return;
      }
      const current = handle;
      handle = undefined;
      timer.clearInterval(current);
    },
  };
}
