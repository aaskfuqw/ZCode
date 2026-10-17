import { describe, expect, it } from "vitest";
import {
  CURRENT_PROTOCOL_CONTRACT,
  parseCurrentProtocolHandshake,
  protocolContractSchema,
  readZCodeAttachmentFaultCode,
  ZCODE_ATTACHMENT_FAULT_CODES,
  ZCodeAttachmentFaultError,
} from "../src/zcode-protocol-v4/index.js";

describe("current internal protocol contract", () => {
  it("accepts the current contract and rejects old or incomplete peers with update guidance", () => {
    expect(
      parseCurrentProtocolHandshake(protocolContractSchema, CURRENT_PROTOCOL_CONTRACT),
    ).toEqual(CURRENT_PROTOCOL_CONTRACT);
    for (const value of [
      {},
      { protocolVersion: 1 },
      { ...CURRENT_PROTOCOL_CONTRACT, capabilities: { workflowRunDeltas: false } },
    ]) {
      expect(() => parseCurrentProtocolHandshake(protocolContractSchema, value)).toThrow(
        "Update or redeploy",
      );
    }
  });

  it("classifies structured attachment faults without interpreting message text", () => {
    const code = ZCODE_ATTACHMENT_FAULT_CODES.shareStatNotFound;
    expect(readZCodeAttachmentFaultCode(new ZCodeAttachmentFaultError(code))).toBe(code);
    expect(readZCodeAttachmentFaultCode({ data: { code }, message: "localized" })).toBe(code);
    expect(readZCodeAttachmentFaultCode(new Error(code))).toBeUndefined();
    expect(readZCodeAttachmentFaultCode(new Error("ENOENT: missing"))).toBeUndefined();
  });
});
