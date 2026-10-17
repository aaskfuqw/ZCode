import { CURRENT_PROTOCOL_CONTRACT, V4_METHODS } from "@zcode/shared/zcode-protocol-v4";

/** Give process fixtures the same admission precondition as a current Agent. */
export function withCurrentProtocolAgent(script: string): string {
  return `
;(() => {
  let input = "";
  let started = false;
  process.stdin.on("data", chunk => {
    input += chunk.toString("utf8");
    let end;
    while ((end = input.indexOf("\\n")) >= 0) {
      const line = input.slice(0, end); input = input.slice(end + 1);
      let request;
      try { request = JSON.parse(line); } catch { continue; }
      if (request.method === ${JSON.stringify(V4_METHODS.connectionInitialize)}) {
        process.stdout.write(JSON.stringify({ id: request.id, result: ${JSON.stringify(CURRENT_PROTOCOL_CONTRACT)} }) + "\\n");
        if (!started) { started = true; (function () { ${script} })(); }
      }
    }
  });
})();`;
}
