# Current model metadata ownership

Built-in provider/model metadata is loaded and materialized by `packages/provider-node/src/zcode-builtin-provider-config-source.ts` and `packages/provider-node/src/zcode-builtin-provider-config-materializer.ts`. Registry configuration and model overlays are defined in `packages/provider`; personal edits are persisted through the current `provider_config.json` codec and repository.

The old App catalog DTO, provider-store conversion, and rollback-file maintenance paths have been retired. Current official services, account entitlements, custom models, and external provider option mappings remain separate supported behavior. See [configuration ownership](model-provider-config-overrides.md) and [ADR 0006](adr/0006-retire-pre-release-compatibility-debt.md).
