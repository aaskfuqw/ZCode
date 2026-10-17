# Local diagnostics and engineering metrics

This fork keeps local troubleshooting evidence and explicit user exports. Automatic product telemetry and remote crash, performance, resource, and OTEL reporting were removed by [ADR 0002](../adr/0002-remove-automatic-telemetry.md).

- [Process memory diagnostic logs](./memory-diagnostics-log.md)
- [Session stop source diagnostics](./session-stop-source-diagnostics.md)
- [Local Desktop crash capture](../desktop/local-crash-capture.md)
- [Resource Manager](../electron/resource-manager.md)
- [E2E engineering metrics](./e2e-metrics-bitable-dashboard.md)

User-visible token, cost, context, and plan usage remain business data. Runtime logs stay local until the user explicitly exports them. The E2E metrics workflow is a separate engineering tool.
