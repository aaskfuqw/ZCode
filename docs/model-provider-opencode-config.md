# Current provider configuration

Next's current personal provider/model file is `provider_config.json`, owned by `NodePersonalProviderConfigRepository` in `packages/provider-node`. Built-in and account sources are separate registry inputs. See [configuration ownership and overrides](model-provider-config-overrides.md) and [provider presets](model-provider-presets.md).

The former first-party provider-map transition and its migration readers are retired. They do not define a supported Next data format; old development files require the [manual recovery workflow](development-data-reset.md) when selected as current input. Current third-party provider integrations retain their own external contracts.
