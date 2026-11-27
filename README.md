# Koubo Studio

口播自动去废话、套动画字幕和插图槽，并在同一个编辑器里精修、导出 MP4。

这是一个**完整的剪辑应用**：能打开工程、看片、改时间线与字幕，用右侧对话继续改，再导出成片。它基于 [OpenFilm](https://github.com/openfilm/openfilm) 的 Studio / 桌面端 / 渲染 / 对话（MIT），并把 [adu-motion-video](https://github.com/adunext/adu-motion-video) 的已发布镜头包（MIT）改编成可填充模板。产品名是 **Koubo Studio**，不是 OpenFilm，也不是阿杜导演；不要把本项目当成官方发行。商标边界见上游的 [`TRADEMARK.md`](TRADEMARK.md) 与本仓库 [`UPSTREAM.md`](UPSTREAM.md)。

## 能做什么

1. 导入口播视频。
2. 用 ElevenLabs Scribe 语音转文字，拿到**词级时间戳**。
3. 按规则整理：词与词之间 0.3～0.5 秒的自然停顿合并保留；剪掉「嗯啊」口头禅、重复句、说错重来、过长死寂。输出带时间码的保留 / 删除区间。有大模型密钥时可走逻辑整理插槽；没有则用规则引擎。逻辑显著较乱时**不会硬剪**，会在方案里标出。
4. 用 ffmpeg 按方案裁出干净口播轨（声画一起切，对口型）。
5. 套自写的口播模板：动画字幕 + 插图槽。配置了生图接口时，会按槽位调用 `/v1/images/generations` 把图写进工程资产和时间线；没有密钥或调用失败时用可替换占位图，不挡住主路径。改编的 classic-performance（01-A）单位把原来的 `renderAt(t)` 包成 `window.film.frame(t)`，官方角标默认关闭。口播和 BGM 只走时间线音轨。
6. 生成可在本项目 Studio / 桌面端打开的工程（`film.html` + 镜头页 + 资产 + 字幕）。
7. 用本项目的渲染导出 MP4（`koubo render` / `koubo look`），不并行维护阿杜旧的 `render_project.mjs` 作出片器。

交给你之后：左边是预览和时间线，右边用自然语言继续改（例如「把这句再剪掉」「标题改成某某」「第 12 秒那张图换一张」）。手改会进入 overrides，智能体再改也不会覆盖。

## 要求

- Node.js 22.18+
- [pnpm](https://pnpm.io) 9（仓库已声明 `packageManager`）
- ffmpeg / ffprobe
- 转写需要 ElevenLabs API 密钥（Scribe / speech-to-text）

## 安装

在仓库根目录：

```bash
pnpm install
```

第一次从源码跑 Studio 时，还会构建编辑器界面。桌面端：

```bash
pnpm dev:desktop
```

只跑 Studio（浏览器里打开本机地址）：

```bash
pnpm dev
# 或
pnpm koubo studio
```

## 导入口播并出第一版

把密钥放在环境变量里，**不要**写进仓库或工程文件：

```bash
export ELEVENLABS_API_KEY=你的密钥
# 或：source /path/to/elevenlabs.env
```

然后：

```bash
pnpm koubo ingest /path/to/your-talking.mp4 --out ./projects/my-talk --title "本期口播"
```

会在输出目录生成：

- `film.html` — 时间线工程
- `assets/talking-clean.mp4` — 按方案裁好的干净口播
- `scenes/captions.html` — 动画字幕页（`window.film.frame(t)`）
- `scenes/illustration.html` + `assets/illustrations/` — 插图槽（默认可替换占位）
- `koubo/transcript.json`、`koubo/plan.json` — 转写与保留 / 删除方案

打开并精修：

```bash
pnpm koubo open ./projects/my-talk
```

抽帧检查或导出（走本项目渲染引擎）：

```bash
pnpm koubo look ./projects/my-talk 0-3
pnpm koubo render ./projects/my-talk
# 只导出前面几秒：
pnpm koubo render ./projects/my-talk 0-4
```

也可以分步跑：`koubo transcribe` → `koubo plan` → `koubo cut` → `koubo project`。没有联网或密钥时，可用夹具转写 JSON 测裁切和工程生成：

```bash
pnpm koubo plan packages/koubo/test/fixtures/transcript.json --out /tmp/plan.json
```

用户口播原片和导出的大媒体不要提交进 git（见 `.gitignore`）。

## 测试

```bash
pnpm test:koubo
```

覆盖：自然停顿合并、去废话 / 重复、保留区间裁切、`film.html` 关键结构。ffmpeg 相关用例会现场生成短素材，不依赖你的口播原片。

## 密钥

| 变量 | 用途 |
| --- | --- |
| `ELEVENLABS_API_KEY` | ElevenLabs 词级转写（必需，主路径） |
| `KOUBO_SCRIBE_MODEL` | 可选，默认 `scribe_v2`（官方批量转写文档） |
| `KOUBO_LLM_API_KEY` 或 `OPENAI_API_KEY` | 可选，规则方案之后的逻辑整理。没有密钥时只走规则引擎 |
| `KOUBO_LLM_BASE_URL` | OpenAI 兼容接口的根路径，例如 `https://sub.lllltt.com/v1`（已含 `/v1`，客户端不会再拼成 `/v1/v1`） |
| `KOUBO_LLM_MODEL` | 逻辑整理模型，默认 `gpt6.2sol`（网关实际 id 为 `gpt-6.2-sol`） |
| `KOUBO_IMAGE_API_KEY` | 可选，插图生图。不设时复用 `KOUBO_LLM_API_KEY` |
| `KOUBO_IMAGE_BASE_URL` | 生图接口根路径，默认与 `KOUBO_LLM_BASE_URL` 相同，请求 `POST {base}/images/generations` |
| `KOUBO_IMAGE_MODEL` | 生图模型，默认 `GPT Image 2.6 Sunburst`（网关实际 id 为 `gpt-image-2.6-sunburst`）。值里有空格时，在 `.env` 里请加引号 |

也可继续使用 `OPENAI_BASE_URL` 作为 base 的备选。参考 `.env.example`。永远不要把密钥提交到 git、写进 README，或打进测试金片。

## 仓库结构

```
packages/openfilm/     编辑器、CLI、渲染（上游 OpenFilm，可见品牌已换成 Koubo Studio）
apps/desktop/          桌面壳：Studio + 右侧对话
packages/koubo/        口播管线、模板、单元测试
skills/koubo-talking/  给对话助手看的口播模板说明
```

出片只使用本项目的 `openfilm render`（经 `koubo render` 调用）。改编模板在 `packages/koubo/templates/classic-performance`。

## 许可

MIT。第三方声明见 `NOTICE.md` 与 `UPSTREAM.md`。
