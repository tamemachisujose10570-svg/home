# 家庭远程监控（闲置 iPhone 变联网摄像头）

纯网页方案：把闲置的 iPhone 7 Plus 当作监控摄像头，任何联网设备打开网页输入设备码即可实时查看（视频 + 音频 + 移动侦测截图）。

## 原理

- 相机端（iPhone）和观看端都运行在浏览器里，通过 WebRTC 点对点传输音视频，数据加密、不经服务器。
- 信令（找设备）使用 PeerJS 公共云服务器（免费，仅用于建立连接，不中转画面）。
- 无任何后端，纯静态页面，托管在 GitHub Pages（免费 HTTPS，iOS Safari 打开摄像头必须 HTTPS）。

## 部署到 GitHub Pages

1. 在 GitHub 新建一个仓库（如 `homecam`），把本目录所有文件上传（可用 GitHub 网页端 Upload，或命令行 `git init` → `add` → `commit` → `push`）。
2. 仓库页面进入 Settings → Pages → Build and deployment → Source 选 `Deploy from a branch`，分支选 `main`，目录选 `/ (root)` → Save。
3. 等待 1~2 分钟，访问 `https://你的用户名.github.io/homecam/`（repo 名不同则对应修改）。

## 使用步骤

### 相机端（iPhone 7 Plus）

1. 打开 `https://你的用户名.github.io/homecam/camera.html`
2. 点击「随机」生成设备码（或自己输入），记下这个码
3. 点击「开始监控」，允许相机和麦克风权限
4. 关键设置：
   - 插上电源
   - 设置 → 显示与亮度 → 自动锁定 → **永不**
   - 保持 Safari 停留在该页面（页面视频播放可防止息屏），不要切到别的 App
   - 建议把屏幕亮度调低、关闭低电量模式

### 观看端（任何设备）

1. 打开 `https://你的用户名.github.io/homecam/viewer.html`
2. 输入与相机端相同的设备码，点击「连接」
3. 即可实时观看画面、听到声音；可手动截图、全屏、静音；检测到画面移动会自动推送截图记录

## 常见问题

- **相机打不开**：必须通过 HTTPS 访问；检查相机/麦克风权限；iPhone 7 Plus 最高 iOS 15，Safari 正常支持。
- **页面切后台就断**：iOS 会暂停后台页面的摄像头，这是系统限制，只能保持页面在前台（自动锁定设为永不 + 插电）。
- **连不上/画面卡**：双方网络 NAT 较严格时 WebRTC 可能打洞失败（如公司网络、某些校园网），家里 WiFi + 手机流量一般没问题；相机端手机流量信号差时也会卡。
- **安全性**：设备码经过 SHA-256 派生为信令 ID，不知道设备码的人无法找到你的摄像头；媒体流为 DTLS-SRTP 加密。
- **PeerJS 公共信令免费但无 SLA**：如长期使用想更稳定，可自建 PeerJS 服务器（改 `js/common.js` 里的 `PEER_CONFIG`），部署到 Render/Railway 免费额度即可。

## 文件结构

```
index.html      入口页
camera.html     相机端页面（跑在 iPhone 上）
viewer.html     观看端页面
css/style.css   样式
js/common.js    公共配置（信令服务器、设备码→PeerID 派生、时间格式）
js/camera.js    相机端逻辑（采集、应答、移动侦测、本地截图存储）
js/viewer.js    观看端逻辑（呼叫、渲染、截图请求、事件接收）
```
