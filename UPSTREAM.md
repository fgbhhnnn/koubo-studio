# 上游与版本

Koubo Studio 以 OpenFilm 为编辑器与渲染底座，并把 adu-motion-video 的已发布镜头包改编成可填充模板。产品名是 **Koubo Studio**，不是 OpenFilm，也不是阿杜导演。

## OpenFilm（MIT）

- 仓库：https://github.com/openfilm/openfilm
- 找齐版本：`0.4.1`，commit `c386aeb789f32e065f988eeb47fb7615cee07619`（`c386aeb`，说明为 Desktop conversation undo fix #542）
- 本地对照克隆（未改）：`/workspace/repos/openfilm`（仅开发机；本仓库不依赖该路径）
- 本仓库保留 OpenFilm 的 `LICENSE` 与 `TRADEMARK.md`。按商标说明：可以写「基于 OpenFilm 格式」，但不能把本产品叫做 OpenFilm，也不能使用官方 logo 冒充官方发行。本仓库不改名重发官方安装包。

内部 workspace 包名仍为 `openfilm` 与 `@openfilm/desktop`，以避免打断上游源码结构；对外可见的产品名、窗口标题、默认数据目录（`~/.koubo`、`Videos/Koubo/Projects`）和 CLI 入口是 `koubo`。

## adu-motion-video（MIT）

- 仓库：https://github.com/adunext/adu-motion-video
- 找齐版本：commit `4ae737a04107083288c02eab5c0861834fcc0364`（`4ae737a`，3.14.2-rc.1）
- 改编使用的已发布包：`packs/classic-performance@1.0.0`（MIT），位于 `packages/koubo/templates/classic-performance`
- 默认关闭官方角标 / AduNext 水印。口播与 BGM 走时间线音轨，不在镜头页里播放。
- **不**把 MotionGit 上下载的官方 `.motion` 包打进本仓库再分发。那些包带个人账号信封，仓库 MIT 不等于可以再分发或做 SaaS。

`adudir-open` 仅作 `.motion` 格式参考，本 MVP 不依赖它的生成器（上游也未开源生成器）。
