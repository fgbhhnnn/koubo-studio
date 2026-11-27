# 编辑器模块里暂时保留的格式名

`@koubo/editor` 是 Koubo Studio 的编辑器模块，不是对外发布的 `openfilm` npm 包。

下面这些名字属于 **OpenFilm 格式 / 插件协议**，改掉会让已有工程和插件页跑不起来，所以本轮只集中放在这里说明，而不是继续当产品名传播：

- 插件页 import map：`openfilm/workbench/<name>`、`openfilm/studio`
- 技能 uid：`openfilm/film`、`openfilm/media`、`openfilm/canvas` 等
- 素材库 id：如 `openfilm/stickers/…`
- 引擎环境变量：`OPENFILM_*`（同时接受 `KOUBO_HOME`、`KOUBO_LIBRARY` 等）
- 工程缓存目录：`.film/`（以及历史 `.openfilm/`）

用户命令、workspace 包名和窗口标题一律用 `koubo` / Koubo Studio。若以后要迁移格式标识，应做兼容读写并单独开一轮，不要和日常功能开发缠在一起。
