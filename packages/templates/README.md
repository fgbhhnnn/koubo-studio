# @koubo/templates

Koubo Studio 的一等口播模板，给导入口播和编辑器共用。

当前模板：

- `classic-performance` — 改编自 adu-motion-video 的已发布镜头包（MIT）。单位原来的 `renderAt(t)` 被包成 `window.film.frame(t)`。官方角标默认关闭。`preview.svg` 是选模板时展示的静态效果图（字幕条与插图槽布局）。
- `illustration.html` — 插图槽页面。

口播管线（`packages/koubo`）用 `buildProject` 把这些模板写进工程的时间线和 `scenes/`。以后加新风格时，在这个包里加目录、登记 `catalog.json`，管线和编辑器就会看到，不必再在 ingest 结尾临时拼一份 HTML。

这些模板的格式和 `packages/editor/library/templates` 里的 OpenFilm 片头片尾 starter（`saved.json` + 海报）不同，不要混用同一套画廊格式。
