# Model provider presets

ZCode Next obtains current built-in provider/model definitions through `packages/provider-node/src/zcode-builtin-provider-config-source.ts`, its release materializer, and its remote synchronizer. Current account and entitlement configuration is assembled by `packages/services/src/model-provider`; personal configuration is stored in `provider_config.json` through `packages/provider-node`.

Built-in, account, and personal sources retain their existing owners and registry precedence. Current official account, model, subscription, Start allowance, and third-party provider integrations remain supported. Model lists and capability facts come from the checked-out configuration and actual service responses rather than a historical list in this document.

Old App provider DTOs, old provider-store imports, and historical provider/model identity conversions are retired before the Next release baseline. They are not reapplied during startup or refresh, and no old file is automatically deleted. Incompatible current-file contents fail with their path and manual recovery instructions; see [development data recovery](development-data-reset.md).

Current configuration behavior is covered by `packages/provider-node/test/provider-node-runtime.test.ts`, `packages/provider-node/test/personal-rule-persistence.test.ts`, and the service account-provider connection tests.
