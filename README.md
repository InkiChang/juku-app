# Juku App

独立的 Web 技术移动端项目：使用 Vue 3 + TypeScript + Vite 构建，并通过 Capacitor 打包 Android/iOS。后端接口复用现有 Juku Go 服务，本仓库不修改后端代码。

## 当前版本

`0.0.1`，版本号同时记录在 `package.json` 和 `version.json`。构建产物必须带版本号，Git tag 使用 `v0.0.1` 格式。

## 本地开发

```bash
cp .env.example .env.local
pnpm install
pnpm dev
```

浏览器访问 `http://localhost:5173`。开发时通过 Vite 代理连接本机后端；如需覆盖本机后端地址，可设置 `JUKU_DEV_LOCAL_API_BASE_URL`。手机访问时请在应用设置中填写运行后端设备的局域网地址，例如 `http://your-lan-host:8998`。

浏览器开发预览正式后端时，会通过 Vite 的同源开发代理请求后端，避免后端的跨站保护拦截。请在启动前设置 `JUKU_DEV_REMOTE_API_BASE_URL`，并同时用 `VITE_API_BASE_URL` 指定相同地址。Capacitor 安装包启用原生 HTTP 与 Cookie，不依赖浏览器 CORS。

## 架构约束

- 后端只复用现有接口，不在本项目修改 Go 服务。
- Web 与 App 使用相同 API Client 和账号身份机制。
- 登录同一账号后，观看记录和追剧清单由后端统一同步。
- 剧库、榜单和分类采用按服务器地址隔离的本地持久缓存：首次打开先显示手机缓存，后台再向后端查新并合并新返回的内容；缓存更新期间不覆盖可用旧数据。
- 网络请求经过统一调度：播放请求优先，账号和当前操作次之，剧库、榜单、分类及封面更新降为后台任务；后台任务限制并发和站点启动间隔，播放期间不与分片请求争抢全部连接。
- 播放连续 20 秒没有实际进度时才会自动恢复，单集最多尝试 3 次；暂停、切集和离开播放器不会触发自动恢复。
- 播放画面上滑切换下一集、下滑切换上一集，竖版和横版均支持；横向滑动、短触摸及右侧长按倍速区域不会触发切集。
- 播放优先原始 MP4/HLS，让手机或浏览器完成硬件解码；服务端转码属于后端已有的兜底路径。
- 服务器地址支持本地地址和正式域名切换，不写死单一生产地址。

## Capacitor

```bash
pnpm build
pnpm exec cap add android
pnpm exec cap sync android
pnpm exec cap open android
```

`android/` 和 `ios/` 目录由 Capacitor 生成后再提交；本仓库不提交本机 `local.properties` 或构建缓存。

## 版本发布

```bash
pnpm build
git tag v0.0.1
git push origin main --tags
```

GitHub Actions 会在后续阶段补充 Web 构建和 Android 产物发布流程。

## 正式页面

正式 App 入口为 `http://localhost:5173/`，已按审核通过的 UI 拆分为首页、剧库、追剧、下载和我的五个底部 Tab，并复用 `/api/ui/*` 接口。播放器优先请求原始 MP4/HLS，无法识别 viewer Cookie 或播放地址时会在界面中显示可恢复的错误状态。

目录缓存默认保留 15 分钟的新鲜期，最多保存 12000 条剧集；过期后先使用旧数据，再在后台刷新第一页并合并新增或更新条目。榜单内容和榜单结构、分类列表也会按服务器地址保存在手机端。播放期间会暂停目录的后台补齐，避免剧库、榜单和封面请求与视频分片争抢网络；切换服务器后缓存自动隔离。

项目早期的静态 UI 原型已从仓库移除，正式页面和接口行为以 `src/`、`docs/` 及回归脚本为准。

## 发布与模拟器

首发版本为 `0.0.1`。提交前可运行 `pnpm run audit:repo` 检查私有 IP、个人路径、明文凭据和私钥材料。完整的开发、后端切换、检查、版本发布和 Capacitor 模拟器流程见 [`docs/release-and-simulator.md`](docs/release-and-simulator.md)。
