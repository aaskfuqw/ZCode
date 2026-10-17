# Model provider configuration overrides

Current provider and model configuration is owned by the registry in `packages/provider` and its Node persistence and source adapters in `packages/provider-node`.

Personal configuration uses `provider_config.json`, parsed by `packages/provider-node/src/provider-config-file-codec.ts` and read/written through `NodePersonalProviderConfigRepository`. App and CLI composition use `createNodeProviderConfigRuntime`; they do not import the old App provider DTO or the old CLI root provider/model configuration.

Model and provider overlays are resolved by `packages/provider/src/config/model-config.ts` and the current registry rules. Explicit personal configuration remains user-owned. Current built-in and account sources provide their own model facts; removing an old importer must not turn a personal value into a default or expand an account entitlement.

Reading a valid current personal file does not rewrite it. Invalid or obsolete personal data fails with its actual file path and manual repair/reset guidance. See [development data recovery](development-data-reset.md) and [ADR 0006](adr/0006-retire-pre-release-compatibility-debt.md).
