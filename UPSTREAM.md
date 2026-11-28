# 上游与版本

Koubo Studio 是一个独立产品：编辑器、口播管线、模板和桌面端都在本仓库里，作为同一套模块开发。产品名是 **Koubo Studio**，不是 OpenFilm，也不是阿杜导演。

代码来源与许可（MIT）如下。格式兼容与商标边界见下文和 `NOTICE.md`、`TRADEMARK.md`。

## OpenFilm（MIT）

- 仓库：https://github.com/openfilm/openfilm
- 找齐版本：`0.4.1`，commit `c386aeb789f32e065f988eeb47fb7615cee07619`（`c386aeb`，说明为 Desktop conversation undo fix #542）
- 本仓库保留 OpenFilm 的 `LICENSE` 与 `TRADEMARK.md`。按商标说明：可以写「基于 OpenFilm 格式」，但不能把本产品叫做 OpenFilm，也不能使用官方 logo 冒充官方发行。本仓库不改名重发官方安装包，也不向 npm 发布名为 `openfilm` 的包。

源码已收进本仓库的模块，不再以「外部 OpenFilm 引擎 + 包装脚本」的方式对接：

- 编辑器、Studio、look / render：`packages/editor`（包名 `@koubo/editor`）
- 桌面壳：`apps/desktop`（包名 `@koubo/desktop`）
- 聊天共用类型：`packages/shared`（包名 `@koubo/shared`）

对外可见的产品名、窗口标题、默认数据目录（`~/.koubo`、`Videos/Koubo/Projects`）和用户命令是 `koubo`。

工程文件仍使用 OpenFilm 格式（`film.html`、`.film/`、`window.film.frame(t)`）。插件 import map、技能 uid、部分引擎环境变量（`OPENFILM_*`）暂时保留，说明见 `packages/editor/COMPAT.md` 与 `docs/architecture.md`。用户路径同时认 `KOUBO_*` 与 `OPENFILM_*`。

## adu-motion-video（MIT）

- 仓库：https://github.com/adunext/adu-motion-video
- 找齐版本：commit `4ae737a04107083288c02eab5c0861834fcc0364`（`4ae737a`，3.14.2-rc.1）
- 改编使用的已发布包：`packs/classic-performance@1.0.0`（MIT），位于 `packages/templates/classic-performance`，由 `@koubo/templates` 作为一等模板导出
- 默认关闭官方角标 / AduNext 水印。口播与 BGM 走时间线音轨，不在镜头页里播放。
- **不**把 MotionGit 上下载的官方 `.motion` 包打进本仓库再分发。那些包带个人账号信封，仓库 MIT 不等于可以再分发或做 SaaS。

桌面安装包另带一份便携 CPython 和 `requirements-runtime.txt` 里的运行时依赖，供日后接入阿杜 Python 流水线；冒烟入口是 `resources/runtime/adu/pipeline.py doctor`（Koubo 自己的导入检查，不是上游完整 doctor）。不把 MotionGit 上下载的官方 `.motion` 包打进安装包。说明见 `docs/python-runtime.md`。

`adudir-open` 仅作 `.motion` 格式参考，本产品不依赖它的生成器（上游也未开源生成器）。
