import type { Logger } from "@zcode/contracts";
import type { RegistryProviderConfig } from "@zcode/provider";

export interface ModelRequestSecurityPort {
  protectTransport(input: {
    providerId: string;
    providerConfig: {
      access: RegistryProviderConfig["access"];
      baseURL: string;
      apiKey?: string;
      headers?: Record<string, string>;
    };
    transport: typeof globalThis.fetch;
  }): typeof globalThis.fetch;
}

/** 进程只共享可复用资源，每个模型执行器仍持有独立的请求状态。 */
export interface ModelRequestSecurityState {
  createExecution(options: { logger?: Logger }): ModelRequestSecurityPort;
}
