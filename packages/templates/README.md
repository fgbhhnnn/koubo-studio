# @koubo/templates

Koubo Studio 的一等口播模板，给导入口播和编辑器共用。

当前模板：

- `classic-performance` — 改编自 adu-motion-video 的已发布镜头包（MIT）。一键出片时会按转写节拍把「主张 / 拆解 / 证据」单位排到时间线上，文案写入镜头槽位，源编舞时钟 1x 播放，并包成 `window.film.frame(t)`。官方角标默认关闭。`preview.svg` 是选模板时展示的静态效果图（字幕条与插图槽布局）。未附带官方 MotionGit `.motion` 包。口播出片时会写入面部窗裁切（有便携 Python 时做追踪，否则宽构图回退），证据单位使用专用证据板，槽位文案按完整子句换行。
- `illustration.html` — 插图槽页面。

口播管线（`packages/koubo`）用 `buildProject` 把这些模板写进工程的时间线和 `scenes/`。以后加新风格时，在这个包里加目录、登记 `catalog.json`，管线和编辑器就会看到，不必再在 ingest 结尾临时拼一份 HTML。

这些模板的格式和 `packages/editor/library/templates` 里的 OpenFilm 片头片尾 starter（`saved.json` + 海报）不同，不要混用同一套画廊格式。
