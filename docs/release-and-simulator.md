# 发布、后端切换与模拟器测试

## 1. 项目边界

- 本仓库只包含 App 前端，不修改后端 Go 服务。
- Web 与 App 共用现有 `/api/ui/*` 接口、Cookie 和 viewer 身份。
- 播放优先使用后端返回的原始 MP4/HLS 地址，由手机或浏览器完成解码；后端已有的代理/转码路径只作为兜底。
- 当前首发版本是 `0.0.1`，版本信息同时维护在 `package.json` 和 `version.json`。

## 2. 本地开发

项目运行时需要 Node.js、pnpm 和现有后端服务。

```bash
pnpm install
pnpm dev
```

本地浏览器默认通过 Vite 代理访问 `http://localhost:8998`。如需使用其他本机地址，可通过 `JUKU_DEV_LOCAL_API_BASE_URL` 覆盖。正式后端通过开发代理访问（地址只放在本机 `.env.local`，不要提交）：

```bash
JUKU_DEV_REMOTE_API_BASE_URL=https://your-backend.example VITE_API_BASE_URL=https://your-backend.example VITE_PRODUCTION_API_BASE_URL=https://your-backend.example pnpm dev
```

也可以在 App 的服务器设置页面输入其他后端地址。地址保存在本机，切换服务器时会隔离对应的 viewer、Cookie、剧库缓存和追剧缓存。

## 3. 发布前检查

```bash
pnpm run typecheck
pnpm run build
node scripts/check-catalog-pagination.mjs
node scripts/check-following-sync.mjs
git diff --check
```

其中追剧同步脚本需要可访问的后端。若本机 `8998` 或正式域名不可访问，脚本只能证明前端模块加载失败，不能作为真实双向同步通过的依据。

## 4. 版本与 GitHub 仓库

修改版本时必须同步更新：

- `package.json` 的 `version`
- `version.json` 的 `version` 和递增的 `code`
- `CHANGELOG.md`

发布首发版本：

```bash
pnpm run typecheck
pnpm run build
git add .
git commit -m "release: v0.0.1"
git tag v0.0.1
git push origin main --tags
```

不要提交 `dist/`、`node_modules/`、`android/local.properties`、iOS Pods 或本机签名文件。

## 5. Capacitor 原生工程

首次准备 Android 或 iOS 工程：

```bash
pnpm run build
pnpm exec cap add android
pnpm exec cap add ios
pnpm exec cap sync
```

原生工程生成后应提交 `android/`、`ios/` 的项目配置，但不要提交本机 SDK 路径、签名和构建缓存。

## 6. Android 模拟器

需要 Android Studio、Android SDK、JDK 和可用的 AVD：

```bash
pnpm run build
pnpm exec cap sync android
pnpm exec cap open android
```

在 Android Studio 中选择模拟器后运行 `app`。重点检查：登录 Cookie、服务器切换、剧库数量、站源筛选、播放指定集、自动下一集、追剧同步和下载任务。

本机已检测到已有 AVD `juku_api36_x86_64`（Android API 36、Pixel 6 配置）。如果 Android SDK 工具已加入 `PATH`，可以直接启动并安装调试包：

```bash
emulator -avd juku_api36_x86_64
adb wait-for-device
adb install android/app/build/outputs/apk/debug/app-debug.apk
```

## 7. iOS 模拟器

需要完整 Xcode（仅有 Command Line Tools 不包含 Simulator）：

```bash
pnpm run build
pnpm exec cap sync ios
pnpm exec cap open ios
```

在 Xcode 中选择 iPhone Simulator 并运行。若执行 `xcrun simctl` 提示找不到 Simulator，先在 Xcode 的设置中安装 iOS Simulator runtime，并将开发者目录切换到完整 Xcode：

```bash
sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
```

## 8. 模拟器验收清单

1. 服务器设置：本地地址、正式域名、错误地址和重新连接。
2. 账号：登录、退出、Cookie 保留、不同用户缓存隔离。
3. 首页：四种推荐卡片、站源榜单切换、封面和详情跳转。
4. 剧库：全部站源数量、红果/黄果/黄豆切换、分类、排序、搜索、加载更多。
5. 播放：指定集、自动播放、自动下一集、倍速、清晰度、画中画、全屏、竖屏视频布局。
6. 观看记录和追剧：Web/App 双向更新、离线重试、五分钟同步任务。
7. 下载：按剧集合并、分集状态、失败重试、暂停、继续和取消。
8. 我的：观看记录独立页面、账号安全、用户管理权限、站源状态和主题切换。

## 9. 当前环境限制

若本机只有 `/Library/Developer/CommandLineTools`，无法启动 iOS Simulator；需要安装完整 Xcode。Android 模拟器则需要 Android Studio、JDK 和 AVD。本地后端不可访问时，只能完成静态构建和前端单元/协议回归，不能宣称真实播放或同步验收通过。
