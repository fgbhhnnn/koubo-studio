# Koubo Studio 桌面安装包与 CI

仓库已公开：<https://github.com/fgbhhnnn/koubo-studio>。

产品名是 **Koubo Studio**，不是 OpenFilm 官方发行。安装包由本仓库的 GitHub Actions 工作流 [`.github/workflows/desktop.yml`](../.github/workflows/desktop.yml) 构建。

## 触发方式

- 推送到 `main`
- 推送符合 `v*` 的版本标签（标签名去掉 `v` 后必须与 `apps/desktop/package.json` 的 `version` 一致，例如 `v0.4.1`）
- 在 Actions 里手动运行工作流 `desktop`（`workflow_dispatch`）。勾选 “publish_release” 会把安装包挂到名为 `unsigned-dev` 的预发布（Pre-release），不会标成 Latest。

`v*` 标签还会自动创建或更新对应的 [GitHub Release](https://github.com/fgbhhnnn/koubo-studio/releases)。每次构建都会把安装包上传为 workflow artifacts，保留 14 天。

## 打出哪些包

当前在 GitHub-hosted `macos-15` runner 上打（Windows 安装包也在 macOS 上交叉编译，这是桌面打包脚本的既有做法）：

| 产物 | 典型文件名 |
| --- | --- |
| macOS Apple 芯片 | `Koubo-Studio-arm64.dmg`，以及给更新器用的 `.zip` |
| macOS Intel | `Koubo-Studio-x64.dmg`，以及 `.zip` |
| Windows x64 | `Koubo-Studio-Setup-x64.exe`（NSIS，按用户安装，不必管理员） |

Linux 安装包不是必须产物，本工作流不打 Linux 包。

打包命令与本地相同：在 `apps/desktop` 下执行 `npm run release -- --unsigned --arch=arm64`（或 `--arch=x64`，或 `--platform=win --arch=x64`）。不要加 `--official`：仓库里的 `product.official.json` 已清空更新源，避免指向 `openfilm.dev`。

## 签名与公证

目前**没有** Apple / Windows 代码签名证书，因此 CI 打出的是**未签名、未公证**的安装包。缺少签名 secrets 不会让工作流失败。不要把这些包说成已经公证或已签名。

以后如果要加签名，把证书放到仓库 secrets（推荐名：`KOUBO_SIGN_IDENTITY`、`APPLE_TEAM_ID`、以及证书 / 公证相关密钥），再改工作流；不要使用 OpenFilm 官方签名证书。

### 未签名包怎么打开

- **macOS**：首次打开可能提示无法验证开发者。请到「系统设置 → 隐私与安全性」允许打开，或按住 Control 点击图标选择「打开」。
- **Windows**：SmartScreen 可能提示未经签名。请选择「更多信息」→「仍要运行」。

## 本地自己打包

需要 Node.js 22.18+、pnpm 9、本机 `python3`+pip（交叉安装 Windows 轮子时用），以及本机网络（打包时会下载 Electron、ffmpeg、无头 Chromium，以及一份便携 CPython 和阿杜运行时轮子）：

```bash
pnpm install
pnpm --filter @koubo/desktop release -- --unsigned
# Intel Mac 安装包：
pnpm --filter @koubo/desktop release -- --unsigned --arch=x64
# Windows 安装包（也可在 macOS 上打）：
pnpm --filter @koubo/desktop release -- --unsigned --platform=win --arch=x64
```

产物在 `apps/desktop/.release/<arch>/out/`（该目录已被 git 忽略）。

安装包里还会带上便携 Python（`resources/runtime/python`）和阿杜流水线依赖，用户不必自己装 Python。体积会明显增大（numpy / scipy / opencv-python-headless 比较重）：轮子加解释器解压后大约再占 400 MB，安装包本身大概会再大 120–180 MB。macOS 上这套 Python 依赖需要 macOS 12 或更高。详见 [`python-runtime.md`](python-runtime.md)。

## 限制

- GitHub-hosted macOS runner 构建较慢，一次三个目标（arm64 / x64 / win-x64）可能要几十分钟，并占用 Actions 分钟数。
- 未签名的应用不会自动更新：`product.json` 与 `product.official.json` 的更新源都为空，应用不会去 openfilm.dev 检查更新。
- 工作流不会把 API 密钥、`.env` 或用户视频打进安装包或仓库。
