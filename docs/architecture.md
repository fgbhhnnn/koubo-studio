# Koubo Studio 怎么组织

这是**一个**产品仓库。以后改功能时，按模块找，不必先弄清 OpenFilm 和阿杜两套仓库如何对接。

## 模块

| 位置 | 包名 | 改什么时来这里 |
| --- | --- | --- |
| `packages/koubo` | `koubo` | 用户命令 `koubo`：导入口播（ingest / transcribe / plan / cut / project），以及把 open / look / render / Studio 接到编辑器模块 |
| `packages/editor` | `@koubo/editor` | Studio 界面、时间线、film.html 格式、look / render 引擎、插件与技能 |
| `packages/templates` | `@koubo/templates` | 口播一等模板（字幕页、插图槽、classic-performance 单位）。新风格加目录并登记 `catalog.json` |
| `packages/shared` | `@koubo/shared` | 桌面端聊天和主进程共用的类型与解析 |
| `apps/desktop` | `@koubo/desktop` | Electron 壳、右侧对话、安装包（含 ffmpeg、无头浏览器，以及便携 Python：`runtime/python`） |

对外只暴露 `koubo`（`pnpm koubo …`）。不要再让开发者先想一条 `openfilm` 命令。

## 一条口播出片怎么走

1. `koubo ingest` 在 `packages/koubo` 里转写、出方案、裁轨。
2. `buildProject` 从 `@koubo/templates` 套字幕和插图，写成标准工程（`film.html` + `scenes/` + `overrides`）。
3. `koubo open` / 桌面端打开同一套工程；右侧对话改的是这份时间线和 overrides。
4. `koubo look` / `koubo render` 调用 `@koubo/editor/cli`（同一进程里的模块，不是外部引擎包装脚本）。

## 格式兼容（暂时保留、集中说明）

工程文件仍使用 OpenFilm 格式（`film.html`、`.film/`、`window.film.frame(t)`）。插件页的 import map 仍是 `openfilm/workbench/*`、`openfilm/studio`；官方技能 uid 仍是 `openfilm/film` 这类名字。引擎内部不少环境变量仍叫 `OPENFILM_*`（用户路径同时认 `KOUBO_*` 和 `OPENFILM_*`，默认目录是 `~/.koubo` 与 `Videos/Koubo/Projects`）。

桌面端 PATH 上会再写一个同目标的 `openfilm` 垫片，只为还没改完的格式技能。技能都改成 `koubo` 之后即可删除，见 `apps/desktop/src/openfilm-command.mjs` 里的 COMPAT 注释。

这些不是对外包名，也不表示产品叫 OpenFilm。归属见 `UPSTREAM.md` 与 `NOTICE.md`。

## 桌面包里的便携 Python

安装包会带一份 python-build-standalone 的 CPython 3.12，以及阿杜流水线的运行时轮子（numpy、Pillow、SciPy、opencv-python-headless、fonttools），放在 `resources/runtime/python`。应用通过 `KOUBO_PYTHON` 和 `KOUBO_ADU_PIPELINE` 找到解释器与 `pipeline.py doctor` 冒烟检查。从源码跑时可以没有 Python，编辑器不得因此启动失败。当前口播剪辑路径仍是 `packages/koubo` 里的 JavaScript。不把 MotionGit 官方 `.motion` 包打进安装包。细节见 [`python-runtime.md`](python-runtime.md)。
