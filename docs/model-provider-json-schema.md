# Model provider file schema

The current Next-owned personal file format is defined by `packages/provider-node/src/provider-config-file-codec.ts`. Runtime provider/model values are defined by `packages/provider`; persistent file records are decoded at the Node repository boundary.

See [current provider configuration](model-provider-config-overrides.md) for ownership and [development data recovery](development-data-reset.md) for incompatible files. The historical catalog/DTO schemas and their importers have been retired under [ADR 0006](adr/0006-retire-pre-release-compatibility-debt.md).
