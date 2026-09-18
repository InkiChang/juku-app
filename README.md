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

浏览器访问 `http://localhost:5173`。开发时默认连接 `http://127.0.0.1:8998`；手机访问时请在应用设置中改为本机局域网 IP，例如 `http://192.168.3.172:8998`。

## 架构约束

- 后端只复用现有接口，不在本项目修改 Go 服务。
- Web 与 App 使用相同 API Client 和账号身份机制。
- 登录同一账号后，观看记录和追剧清单由后端统一同步。
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

## UI 审查原型

启动 `pnpm dev` 后打开 `http://localhost:5173/design-review.html`。原型覆盖首页、剧库、详情、播放器、追剧、下载、我的、服务器设置和账号弹层；设计依据记录在 `docs/ui-audit.md`。确认视觉方向后，再将原型拆分为正式 Vue 页面并接入现有 API。
