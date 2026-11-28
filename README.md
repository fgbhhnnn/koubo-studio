# Koubo Studio

口播自动去废话、套动画字幕和插图槽，并在同一个编辑器里精修、导出 MP4。

仓库已公开：<https://github.com/fgbhhnnn/koubo-studio>。

这是一个**完整的新项目**：导入口播、去废话、套模板、在 Studio 里精修、出片，都在本仓库完成。用户命令只有 `koubo`。编辑器、口播管线、模板和桌面端是同一套模块，不是在外部引擎外包一层胶水。

代码来自 [OpenFilm](https://github.com/openfilm/openfilm)（MIT）的编辑器 / 渲染 / 桌面端，以及 [adu-motion-video](https://github.com/adunext/adu-motion-video)（MIT）已发布镜头包的改编模板。产品名是 **Koubo Studio**，不是 OpenFilm，也不是阿杜导演；不要把本项目当成官方发行。商标与上游版本见 [`TRADEMARK.md`](TRADEMARK.md)、[`NOTICE.md`](NOTICE.md) 与 [`UPSTREAM.md`](UPSTREAM.md)。模块怎么分工见 [`docs/architecture.md`](docs/architecture.md)。

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

## 下载桌面安装包

Windows 和 macOS 安装包由 GitHub Actions 自动打包，工作流是 [`.github/workflows/desktop.yml`](.github/workflows/desktop.yml)：

- 推送到 `main`，或在 Actions 里手动运行 `desktop` 工作流，会打出安装包并上传为 [workflow artifacts](https://github.com/fgbhhnnn/koubo-studio/actions/workflows/desktop.yml)（保留 14 天）。
- 打上 `v*` 版本标签（须与 `apps/desktop/package.json` 的 version 一致，例如 `v0.4.1`）还会挂到 [GitHub Release](https://github.com/fgbhhnnn/koubo-studio/releases)。

产物名是 **Koubo Studio**（例如 `Koubo-Studio-arm64.dmg`、`Koubo-Studio-x64.dmg`、`Koubo-Studio-Setup-x64.exe`）。Linux 包不是必须产物，当前工作流不打。

当前没有 Apple / Windows 代码签名证书，因此这些是**未签名、未公证**的构建，缺少签名密钥时 CI 仍会成功出包：

- **macOS**：首次打开可能提示无法验证开发者。请到「系统设置 → 隐私与安全性」允许打开，或按住 Control 点击图标选择「打开」。
- **Windows**：SmartScreen 可能提示未经签名。请选择「更多信息」→「仍要运行」。

更完整的说明（本地自己打包、限制）见 [`docs/desktop-ci.md`](docs/desktop-ci.md)。

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
pnpm --filter @koubo/templates test
pnpm test
```

`pnpm test:koubo` 覆盖：自然停顿合并、去废话 / 重复、保留区间裁切、`film.html` 关键结构，以及 `koubo` 命令用法。ffmpeg 相关用例会现场生成短素材，不依赖你的口播原片。`pnpm test` 还会跑编辑器和桌面端里能独立跑的测试。不要用真实密钥打网关。

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
packages/koubo/        用户命令 koubo：导入口播、方案、裁轨，以及 open / look / render
packages/editor/       Studio、时间线、film 格式、渲染引擎（包名 @koubo/editor）
packages/templates/    一等口播模板（@koubo/templates）：字幕、插图槽、classic-performance
packages/shared/       桌面端聊天与主进程的共用类型（@koubo/shared）
apps/desktop/          桌面壳：Studio + 右侧对话（@koubo/desktop）
skills/koubo-talking/  给对话助手看的口播说明（与编辑器核心技能 talking 同步）
```

开发时按上表找模块即可，不必先对接两套上游仓库。出片走 `koubo render`（内部调用 `@koubo/editor/cli`）。新的口播风格加在 `packages/templates` 并登记 `catalog.json`。更细的说明见 [`docs/architecture.md`](docs/architecture.md)。

## 许可

MIT。第三方声明见 `NOTICE.md` 与 `UPSTREAM.md`。
