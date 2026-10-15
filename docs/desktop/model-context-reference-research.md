# 模型容量采集记录（2026-10-15）

这是公开参数的客户端兜底表。参数来源包括官方模型文档与 models.dev 联网目录；接口明确值、用户手动设置优先。没有用真实模型调用探测长度。

## 当前已接入与旧缓存型号

| 567 API 型号 | 输入容量参考 | 输出上限参考 | 依据 |
|---|---:|---:|---|
| `agnes-image-2.0-flash` | 未公开 | 未公开 | [agnes-image-2.0-flash](https://agnes-ai.com/en/docs/agnes-image-20-flash) · 未公开 |
| `agnes-image-2.1-flash` | 未公开 | 未公开 | [agnes-image-2.1-flash](https://agnes-ai.com/en/docs/agnes-image-21-flash) · 未公开 |
| `agnes-image-2.5-flash` | 未公开 | 未公开 | [agnes-image-2.5-flash](https://github.com/AgnesAI-Labs/AgnesAI-Models) · 未公开 |
| `gemini-3-flash` | 1,048,576 | 65,536 | [gemini-3-flash-preview](https://ai.google.dev/gemini-api/docs/models/gemini-3-flash-preview) · 显式别名参考，网关未确认 |
| `gemini-3.1-flash-image` | 131,072 | 32,768 | [gemini-3.1-flash-image](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-image) · 官方型号参考 |
| `gemini-3.1-flash-lite` | 1,048,576 | 65,536 | [gemini-3.1-flash-lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite) · 官方型号参考 |
| `gemini-3.1-pro-low` | 1,048,576 | 65,536 | [gemini-3.1-pro-preview](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview) · 显式别名参考，网关未确认 |
| `gemini-3.5-flash-lite` | 1,048,576 | 65,536 | [gemini-3.5-flash-lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite) · 官方型号参考 |
| `gemini-3.6-flash-high` | 1,048,576 | 65,536 | [gemini-3.6-flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash) · 显式别名参考，网关未确认 |
| `gemini-3.7-flash-high` | 1,048,576 | 65,536 | [gemini-3.7-flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.7-flash) · 显式别名参考，网关未确认 |
| `gemini-3.8-flash-high` | 1,048,576 | 65,536 | [gemini-3.8-flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash) · 显式别名参考，网关未确认 |
| `gemini-pro-agent` | 未公开 | 未公开 | [gemini-pro-agent](https://api.567.wiki/v1/models) · 未公开 |
| `gpt-image-2` | 未公开 | 未公开 | [gpt-image-2](https://developers.openai.com/api/docs/models/gpt-image-2) · 未公开 |
| `gpt-image-2-web` | 未公开 | 未公开 | [gpt-image-2-web](https://developers.openai.com/api/docs/models/gpt-image-2) · 未公开 |
| `gpt-image-2.5-flare` | 未公开 | 未公开 | [gpt-image-2.5-flare](https://api.567.wiki/v1/models) · 未公开 |
| `gpt-image-2.5-sunburst` | 未公开 | 未公开 | [gpt-image-2.5-sunburst](https://api.567.wiki/v1/models) · 未公开 |

当前 16 个已接入或旧缓存型号逐项记录，8 个能获得上游容量参考、8 个未公开。已接入两组的 API 实测模型列表没有容量字段；单模型详情返回 model_not_found；其他账户元数据入口因过期访问令牌返回 401。因此原厂或目录值都不能当成 567 路由限制已经得到验证。尚未取得其他未接入分组的完整型号清单。

## 主流模型完整参考目录

本次采集包含 22 个 models.dev 来源，加上官方文心目录，共 23 个模型来源。包含 OpenAI、Anthropic、Google、DeepSeek、GLM、Kimi、Qwen、Grok、MiniMax、Mistral、豆包、文心、混元、阶跃、MiMo、Cohere、AI21、百灵、Meta、Llama、Perplexity，以及 Amazon/NVIDIA 自有型号。来源数并非独立厂商数量，例如 Meta 和 Llama 分列；同名型号按较小容量合并，Amazon/NVIDIA 不借其转售条目推断其他厂商的参数。

共 408 条型号/别名参考记录，381 条有容量参考，27 条容量未知（包含无聊天上下文概念的图像、音视频及辅助模型）。384 条有输出上限资料，214 条有思考控制形式/档位资料，47 条补充了官方采样规则来源。温度和 Top-P、工具调用、思考能力、输入输出类型分别保留三态：已支持、明确不支持、未知。没有资料的字段不会补默认值。

### 数据边界与来源

- 容量、最大输入、最大输出分别记录，不能相互替代；官方只提供 k 缩写且未明确换算时，按 1,000 tokens 保守取值并保留说明。
- 原厂和 models.dev 数据是参考，不能证明 567 网关某路由的实际能力。未列入的代理别名不按名称猜测，手动容量和 API 明确容量优先。
- 温度/Top-P 范围是资料，不能被当成所有模式都允许的请求参数。DeepSeek 思考模式、GPT-6 的 none 档位及 Claude 新型号的采样限制均有单独说明；没有统一向模型请求强塞采样参数。
- 客户端可手动修改容量；能力标识和采样资料只读。输出上限参考不等于用户选择的本次回复预算。
- 公共目录：[models.dev API](https://models.dev/api.json)。其是社区维护目录，不等于逐一经过原厂确认；仅官方覆盖的字段标有官方资料链接。
- [MiniMax Anthropic 接口](https://platform.minimax.io/docs/api-reference/text-anthropic-api)：补充 M3.1、M3、M2.x；特别记录 M2.x 始终思考、M3.1 不接受关闭思考。
- [Mistral 模型目录](https://docs.mistral.ai/models)、[采样说明](https://docs.mistral.ai/inference/sampling)。
- [火山方舟模型列表](https://docs.volcengine.com/docs/ark/model-list?lang=zh&redirect=1)：核对 Seed 新型号与独立最大输入。
- [百度千帆模型表](https://intl.cloud.baidu.com/en/doc/qianfan/s/7m95lyy43-intl-en)：补充 ERNIE 5.1/5.0/4.5 Turbo 系列。
- [Claude 思考兼容性](https://platform.claude.com/docs/en/build-with-claude/thinking)：新型号不支持自定义采样值。
- [Gemini generation config](https://ai.google.dev/api/generate-content)、[DeepSeek 参数](https://api-docs.deepseek.com/api/create-chat-completion/)、[OpenAI GPT-6 参数兼容性](https://developers.openai.com/api/docs/guides/latest-model)、[Qwen 文本生成参数](https://help.aliyun.com/zh/model-studio/text-generation)。

### 目录来源条数（合并前）

| 来源 | 记录数 |
|---|---:|
| `google` | 40 |
| `openai` | 53 |
| `anthropic` | 17 |
| `deepseek` | 4 |
| `zai` | 18 |
| `moonshotai` | 4 |
| `alibaba` | 59 |
| `xai` | 13 |
| `minimax` | 7 |
| `mistral` | 42 |
| `volcengine` | 16 |
| `cohere` | 17 |
| `ai21` | 2 |
| `stepfun` | 9 |
| `xiaomi` | 9 |
| `tencent-tokenhub` | 3 |
| `bailing` | 2 |
| `meta` | 6 |
| `llama` | 7 |
| `perplexity` | 4 |
| `amazon-bedrock` | 17 |
| `nvidia` | 40 |

### 全部型号

| 型号 | 上下文参考 | 最大输入参考 | 最大输出参考 | 来源 |
|---|---:|---:|---:|---|
| `Ling-1T` | 128,000 | 未知 | 32,000 | [资料](https://models.dev/api.json) |
| `MiniMax-M2` | 204,800 | 未知 | 131,072 | [资料](https://models.dev/api.json) |
| `MiniMax-M2.1` | 204,800 | 未知 | 131,072 | [资料](https://models.dev/api.json) |
| `MiniMax-M2.1-highspeed` | 204,800 | 未知 | 未知 | [资料](https://platform.minimax.io/docs/api-reference/text-anthropic-api) |
| `MiniMax-M2.5` | 204,800 | 未知 | 131,072 | [资料](https://models.dev/api.json) |
| `MiniMax-M2.5-highspeed` | 204,800 | 未知 | 131,072 | [资料](https://models.dev/api.json) |
| `MiniMax-M2.7` | 204,800 | 未知 | 131,072 | [资料](https://models.dev/api.json) |
| `MiniMax-M2.7-highspeed` | 204,800 | 未知 | 131,072 | [资料](https://models.dev/api.json) |
| `MiniMax-M3` | 1,000,000 | 未知 | 512,000 | [资料](https://models.dev/api.json) |
| `MiniMax-M3.1-Flash-Preview` | 1,000,000 | 未知 | 未知 | [资料](https://platform.minimax.io/docs/api-reference/text-anthropic-api) |
| `Ring-1T` | 128,000 | 未知 | 32,000 | [资料](https://models.dev/api.json) |
| `agnes-image-2.0-flash` | 未知 | 未知 | 未知 | [资料](https://agnes-ai.com/en/docs/agnes-image-20-flash) |
| `agnes-image-2.1-flash` | 未知 | 未知 | 未知 | [资料](https://agnes-ai.com/en/docs/agnes-image-21-flash) |
| `agnes-image-2.5-flash` | 未知 | 未知 | 未知 | [资料](https://github.com/AgnesAI-Labs/AgnesAI-Models) |
| `amazon.nova-2-lite-v1:0` | 1,000,000 | 未知 | 65,535 | [资料](https://models.dev/api.json) |
| `amazon.nova-lite-v1:0` | 300,000 | 未知 | 10,000 | [资料](https://models.dev/api.json) |
| `amazon.nova-micro-v1:0` | 128,000 | 未知 | 10,000 | [资料](https://models.dev/api.json) |
| `amazon.nova-pro-v1:0` | 300,000 | 未知 | 10,000 | [资料](https://models.dev/api.json) |
| `apac.amazon.nova-lite-v1:0` | 300,000 | 未知 | 10,000 | [资料](https://models.dev/api.json) |
| `apac.amazon.nova-micro-v1:0` | 128,000 | 未知 | 10,000 | [资料](https://models.dev/api.json) |
| `apac.amazon.nova-pro-v1:0` | 300,000 | 未知 | 10,000 | [资料](https://models.dev/api.json) |
| `c4ai-aya-expanse-32b` | 128,000 | 未知 | 4,000 | [资料](https://models.dev/api.json) |
| `c4ai-aya-vision-32b` | 16,000 | 未知 | 4,000 | [资料](https://models.dev/api.json) |
| `cerebras-llama-4-maverick-17b-128e-instruct` | 128,000 | 未知 | 4,096 | [资料](https://models.dev/api.json) |
| `cerebras-llama-4-scout-17b-16e-instruct` | 128,000 | 未知 | 4,096 | [资料](https://models.dev/api.json) |
| `chatgpt-image-latest` | 未知 | 未知 | 未知 | [资料](https://models.dev/api.json) |
| `claude-fable-5` | 1,000,000 | 未知 | 128,000 | [资料](https://models.dev/api.json) |
| `claude-fable-5-1` | 1,000,000 | 未知 | 128,000 | [资料](https://models.dev/api.json) |
| `claude-haiku-4-5` | 200,000 | 未知 | 64,000 | [资料](https://models.dev/api.json) |
| `claude-haiku-4-5-20251001` | 200,000 | 未知 | 64,000 | [资料](https://models.dev/api.json) |
| `claude-haiku-5-5` | 1,000,000 | 未知 | 128,000 | [资料](https://models.dev/api.json) |
| `claude-opus-4-5` | 200,000 | 未知 | 64,000 | [资料](https://models.dev/api.json) |
| `claude-opus-4-5-20251101` | 200,000 | 未知 | 64,000 | [资料](https://models.dev/api.json) |
| `claude-opus-4-6` | 1,000,000 | 未知 | 128,000 | [资料](https://models.dev/api.json) |
| `claude-opus-4-7` | 1,000,000 | 未知 | 128,000 | [资料](https://models.dev/api.json) |
| `claude-opus-4-8` | 1,000,000 | 未知 | 128,000 | [资料](https://models.dev/api.json) |
| `claude-opus-5` | 1,000,000 | 未知 | 128,000 | [资料](https://models.dev/api.json) |
| `claude-opus-5-5` | 1,000,000 | 未知 | 128,000 | [资料](https://models.dev/api.json) |
| `claude-sonnet-4-5` | 200,000 | 未知 | 64,000 | [资料](https://models.dev/api.json) |
| `claude-sonnet-4-5-20250929` | 200,000 | 未知 | 64,000 | [资料](https://models.dev/api.json) |
| `claude-sonnet-4-6` | 1,000,000 | 未知 | 128,000 | [资料](https://models.dev/api.json) |
| `claude-sonnet-5` | 1,000,000 | 未知 | 128,000 | [资料](https://models.dev/api.json) |
| `claude-sonnet-5-5` | 1,000,000 | 未知 | 128,000 | [资料](https://models.dev/api.json) |
| `codestral-2508` | 256,000 | 未知 | 8,192 | [资料](https://models.dev/api.json) |
| `codestral-latest` | 256,000 | 未知 | 4,096 | [资料](https://models.dev/api.json) |
| `command-a-03-2025` | 256,000 | 未知 | 8,000 | [资料](https://models.dev/api.json) |
| `command-a-plus-05-2026` | 128,000 | 未知 | 64,000 | [资料](https://models.dev/api.json) |
| `command-a-reasoning-08-2025` | 256,000 | 未知 | 32,000 | [资料](https://models.dev/api.json) |
| `command-a-translate-08-2025` | 8,000 | 未知 | 8,000 | [资料](https://models.dev/api.json) |
| `command-a-vision-07-2025` | 128,000 | 未知 | 8,000 | [资料](https://models.dev/api.json) |
| `command-r-08-2024` | 128,000 | 未知 | 4,000 | [资料](https://models.dev/api.json) |
| `command-r-plus-08-2024` | 128,000 | 未知 | 4,000 | [资料](https://models.dev/api.json) |
| `command-r7b-12-2024` | 128,000 | 未知 | 4,000 | [资料](https://models.dev/api.json) |
| `command-r7b-arabic-02-2025` | 128,000 | 未知 | 4,000 | [资料](https://models.dev/api.json) |
| `deep-research-max-preview-04-2026` | 131,072 | 未知 | 65,536 | [资料](https://models.dev/api.json) |
| `deep-research-preview-04-2026` | 131,072 | 未知 | 65,536 | [资料](https://models.dev/api.json) |
| `deepseek-flash` | 1,000,000 | 未知 | 393,216 | [资料](https://models.dev/api.json) |
| `deepseek-v4-flash` | 1,000,000 | 未知 | 393,216 | [资料](https://models.dev/api.json) |
| `deepseek-v4-flash-0731` | 1,000,000 | 未知 | 384,000 | [资料](https://models.dev/api.json) |
| `deepseek-v4-flash-ga-260731` | 1,000,000 | 未知 | 384,000 | [资料](https://models.dev/api.json) |
| `deepseek-v4-flash-vision-exp` | 1,000,000 | 未知 | 393,216 | [资料](https://models.dev/api.json) |
| `deepseek-v4-pro` | 1,000,000 | 未知 | 393,216 | [资料](https://models.dev/api.json) |
| `deepseek-v4-pro-ga-260813` | 1,000,000 | 未知 | 384,000 | [资料](https://models.dev/api.json) |
| `devstral-2512` | 262,144 | 未知 | 262,144 | [资料](https://models.dev/api.json) |
| `devstral-latest` | 262,144 | 未知 | 262,144 | [资料](https://models.dev/api.json) |
| `devstral-medium-2507` | 128,000 | 未知 | 128,000 | [资料](https://models.dev/api.json) |
| `devstral-medium-latest` | 262,144 | 未知 | 262,144 | [资料](https://models.dev/api.json) |
| `devstral-small-2505` | 128,000 | 未知 | 128,000 | [资料](https://models.dev/api.json) |
| `devstral-small-2507` | 128,000 | 未知 | 128,000 | [资料](https://models.dev/api.json) |
| `doubao-seed-1-6-251015` | 256,000 | 未知 | 64,000 | [资料](https://models.dev/api.json) |
| `doubao-seed-1-6-flash-250828` | 256,000 | 未知 | 32,000 | [资料](https://models.dev/api.json) |
| `doubao-seed-1-6-vision-250815` | 256,000 | 未知 | 32,000 | [资料](https://models.dev/api.json) |
| `doubao-seed-1-8-251228` | 256,000 | 未知 | 64,000 | [资料](https://models.dev/api.json) |
| `doubao-seed-2-0-code-preview-260215` | 262,144 | 未知 | 131,072 | [资料](https://models.dev/api.json) |
| `doubao-seed-2-0-lite-260428` | 256,000 | 224,000 | 128,000 | [资料](https://docs.volcengine.com/docs/ark/model-list?lang=zh&redirect=1) |
| `doubao-seed-2-0-mini-260428` | 256,000 | 224,000 | 128,000 | [资料](https://docs.volcengine.com/docs/ark/model-list?lang=zh&redirect=1) |
| `doubao-seed-2-0-pro-260215` | 256,000 | 未知 | 128,000 | [资料](https://models.dev/api.json) |
| `doubao-seed-2-1-pro-260628` | 256,000 | 未知 | 256,000 | [资料](https://models.dev/api.json) |
| `doubao-seed-2-1-pro-260915` | 1,024,000 | 1,024,000 | 256,000 | [资料](https://docs.volcengine.com/docs/ark/model-list?lang=zh&redirect=1) |
| `doubao-seed-2-1-turbo-260628` | 256,000 | 未知 | 256,000 | [资料](https://models.dev/api.json) |
| `doubao-seed-character-260628` | 256,000 | 未知 | 256,000 | [资料](https://models.dev/api.json) |
| `doubao-seed-evolving` | 1,024,000 | 1,024,000 | 256,000 | [资料](https://docs.volcengine.com/docs/ark/model-list?lang=zh&redirect=1) |
| `ernie-4.5-turbo-128k` | 128,000 | 123,000 | 12,288 | [资料](https://intl.cloud.baidu.com/en/doc/qianfan/s/7m95lyy43-intl-en) |
| `ernie-4.5-turbo-32k` | 32,000 | 27,000 | 12,288 | [资料](https://intl.cloud.baidu.com/en/doc/qianfan/s/7m95lyy43-intl-en) |
| `ernie-4.5-turbo-vl` | 128,000 | 123,000 | 16,384 | [资料](https://intl.cloud.baidu.com/en/doc/qianfan/s/7m95lyy43-intl-en) |
| `ernie-4.5-turbo-vl-32k` | 32,000 | 27,000 | 12,288 | [资料](https://intl.cloud.baidu.com/en/doc/qianfan/s/7m95lyy43-intl-en) |
| `ernie-5.0` | 128,000 | 119,000 | 65,536 | [资料](https://intl.cloud.baidu.com/en/doc/qianfan/s/7m95lyy43-intl-en) |
| `ernie-5.1` | 128,000 | 119,000 | 65,536 | [资料](https://intl.cloud.baidu.com/en/doc/qianfan/s/7m95lyy43-intl-en) |
| `eu.amazon.nova-2-lite-v1:0` | 1,000,000 | 未知 | 65,535 | [资料](https://models.dev/api.json) |
| `eu.amazon.nova-lite-v1:0` | 300,000 | 未知 | 10,000 | [资料](https://models.dev/api.json) |
| `eu.amazon.nova-micro-v1:0` | 128,000 | 未知 | 10,000 | [资料](https://models.dev/api.json) |
| `eu.amazon.nova-pro-v1:0` | 300,000 | 未知 | 10,000 | [资料](https://models.dev/api.json) |
| `gemini-2.5-computer-use-preview-10-2025` | 128,000 | 未知 | 64,000 | [资料](https://models.dev/api.json) |
| `gemini-2.5-flash` | 1,048,576 | 未知 | 65,536 | [资料](https://models.dev/api.json) |
| `gemini-2.5-flash-image` | 32,768 | 未知 | 32,768 | [资料](https://models.dev/api.json) |
| `gemini-2.5-flash-lite` | 1,048,576 | 未知 | 65,536 | [资料](https://models.dev/api.json) |
| `gemini-2.5-flash-preview-tts` | 8,192 | 未知 | 16,384 | [资料](https://models.dev/api.json) |
| `gemini-2.5-pro` | 1,048,576 | 未知 | 65,536 | [资料](https://models.dev/api.json) |
| `gemini-2.5-pro-preview-tts` | 8,192 | 未知 | 16,384 | [资料](https://models.dev/api.json) |
| `gemini-3-flash` | 1,048,576 | 未知 | 65,536 | [资料](https://ai.google.dev/gemini-api/docs/models/gemini-3-flash-preview) |
| `gemini-3-flash-preview` | 1,048,576 | 未知 | 65,536 | [资料](https://ai.google.dev/gemini-api/docs/models/gemini-3-flash-preview) |
| `gemini-3-pro-image` | 65,536 | 未知 | 32,768 | [资料](https://models.dev/api.json) |
| `gemini-3-pro-image-preview` | 131,072 | 未知 | 32,768 | [资料](https://models.dev/api.json) |
| `gemini-3.1-flash-image` | 131,072 | 未知 | 32,768 | [资料](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-image) |
| `gemini-3.1-flash-image-preview` | 65,536 | 未知 | 65,536 | [资料](https://models.dev/api.json) |
| `gemini-3.1-flash-lite` | 1,048,576 | 未知 | 65,536 | [资料](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite) |
| `gemini-3.1-flash-lite-image` | 65,536 | 未知 | 4,096 | [资料](https://models.dev/api.json) |
| `gemini-3.1-flash-lite-preview` | 1,048,576 | 未知 | 65,536 | [资料](https://models.dev/api.json) |
| `gemini-3.1-flash-live-preview` | 131,072 | 未知 | 65,536 | [资料](https://models.dev/api.json) |
| `gemini-3.1-flash-tts-preview` | 8,192 | 未知 | 16,384 | [资料](https://models.dev/api.json) |
| `gemini-3.1-pro-low` | 1,048,576 | 未知 | 65,536 | [资料](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview) |
| `gemini-3.1-pro-preview` | 1,048,576 | 未知 | 65,536 | [资料](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview) |
| `gemini-3.1-pro-preview-customtools` | 1,048,576 | 未知 | 65,536 | [资料](https://models.dev/api.json) |
| `gemini-3.5-flash` | 1,048,576 | 未知 | 65,536 | [资料](https://models.dev/api.json) |
| `gemini-3.5-flash-lite` | 1,048,576 | 未知 | 65,536 | [资料](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite) |
| `gemini-3.5-live-translate-preview` | 16,384 | 未知 | 32,768 | [资料](https://models.dev/api.json) |
| `gemini-3.6-flash` | 1,048,576 | 未知 | 65,536 | [资料](https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash) |
| `gemini-3.6-flash-high` | 1,048,576 | 未知 | 65,536 | [资料](https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash) |
| `gemini-3.7-flash` | 1,048,576 | 未知 | 65,536 | [资料](https://ai.google.dev/gemini-api/docs/models/gemini-3.7-flash) |
| `gemini-3.7-flash-high` | 1,048,576 | 未知 | 65,536 | [资料](https://ai.google.dev/gemini-api/docs/models/gemini-3.7-flash) |
| `gemini-3.8-flash` | 1,048,576 | 未知 | 65,536 | [资料](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash) |
| `gemini-3.8-flash-high` | 1,048,576 | 未知 | 65,536 | [资料](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash) |
| `gemini-4-argon` | 1,048,576 | 未知 | 32,768 | [资料](https://models.dev/api.json) |
| `gemini-embedding-001` | 2,048 | 未知 | 1 | [资料](https://models.dev/api.json) |
| `gemini-embedding-2` | 8,192 | 未知 | 1 | [资料](https://models.dev/api.json) |
| `gemini-flash-latest` | 1,048,576 | 未知 | 65,536 | [资料](https://models.dev/api.json) |
| `gemini-flash-lite-latest` | 1,048,576 | 未知 | 65,536 | [资料](https://models.dev/api.json) |
| `gemini-omni-flash-preview` | 131,072 | 未知 | 65,536 | [资料](https://models.dev/api.json) |
| `gemini-pro-agent` | 未知 | 未知 | 未知 | [资料](https://api.567.wiki/v1/models) |
| `gemma-4-26b-a4b-it` | 262,144 | 未知 | 32,768 | [资料](https://models.dev/api.json) |
| `gemma-4-31b-it` | 262,144 | 未知 | 32,768 | [资料](https://models.dev/api.json) |
| `glm-4.5` | 131,072 | 未知 | 98,304 | [资料](https://models.dev/api.json) |
| `glm-4.5-air` | 131,072 | 未知 | 98,304 | [资料](https://models.dev/api.json) |
| `glm-4.5-flash` | 131,072 | 未知 | 98,304 | [资料](https://models.dev/api.json) |
| `glm-4.5v` | 64,000 | 未知 | 16,384 | [资料](https://models.dev/api.json) |
| `glm-4.6` | 204,800 | 未知 | 131,072 | [资料](https://models.dev/api.json) |
| `glm-4.6v` | 128,000 | 未知 | 32,768 | [资料](https://models.dev/api.json) |
| `glm-4.6v-flash` | 128,000 | 未知 | 32,768 | [资料](https://models.dev/api.json) |
| `glm-4.7` | 204,800 | 未知 | 131,072 | [资料](https://models.dev/api.json) |
| `glm-4.7-flash` | 200,000 | 未知 | 131,072 | [资料](https://models.dev/api.json) |
| `glm-4.7-flashx` | 200,000 | 未知 | 131,072 | [资料](https://models.dev/api.json) |
| `glm-5` | 204,800 | 未知 | 131,072 | [资料](https://models.dev/api.json) |
| `glm-5-2` | 1,048,576 | 未知 | 131,072 | [资料](https://models.dev/api.json) |
| `glm-5-2-260617` | 1,000,000 | 未知 | 131,072 | [资料](https://models.dev/api.json) |
| `glm-5-3-flash-260828` | 1,000,000 | 未知 | 131,072 | [资料](https://models.dev/api.json) |
| `glm-5-turbo` | 200,000 | 未知 | 131,072 | [资料](https://models.dev/api.json) |
| `glm-5.1` | 200,000 | 未知 | 131,072 | [资料](https://models.dev/api.json) |
| `glm-5.2` | 1,000,000 | 未知 | 131,072 | [资料](https://models.dev/api.json) |
| `glm-5.3` | 1,000,000 | 未知 | 131,072 | [资料](https://models.dev/api.json) |
| `glm-5.3-flash` | 1,000,000 | 未知 | 131,072 | [资料](https://models.dev/api.json) |
| `glm-5.3-flashx` | 1,000,000 | 未知 | 131,072 | [资料](https://models.dev/api.json) |
| `glm-5v-turbo` | 200,000 | 未知 | 131,072 | [资料](https://models.dev/api.json) |
| `global.amazon.nova-2-lite-v1:0` | 1,000,000 | 未知 | 65,535 | [资料](https://models.dev/api.json) |
| `gpt-3.5-turbo` | 16,385 | 未知 | 4,096 | [资料](https://models.dev/api.json) |
| `gpt-4` | 8,192 | 未知 | 8,192 | [资料](https://models.dev/api.json) |
| `gpt-4-turbo` | 128,000 | 未知 | 4,096 | [资料](https://models.dev/api.json) |
| `gpt-4.1` | 1,047,576 | 未知 | 32,768 | [资料](https://models.dev/api.json) |
| `gpt-4.1-mini` | 1,047,576 | 未知 | 32,768 | [资料](https://models.dev/api.json) |
| `gpt-4.1-nano` | 1,047,576 | 未知 | 32,768 | [资料](https://models.dev/api.json) |
| `gpt-4o` | 128,000 | 未知 | 16,384 | [资料](https://models.dev/api.json) |
| `gpt-4o-2024-05-13` | 128,000 | 未知 | 4,096 | [资料](https://models.dev/api.json) |
| `gpt-4o-2024-08-06` | 128,000 | 未知 | 16,384 | [资料](https://models.dev/api.json) |
| `gpt-4o-2024-11-20` | 128,000 | 未知 | 16,384 | [资料](https://models.dev/api.json) |
| `gpt-4o-mini` | 128,000 | 未知 | 16,384 | [资料](https://models.dev/api.json) |
| `gpt-5` | 400,000 | 272,000 | 128,000 | [资料](https://models.dev/api.json) |
| `gpt-5-mini` | 400,000 | 272,000 | 128,000 | [资料](https://models.dev/api.json) |
| `gpt-5-nano` | 400,000 | 272,000 | 128,000 | [资料](https://models.dev/api.json) |
| `gpt-5-pro` | 400,000 | 272,000 | 272,000 | [资料](https://models.dev/api.json) |
| `gpt-5.1` | 400,000 | 272,000 | 128,000 | [资料](https://models.dev/api.json) |
| `gpt-5.2` | 400,000 | 272,000 | 128,000 | [资料](https://models.dev/api.json) |
| `gpt-5.2-chat-latest` | 128,000 | 未知 | 16,384 | [资料](https://models.dev/api.json) |
| `gpt-5.2-pro` | 400,000 | 272,000 | 128,000 | [资料](https://models.dev/api.json) |
| `gpt-5.3-chat-latest` | 128,000 | 未知 | 16,384 | [资料](https://models.dev/api.json) |
| `gpt-5.3-codex` | 400,000 | 272,000 | 128,000 | [资料](https://models.dev/api.json) |
| `gpt-5.3-codex-spark` | 128,000 | 100,000 | 32,000 | [资料](https://models.dev/api.json) |
| `gpt-5.4` | 1,050,000 | 922,000 | 128,000 | [资料](https://models.dev/api.json) |
| `gpt-5.4-mini` | 400,000 | 272,000 | 128,000 | [资料](https://models.dev/api.json) |
| `gpt-5.4-nano` | 400,000 | 272,000 | 128,000 | [资料](https://models.dev/api.json) |
| `gpt-5.4-pro` | 1,050,000 | 922,000 | 128,000 | [资料](https://models.dev/api.json) |
| `gpt-5.5` | 1,050,000 | 922,000 | 128,000 | [资料](https://models.dev/api.json) |
| `gpt-5.5-pro` | 1,050,000 | 922,000 | 128,000 | [资料](https://models.dev/api.json) |
| `gpt-5.6` | 1,050,000 | 922,000 | 128,000 | [资料](https://models.dev/api.json) |
| `gpt-5.6-luna` | 1,050,000 | 922,000 | 128,000 | [资料](https://models.dev/api.json) |
| `gpt-5.6-sol` | 1,050,000 | 922,000 | 128,000 | [资料](https://models.dev/api.json) |
| `gpt-5.6-terra` | 1,050,000 | 922,000 | 128,000 | [资料](https://models.dev/api.json) |
| `gpt-6-astra` | 1,050,000 | 922,000 | 128,000 | [资料](https://models.dev/api.json) |
| `gpt-6-luna` | 1,050,000 | 922,000 | 128,000 | [资料](https://models.dev/api.json) |
| `gpt-6-sol` | 1,050,000 | 922,000 | 128,000 | [资料](https://models.dev/api.json) |
| `gpt-6.1-sol` | 1,050,000 | 922,000 | 128,000 | [资料](https://models.dev/api.json) |
| `gpt-daybreak-blue-latest` | 1,050,000 | 922,000 | 128,000 | [资料](https://models.dev/api.json) |
| `gpt-daybreak-red-latest` | 400,000 | 272,000 | 128,000 | [资料](https://models.dev/api.json) |
| `gpt-image-1` | 未知 | 未知 | 未知 | [资料](https://models.dev/api.json) |
| `gpt-image-1-mini` | 未知 | 未知 | 未知 | [资料](https://models.dev/api.json) |
| `gpt-image-1.5` | 未知 | 未知 | 未知 | [资料](https://models.dev/api.json) |
| `gpt-image-2` | 未知 | 未知 | 未知 | [资料](https://developers.openai.com/api/docs/models/gpt-image-2) |
| `gpt-image-2-web` | 未知 | 未知 | 未知 | [资料](https://developers.openai.com/api/docs/models/gpt-image-2) |
| `gpt-image-2.5-flare` | 未知 | 未知 | 未知 | [资料](https://api.567.wiki/v1/models) |
| `gpt-image-2.5-sunburst` | 未知 | 未知 | 未知 | [资料](https://api.567.wiki/v1/models) |
| `gpt-realtime-2.1` | 128,000 | 96,000 | 32,000 | [资料](https://models.dev/api.json) |
| `grok-4.20-0309-non-reasoning` | 1,000,000 | 未知 | 30,000 | [资料](https://models.dev/api.json) |
| `grok-4.20-0309-reasoning` | 1,000,000 | 未知 | 30,000 | [资料](https://models.dev/api.json) |
| `grok-4.20-multi-agent-0309` | 1,000,000 | 未知 | 30,000 | [资料](https://models.dev/api.json) |
| `grok-4.3` | 1,000,000 | 未知 | 30,000 | [资料](https://models.dev/api.json) |
| `grok-4.5` | 500,000 | 未知 | 500,000 | [资料](https://models.dev/api.json) |
| `grok-4.6` | 500,000 | 未知 | 500,000 | [资料](https://models.dev/api.json) |
| `grok-4.7` | 500,000 | 未知 | 500,000 | [资料](https://models.dev/api.json) |
| `grok-build-0.1` | 256,000 | 未知 | 256,000 | [资料](https://models.dev/api.json) |
| `grok-imagine-image` | 16,000 | 未知 | 未知 | [资料](https://models.dev/api.json) |
| `grok-imagine-image-quality` | 16,000 | 未知 | 未知 | [资料](https://models.dev/api.json) |
| `grok-imagine-video` | 1,024 | 未知 | 未知 | [资料](https://models.dev/api.json) |
| `grok-imagine-video-1.5` | 1,024 | 未知 | 未知 | [资料](https://models.dev/api.json) |
| `grok-imagine-video-1.5-lite` | 1,024 | 未知 | 未知 | [资料](https://models.dev/api.json) |
| `groq-llama-4-maverick-17b-128e-instruct` | 128,000 | 未知 | 4,096 | [资料](https://models.dev/api.json) |
| `hy3` | 256,000 | 192,000 | 128,000 | [资料](https://models.dev/api.json) |
| `hy3-preview` | 256,000 | 未知 | 64,000 | [资料](https://models.dev/api.json) |
| `hy4-preview` | 1,024,000 | 未知 | 64,000 | [资料](https://models.dev/api.json) |
| `jamba-large` | 256,000 | 未知 | 4,096 | [资料](https://models.dev/api.json) |
| `jamba-mini` | 256,000 | 未知 | 4,096 | [资料](https://models.dev/api.json) |
| `kimi-k2.6` | 262,144 | 未知 | 262,144 | [资料](https://models.dev/api.json) |
| `kimi-k2.7-code` | 262,144 | 未知 | 262,144 | [资料](https://models.dev/api.json) |
| `kimi-k2.7-code-highspeed` | 262,144 | 未知 | 262,144 | [资料](https://models.dev/api.json) |
| `kimi-k3` | 1,048,576 | 未知 | 1,048,576 | [资料](https://models.dev/api.json) |
| `labs-devstral-small-2512` | 256,000 | 未知 | 256,000 | [资料](https://models.dev/api.json) |
| `labs-leanstral-1-5-1` | 262,144 | 未知 | 128,000 | [资料](https://models.dev/api.json) |
| `llama-3.3-70b-instruct` | 128,000 | 未知 | 4,096 | [资料](https://models.dev/api.json) |
| `llama-3.3-8b-instruct` | 128,000 | 未知 | 4,096 | [资料](https://models.dev/api.json) |
| `llama-4-maverick-17b-128e-instruct-fp8` | 128,000 | 未知 | 4,096 | [资料](https://models.dev/api.json) |
| `llama-4-scout-17b-16e-instruct-fp8` | 128,000 | 未知 | 4,096 | [资料](https://models.dev/api.json) |
| `lyria-3-clip-preview` | 1,048,576 | 未知 | 65,536 | [资料](https://models.dev/api.json) |
| `lyria-3-pro-preview` | 1,048,576 | 未知 | 65,536 | [资料](https://models.dev/api.json) |
| `magistral-medium-latest` | 262,144 | 未知 | 16,384 | [资料](https://models.dev/api.json) |
| `mimo-v2-flash` | 262,144 | 未知 | 65,536 | [资料](https://models.dev/api.json) |
| `mimo-v2-omni` | 262,144 | 未知 | 131,072 | [资料](https://models.dev/api.json) |
| `mimo-v2-pro` | 1,048,576 | 未知 | 131,072 | [资料](https://models.dev/api.json) |
| `mimo-v2.5` | 1,048,576 | 未知 | 131,072 | [资料](https://models.dev/api.json) |
| `mimo-v2.5-pro` | 1,048,576 | 未知 | 131,072 | [资料](https://models.dev/api.json) |
| `mimo-v2.5-pro-ultraspeed` | 1,048,576 | 未知 | 131,072 | [资料](https://models.dev/api.json) |
| `mimo-v2.6-flash` | 1,048,576 | 未知 | 131,072 | [资料](https://models.dev/api.json) |
| `mimo-v2.6-pro` | 1,048,576 | 未知 | 131,072 | [资料](https://models.dev/api.json) |
| `mimo-v2.6-pro-ultraspeed` | 1,048,576 | 未知 | 131,072 | [资料](https://models.dev/api.json) |
| `ministral-14b-2512` | 262,144 | 未知 | 262,144 | [资料](https://models.dev/api.json) |
| `ministral-3b-2512` | 131,072 | 未知 | 262,144 | [资料](https://models.dev/api.json) |
| `ministral-3b-latest` | 131,072 | 未知 | 128,000 | [资料](https://models.dev/api.json) |
| `ministral-8b-2512` | 262,144 | 未知 | 262,144 | [资料](https://models.dev/api.json) |
| `ministral-8b-latest` | 262,144 | 未知 | 128,000 | [资料](https://models.dev/api.json) |
| `mistral-embed` | 8,000 | 未知 | 3,072 | [资料](https://models.dev/api.json) |
| `mistral-large-2411` | 131,072 | 未知 | 16,384 | [资料](https://models.dev/api.json) |
| `mistral-large-2512` | 262,144 | 未知 | 262,144 | [资料](https://models.dev/api.json) |
| `mistral-large-4` | 1,048,576 | 未知 | 262,144 | [资料](https://models.dev/api.json) |
| `mistral-large-latest` | 262,144 | 未知 | 262,144 | [资料](https://models.dev/api.json) |
| `mistral-medium-2505` | 131,072 | 未知 | 131,072 | [资料](https://models.dev/api.json) |
| `mistral-medium-2508` | 262,144 | 未知 | 262,144 | [资料](https://models.dev/api.json) |
| `mistral-medium-2604` | 262,144 | 未知 | 262,144 | [资料](https://models.dev/api.json) |
| `mistral-medium-latest` | 262,144 | 未知 | 262,144 | [资料](https://models.dev/api.json) |
| `mistral-nemo` | 128,000 | 未知 | 128,000 | [资料](https://models.dev/api.json) |
| `mistral-small-2506` | 128,000 | 未知 | 16,384 | [资料](https://models.dev/api.json) |
| `mistral-small-2603` | 262,144 | 未知 | 256,000 | [资料](https://models.dev/api.json) |
| `mistral-small-latest` | 262,144 | 未知 | 256,000 | [资料](https://models.dev/api.json) |
| `muse-spark-1.1` | 1,048,576 | 未知 | 131,072 | [资料](https://models.dev/api.json) |
| `muse-spark-1.2` | 1,048,576 | 未知 | 131,072 | [资料](https://models.dev/api.json) |
| `muse-spark-1.2-contributor` | 1,048,576 | 未知 | 131,072 | [资料](https://models.dev/api.json) |
| `muse-spark-1.3` | 1,048,576 | 未知 | 131,072 | [资料](https://models.dev/api.json) |
| `muse-spark-1.3-contributor` | 1,048,576 | 未知 | 131,072 | [资料](https://models.dev/api.json) |
| `muse-wonder-1.0` | 1,048,576 | 未知 | 131,072 | [资料](https://models.dev/api.json) |
| `north-mini-code-1-0` | 256,000 | 未知 | 64,000 | [资料](https://models.dev/api.json) |
| `north-small-translate-09-2026` | 32,768 | 未知 | 16,000 | [资料](https://models.dev/api.json) |
| `nvidia/active-speaker-detection` | 未知 | 未知 | 4,096 | [资料](https://models.dev/api.json) |
| `nvidia/bevformer` | 128,000 | 未知 | 8,192 | [资料](https://models.dev/api.json) |
| `nvidia/cosmos-predict1-5b` | 未知 | 未知 | 4,096 | [资料](https://models.dev/api.json) |
| `nvidia/cosmos-reason2-8b` | 131,072 | 未知 | 16,384 | [资料](https://models.dev/api.json) |
| `nvidia/cosmos-transfer1-7b` | 未知 | 未知 | 4,096 | [资料](https://models.dev/api.json) |
| `nvidia/cosmos-transfer2_5-2b` | 未知 | 未知 | 4,096 | [资料](https://models.dev/api.json) |
| `nvidia/gliner-pii` | 128,000 | 未知 | 4,096 | [资料](https://models.dev/api.json) |
| `nvidia/llama-3.1-nemotron-70b-instruct` | 128,000 | 未知 | 8,192 | [资料](https://models.dev/api.json) |
| `nvidia/llama-3.1-nemotron-nano-8b-v1` | 131,072 | 未知 | 16,384 | [资料](https://models.dev/api.json) |
| `nvidia/llama-3.1-nemotron-nano-vl-8b-v1` | 32,768 | 未知 | 16,384 | [资料](https://models.dev/api.json) |
| `nvidia/llama-3.1-nemotron-safety-guard-8b-v3` | 128,000 | 未知 | 4,096 | [资料](https://models.dev/api.json) |
| `nvidia/llama-3.1-nemotron-ultra-253b-v1` | 128,000 | 未知 | 16,384 | [资料](https://models.dev/api.json) |
| `nvidia/llama-3.3-nemotron-super-49b-v1` | 131,072 | 未知 | 65,536 | [资料](https://models.dev/api.json) |
| `nvidia/llama-3.3-nemotron-super-49b-v1.5` | 131,072 | 未知 | 65,536 | [资料](https://models.dev/api.json) |
| `nvidia/llama-3_2-nemoretriever-300m-embed-v1` | 32,768 | 未知 | 2,048 | [资料](https://models.dev/api.json) |
| `nvidia/llama-nemotron-embed-vl-1b-v2` | 32,768 | 未知 | 2,048 | [资料](https://models.dev/api.json) |
| `nvidia/llama-nemotron-rerank-vl-1b-v2` | 128,000 | 未知 | 4,096 | [资料](https://models.dev/api.json) |
| `nvidia/magpie-tts-zeroshot` | 未知 | 未知 | 4,096 | [资料](https://models.dev/api.json) |
| `nvidia/nemotron-3-content-safety` | 128,000 | 未知 | 4,096 | [资料](https://models.dev/api.json) |
| `nvidia/nemotron-3-nano-30b-a3b` | 131,072 | 未知 | 131,072 | [资料](https://models.dev/api.json) |
| `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` | 256,000 | 未知 | 65,536 | [资料](https://models.dev/api.json) |
| `nvidia/nemotron-3-ultra-550b-a55b` | 1,000,000 | 未知 | 65,536 | [资料](https://models.dev/api.json) |
| `nvidia/nemotron-3.5-content-safety` | 128,000 | 未知 | 8,192 | [资料](https://models.dev/api.json) |
| `nvidia/nemotron-3.5-lightning-30b-a3b` | 262,144 | 未知 | 262,144 | [资料](https://models.dev/api.json) |
| `nvidia/nemotron-3.5-super-vl-120b-a12b` | 1,048,576 | 未知 | 8,192 | [资料](https://models.dev/api.json) |
| `nvidia/nemotron-content-safety-reasoning-4b` | 128,000 | 未知 | 4,096 | [资料](https://models.dev/api.json) |
| `nvidia/nemotron-mini-4b-instruct` | 128,000 | 未知 | 8,192 | [资料](https://models.dev/api.json) |
| `nvidia/nemotron-nano-12b-v2-vl` | 128,000 | 未知 | 128,000 | [资料](https://models.dev/api.json) |
| `nvidia/nemotron-voicechat` | 128,000 | 未知 | 8,192 | [资料](https://models.dev/api.json) |
| `nvidia/nv-embed-v1` | 32,768 | 未知 | 2,048 | [资料](https://models.dev/api.json) |
| `nvidia/nv-embedcode-7b-v1` | 32,768 | 未知 | 2,048 | [资料](https://models.dev/api.json) |
| `nvidia/nvidia-nemotron-nano-9b-v2` | 131,072 | 未知 | 131,072 | [资料](https://models.dev/api.json) |
| `nvidia/rerank-qa-mistral-4b` | 128,000 | 未知 | 4,096 | [资料](https://models.dev/api.json) |
| `nvidia/riva-translate-4b-instruct-v1.1` | 128,000 | 未知 | 4,096 | [资料](https://models.dev/api.json) |
| `nvidia/sparsedrive` | 128,000 | 未知 | 8,192 | [资料](https://models.dev/api.json) |
| `nvidia/streampetr` | 128,000 | 未知 | 8,192 | [资料](https://models.dev/api.json) |
| `nvidia/studiovoice` | 128,000 | 未知 | 8,192 | [资料](https://models.dev/api.json) |
| `nvidia/synthetic-video-detector` | 未知 | 未知 | 4,096 | [资料](https://models.dev/api.json) |
| `nvidia/usdcode` | 128,000 | 未知 | 4,096 | [资料](https://models.dev/api.json) |
| `nvidia/usdvalidate` | 未知 | 未知 | 4,096 | [资料](https://models.dev/api.json) |
| `o1` | 200,000 | 未知 | 100,000 | [资料](https://models.dev/api.json) |
| `o1-pro` | 200,000 | 未知 | 100,000 | [资料](https://models.dev/api.json) |
| `o3` | 200,000 | 未知 | 100,000 | [资料](https://models.dev/api.json) |
| `o3-mini` | 200,000 | 未知 | 100,000 | [资料](https://models.dev/api.json) |
| `o3-pro` | 200,000 | 未知 | 100,000 | [资料](https://models.dev/api.json) |
| `o4-mini` | 200,000 | 未知 | 100,000 | [资料](https://models.dev/api.json) |
| `open-mistral-7b` | 8,000 | 未知 | 8,000 | [资料](https://models.dev/api.json) |
| `open-mistral-nemo` | 128,000 | 未知 | 128,000 | [资料](https://models.dev/api.json) |
| `open-mixtral-8x22b` | 64,000 | 未知 | 64,000 | [资料](https://models.dev/api.json) |
| `open-mixtral-8x7b` | 32,000 | 未知 | 32,000 | [资料](https://models.dev/api.json) |
| `pixtral-12b` | 128,000 | 未知 | 128,000 | [资料](https://models.dev/api.json) |
| `pixtral-large-latest` | 128,000 | 未知 | 128,000 | [资料](https://models.dev/api.json) |
| `qvq-max` | 131,072 | 未知 | 8,192 | [资料](https://models.dev/api.json) |
| `qwen-flash` | 1,000,000 | 未知 | 32,768 | [资料](https://models.dev/api.json) |
| `qwen-max` | 32,768 | 未知 | 8,192 | [资料](https://models.dev/api.json) |
| `qwen-mt-plus` | 16,384 | 未知 | 8,192 | [资料](https://models.dev/api.json) |
| `qwen-mt-turbo` | 16,384 | 未知 | 8,192 | [资料](https://models.dev/api.json) |
| `qwen-omni-turbo` | 32,768 | 未知 | 2,048 | [资料](https://models.dev/api.json) |
| `qwen-omni-turbo-realtime` | 32,768 | 未知 | 2,048 | [资料](https://models.dev/api.json) |
| `qwen-plus` | 1,000,000 | 未知 | 32,768 | [资料](https://models.dev/api.json) |
| `qwen-plus-character-ja` | 8,192 | 未知 | 512 | [资料](https://models.dev/api.json) |
| `qwen-turbo` | 1,000,000 | 未知 | 16,384 | [资料](https://models.dev/api.json) |
| `qwen-vl-max` | 131,072 | 未知 | 8,192 | [资料](https://models.dev/api.json) |
| `qwen-vl-ocr` | 34,096 | 未知 | 4,096 | [资料](https://models.dev/api.json) |
| `qwen-vl-plus` | 131,072 | 未知 | 8,192 | [资料](https://models.dev/api.json) |
| `qwen2-5-14b-instruct` | 131,072 | 未知 | 8,192 | [资料](https://models.dev/api.json) |
| `qwen2-5-32b-instruct` | 131,072 | 未知 | 8,192 | [资料](https://models.dev/api.json) |
| `qwen2-5-72b-instruct` | 131,072 | 未知 | 8,192 | [资料](https://models.dev/api.json) |
| `qwen2-5-7b-instruct` | 131,072 | 未知 | 8,192 | [资料](https://models.dev/api.json) |
| `qwen2-5-omni-7b` | 32,768 | 未知 | 2,048 | [资料](https://models.dev/api.json) |
| `qwen2-5-vl-72b-instruct` | 131,072 | 未知 | 8,192 | [资料](https://models.dev/api.json) |
| `qwen2-5-vl-7b-instruct` | 131,072 | 未知 | 8,192 | [资料](https://models.dev/api.json) |
| `qwen3-14b` | 131,072 | 未知 | 8,192 | [资料](https://models.dev/api.json) |
| `qwen3-235b-a22b` | 131,072 | 未知 | 16,384 | [资料](https://models.dev/api.json) |
| `qwen3-32b` | 131,072 | 未知 | 16,384 | [资料](https://models.dev/api.json) |
| `qwen3-8b` | 131,072 | 未知 | 8,192 | [资料](https://models.dev/api.json) |
| `qwen3-asr-flash` | 53,248 | 未知 | 4,096 | [资料](https://models.dev/api.json) |
| `qwen3-coder-30b-a3b-instruct` | 262,144 | 未知 | 65,536 | [资料](https://models.dev/api.json) |
| `qwen3-coder-480b-a35b-instruct` | 262,144 | 未知 | 65,536 | [资料](https://models.dev/api.json) |
| `qwen3-coder-flash` | 1,000,000 | 未知 | 65,536 | [资料](https://models.dev/api.json) |
| `qwen3-coder-plus` | 1,048,576 | 未知 | 65,536 | [资料](https://models.dev/api.json) |
| `qwen3-livetranslate-flash-realtime` | 53,248 | 未知 | 4,096 | [资料](https://models.dev/api.json) |
| `qwen3-max` | 262,144 | 未知 | 65,536 | [资料](https://models.dev/api.json) |
| `qwen3-next-80b-a3b-instruct` | 131,072 | 未知 | 32,768 | [资料](https://models.dev/api.json) |
| `qwen3-next-80b-a3b-thinking` | 131,072 | 未知 | 32,768 | [资料](https://models.dev/api.json) |
| `qwen3-omni-flash` | 65,536 | 未知 | 16,384 | [资料](https://models.dev/api.json) |
| `qwen3-omni-flash-realtime` | 65,536 | 未知 | 16,384 | [资料](https://models.dev/api.json) |
| `qwen3-vl-235b-a22b` | 131,072 | 未知 | 32,768 | [资料](https://models.dev/api.json) |
| `qwen3-vl-30b-a3b` | 131,072 | 未知 | 32,768 | [资料](https://models.dev/api.json) |
| `qwen3-vl-plus` | 262,144 | 未知 | 32,768 | [资料](https://models.dev/api.json) |
| `qwen3.5-122b-a10b` | 262,144 | 未知 | 65,536 | [资料](https://models.dev/api.json) |
| `qwen3.5-27b` | 262,144 | 未知 | 65,536 | [资料](https://models.dev/api.json) |
| `qwen3.5-35b-a3b` | 262,144 | 未知 | 65,536 | [资料](https://models.dev/api.json) |
| `qwen3.5-397b-a17b` | 262,144 | 未知 | 65,536 | [资料](https://models.dev/api.json) |
| `qwen3.5-flash` | 1,000,000 | 未知 | 65,536 | [资料](https://models.dev/api.json) |
| `qwen3.5-plus` | 1,000,000 | 未知 | 65,536 | [资料](https://models.dev/api.json) |
| `qwen3.6-27b` | 262,144 | 未知 | 65,536 | [资料](https://models.dev/api.json) |
| `qwen3.6-35b-a3b` | 262,144 | 未知 | 65,536 | [资料](https://models.dev/api.json) |
| `qwen3.6-flash` | 1,000,000 | 未知 | 65,536 | [资料](https://models.dev/api.json) |
| `qwen3.6-max-preview` | 262,144 | 未知 | 65,536 | [资料](https://models.dev/api.json) |
| `qwen3.6-plus` | 1,000,000 | 未知 | 65,536 | [资料](https://models.dev/api.json) |
| `qwen3.7-flash` | 1,000,000 | 991,808 | 131,072 | [资料](https://models.dev/api.json) |
| `qwen3.7-max` | 1,000,000 | 未知 | 131,072 | [资料](https://models.dev/api.json) |
| `qwen3.7-plus` | 1,000,000 | 未知 | 131,072 | [资料](https://models.dev/api.json) |
| `qwen3.8-flash` | 1,000,000 | 未知 | 131,072 | [资料](https://models.dev/api.json) |
| `qwen3.8-max` | 1,000,000 | 未知 | 131,072 | [资料](https://models.dev/api.json) |
| `qwen3.8-omni-flash` | 1,000,000 | 未知 | 131,072 | [资料](https://models.dev/api.json) |
| `qwq-plus` | 131,072 | 未知 | 8,192 | [资料](https://models.dev/api.json) |
| `sonar` | 128,000 | 未知 | 4,096 | [资料](https://models.dev/api.json) |
| `sonar-deep-research` | 128,000 | 未知 | 32,768 | [资料](https://models.dev/api.json) |
| `sonar-pro` | 200,000 | 未知 | 8,192 | [资料](https://models.dev/api.json) |
| `sonar-reasoning-pro` | 128,000 | 未知 | 4,096 | [资料](https://models.dev/api.json) |
| `step-1-32k` | 32,768 | 32,768 | 32,768 | [资料](https://models.dev/api.json) |
| `step-2-16k` | 16,384 | 16,384 | 8,192 | [资料](https://models.dev/api.json) |
| `step-3.5-flash` | 256,000 | 256,000 | 256,000 | [资料](https://models.dev/api.json) |
| `step-3.5-flash-2603` | 256,000 | 256,000 | 256,000 | [资料](https://models.dev/api.json) |
| `step-3.7-flash` | 256,000 | 256,000 | 256,000 | [资料](https://models.dev/api.json) |
| `step-5-preview` | 1,000,000 | 1,000,000 | 65,536 | [资料](https://models.dev/api.json) |
| `step-tts-2` | 未知 | 未知 | 未知 | [资料](https://models.dev/api.json) |
| `stepaudio-2.5-asr` | 未知 | 未知 | 未知 | [资料](https://models.dev/api.json) |
| `stepaudio-2.5-tts` | 未知 | 未知 | 未知 | [资料](https://models.dev/api.json) |
| `text-embedding-3-large` | 8,191 | 未知 | 3,072 | [资料](https://models.dev/api.json) |
| `text-embedding-3-small` | 8,191 | 未知 | 1,536 | [资料](https://models.dev/api.json) |
| `text-embedding-ada-002` | 8,192 | 未知 | 1,536 | [资料](https://models.dev/api.json) |
| `tiny-aya-earth` | 8,000 | 未知 | 8,000 | [资料](https://models.dev/api.json) |
| `tiny-aya-fire` | 8,000 | 未知 | 8,000 | [资料](https://models.dev/api.json) |
| `tiny-aya-global` | 8,000 | 未知 | 8,000 | [资料](https://models.dev/api.json) |
| `tiny-aya-water` | 8,000 | 未知 | 8,000 | [资料](https://models.dev/api.json) |
| `us.amazon.nova-2-lite-v1:0` | 1,000,000 | 未知 | 65,535 | [资料](https://models.dev/api.json) |
| `us.amazon.nova-lite-v1:0` | 300,000 | 未知 | 10,000 | [资料](https://models.dev/api.json) |
| `us.amazon.nova-micro-v1:0` | 128,000 | 未知 | 10,000 | [资料](https://models.dev/api.json) |
| `us.amazon.nova-premier-v1:0` | 1,000,000 | 未知 | 10,000 | [资料](https://models.dev/api.json) |
| `us.amazon.nova-pro-v1:0` | 300,000 | 未知 | 10,000 | [资料](https://models.dev/api.json) |
| `veo-3.1-fast-generate-preview` | 未知 | 未知 | 8,192 | [资料](https://models.dev/api.json) |
| `veo-3.1-generate-preview` | 未知 | 未知 | 8,192 | [资料](https://models.dev/api.json) |
| `veo-3.1-lite-generate-preview` | 未知 | 未知 | 8,192 | [资料](https://models.dev/api.json) |
| `voxtral-mini-latest` | 未知 | 未知 | 未知 | [资料](https://models.dev/api.json) |
| `voxtral-mini-tts-latest` | 未知 | 未知 | 未知 | [资料](https://models.dev/api.json) |
| `voxtral-small-2507` | 32,768 | 未知 | 32,000 | [资料](https://models.dev/api.json) |
| `voxtral-small-latest` | 32,768 | 未知 | 32,000 | [资料](https://models.dev/api.json) |
| `zai-glm-5-2` | 1,048,576 | 未知 | 131,072 | [资料](https://models.dev/api.json) |
| `zai-glm-5-3` | 1,048,576 | 未知 | 131,072 | [资料](https://models.dev/api.json) |
