# Juku App

面向 Android/iOS 的移动端客户端，以 Web 技术重构原 Flutter App 的交互界面。项目使用 Vue 3、TypeScript、Vite 和 Capacitor 构建；业务数据继续通过现有 Juku 后端 Web 所使用的接口读取和写入。

本仓库从最初的独立 App 方案开始，先完成 HTML UI 审查，再按审核结果实现正式页面、连接后端、完善缓存与同步，最后加入 Android 原生 Media3 播放能力并准备开源发布。早期审查用静态 HTML 原型已从项目移除。

## 项目起源与演进

1. 现有产品由 Flutter App 和后端 Web 管理界面组成。目标不是重写后端，而是为手机端提供一套重新设计的 UI，同时复用后端 Web 的账号、Cookie 和 `/api/ui/*` 数据接口。
2. UI 阶段先输出静态 HTML 供审查，确定首页、剧库、详情、播放、追剧、下载和“我的”等模块后，才开始实现 App 页面。
3. 页面实现后，持续依据实测修复站源/分类筛选、搜索、榜单封面、追剧与观看记录同步、下载任务和账号管理等问题。
4. 为减轻服务器和播放网络负担，客户端增加按服务器隔离的剧库/榜单/分类缓存、后台请求调度，并优先让手机解码后端提供的原始 MP4/HLS 播放地址。
5. Android 使用 Capacitor 承载 Vue 页面；对直链播放增加 AndroidX Media3 原生播放插件。仍需代理或兼容路径的媒体继续使用现有播放器实现。
6. 首发版本为 `0.0.1`。版本信息维护在 `package.json` 与 `version.json`；正式版本 tag 使用 `v` 前缀。

更完整的页面设计决策与客户端架构边界见 [`docs/ui-audit.md`](docs/ui-audit.md)、[`docs/native-playback-migration.md`](docs/native-playback-migration.md) 和 [`docs/release-and-simulator.md`](docs/release-and-simulator.md)。

## 功能范围

- 五个主 Tab：首页、剧库、追剧、下载、我的。
- 详情、榜单、观看历史、账号安全、用户管理、站源状态等页面。
- 黑色/白色主题、服务器地址切换、账号 Cookie 管理。
- 剧库、榜单和分类的本地缓存与后台更新；追剧清单与播放历史通过后端账号进行同步。
- Android 原生直链 MP4/HLS 播放；播放设置与媒体元数据仍由客户端 UI 管理。
- GitHub Actions Web 校验与 Android APK 构建、产物归档和 Release 发布。

## 边界与前置条件

### 本项目负责

- App 前端界面、客户端状态、请求调度、本地目录缓存和 Android/iOS 容器。
- 调用现有后端接口、维护登录 Cookie，并显示服务端返回的剧集、榜单、状态和任务。
- 对后端提供的播放地址进行客户端播放；在 Android 上通过 Media3 对直链媒体进行解码。

### 本项目不负责

- 不包含、不修改、不部署 Juku Go 后端，也不拥有站源采集、剧集解析、账号权限判定、任务执行或媒体转码逻辑。
- 不保证任意后端版本、反向代理或第三方站源均兼容；需要后端提供匹配的 `/api/ui/*` 接口及可访问的媒体 URL。
- 不绕过登录、站源权限、付费限制或内容访问策略。
- Media3 只处理后端提供且 Android 支持的媒体地址、容器和编码；不负责解析供应商网页。需要后端代理/HLS 会话的播放模式仍受后端可用性、反代配置和网络状况影响。
- App 与 Web 共享后端记录的前提是登录同一后端账号。访客 viewer 身份受浏览器/设备 Cookie 限制，不等价于跨设备账号同步。
- 仓库不包含个人开发机配置、真实后端地址、账号数据、Cookie、私钥、签名材料或本机打包产物。部署地址由 App 设置页或开发者本机 `.env.local` 提供。

## 技术栈

- Vue 3、TypeScript、Vite
- Capacitor 7
- AndroidX Media3 ExoPlayer（Android 原生直链播放）
- pnpm、Gradle、GitHub Actions

## 本地开发

需要 Node.js、pnpm，以及一个可访问的兼容后端。

```bash
pnpm install
pnpm dev
```

浏览器默认打开 `http://localhost:5173`，Vite 将 `/api` 代理到本机 `http://localhost:8998`。需要其他地址时在未提交的 `.env.local` 设置 `JUKU_DEV_LOCAL_API_BASE_URL`。连接远程开发后端时，同时设置 `JUKU_DEV_REMOTE_API_BASE_URL`、`VITE_API_BASE_URL` 和 `VITE_PRODUCTION_API_BASE_URL`。字段示例见 [`.env.example`](.env.example)。

手机安装包可在“我的 / 服务器与播放”中设置后端地址。真实地址只存在于设备配置或部署方环境中，不要写入源代码、示例文件或公开问题报告。

## 本地检查

```bash
pnpm run audit:repo
pnpm run typecheck
pnpm run build
node scripts/check-catalog-pagination.mjs
```

`node scripts/check-following-sync.mjs` 会对配置的后端发出读写请求，应只在测试账号/测试环境执行。完整发布与模拟器验收步骤见 [`docs/release-and-simulator.md`](docs/release-and-simulator.md)。

## Android APK

GitHub Actions 工作流 [`Android APK`](.github/workflows/android-apk.yml) 有两种入口：

- 在 GitHub 仓库的 Actions 页面手动运行：生成 Debug APK 并保留为可下载的 Workflow Artifact。
- 推送 `v*` tag：工作流校验 tag 与 `version.json`/`package.json` 一致，构建 Release APK 并创建 GitHub Release 附件。

例如新版本准备完成后，先同步更新 `package.json`、`version.json` 和 `CHANGELOG.md`，本地检查通过后再标记并推送：

```bash
git tag v0.0.2
git push origin v0.0.2
```

Debug APK 适合测试，不是 Play Store 发布包。Release APK 目前为未签名构建；上架或提供可验证的正式升级包前，项目维护者必须在 GitHub Actions Secrets 配置 Android 发布签名材料，并完善签名步骤。不要将 keystore 或密码提交到仓库。

## 版本

当前版本：`0.0.1`，版本号从首发开始递增。所有构建产物使用版本号命名，Android `versionCode` 也需随每次发布递增。
