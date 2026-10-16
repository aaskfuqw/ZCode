# OSS/CDN 多目标分发

## 背景

桌面端安装包与 remote runtime 资产需要同时分发到多组 OSS/CDN 目标。桌面端不提供应用内自动更新，因此分发只涉及安装包和 remote assets，不涉及更新清单。

## CI 变量模型

多目标切换只通过 CI 环境变量完成：

```bash
CDN_DOMAIN=cdn-zcode.z.ai,cdn.zcode-ai.com,cdn.codegeex.cn
OSS_BUCKET=new-bucket,old-bucket-a,old-bucket-b
OSS_PATH_PREFIX=zcode/electron/releases
OSS_CONFIG_FILE=/etc/ossutil/new,/etc/ossutil/old-a,/etc/ossutil/old-b
```

- `CDN_DOMAIN` 支持逗号分隔列表；第一项是打包写入客户端和 release API 使用的主域名。
- `OSS_BUCKET` 支持逗号分隔列表；必须是单值，或与 `CDN_DOMAIN` 数量一致。
- `OSS_PATH_PREFIX` 支持单值复用；如果配置多值，也必须与 `CDN_DOMAIN` 数量一致。

## 每个目标上传内容

每组 `{domain, bucket, pathPrefix}` 都必须有完整产物：

```text
oss://<bucket>/<pathPrefix>/<version>/
  ZCode-...
  manifest-*.json

oss://<bucket>/<pathPrefix>/components/**
```

`manifest-*.json` 必须进入版本目录；同一版本目录按不可变资产处理，不覆盖。

## 验证

- `ci*` 分支先验证多目标上传、预热和 publish。
- 验证 remote runtime 在每组 CDN 都能拉到 `manifest-*.json` 和 `components/**`。
