# my-project-phase-2

DECIDER 游戏 Phase 2 基础网页原型（对应 `PLAN.md` 的 Day 2–3，提前做了 Day 4 的跨设备联机）。

## 页面

| 页面 | 文件 | 用途 |
| --- | --- | --- |
| 入口页 | `index.html` | 链接到下面两个页面 |
| Shared Main Screen | `screen/index.html` | 笔记本上显示的共享主屏幕（生成房间码） |
| 手机玩家页 | `player/index.html` | 真手机/平板：输入房间码、选角色、发动作 |

## 当前视觉效果

- **背景**：`assets/room/Map.png`（像素风室内房间）铺满 Game Area，保持 16:9 原比例。
- **角色**：独立图层站在房间中央木地板上（Idle 动画循环播放）。位置/大小可在 `css/screen.css` 的 `.character` 里调 `--char-height`（高度）和 `--char-floor-y`（脚底位置）。
- **Environment Test Panel**：顶栏三个按钮 ☀️ Sunny / 🌧️ Rain / ❄️ Snow，同一时间只有一种环境。
  - Sunny：地图本身的晴天 + 轻微暖光。
  - Rain / Snow：`js/environment.js` 代码生成的雨滴/雪花，只出现在背景大窗户区域内，窗外会稍微变暗，不会落到室内。数量、大小、速度在文件顶部 `ENV_CONFIG` 里调。

## 如何运行（联机版）

1. 笔记本用 Chrome/Edge 打开 `screen/index.html`（本地双击，或 Pages 上的链接均可）。
2. 记住主屏幕右上角的 **4 位房间码**（如 `KX7P`）。
3. 手机上打开玩家页 `player/index.html`：输入房间码 → 选角色 → 输入名字 → **Join the game** → 点击动作（💨 Blow / 📳 Shake / 👆 Press / 📐 Tilt）。
4. 主屏幕实时更新：角色卡显示玩家、中间角色播放对应效果、五个角色都用过动作后显示组合结果。

> 联机要求：笔记本和手机都要能上网（消息经公共 MQTT 服务器中转）。房间码保存在本地，下次打开还会沿用同一个码。

## 技术说明

- **跨设备通信**：MQTT over WebSocket，使用公共服务器 `broker.emqx.io`（备用 `broker.hivemq.com`），客户端库 `js/vendor/mqtt.min.js` 已下载到项目里，不依赖任何 CDN，无需注册、无需自己部署服务器。
- **隐私提醒**：公共服务器上任何知道房间码的人都能收发该房间的消息。原型阶段可以接受；正式版（Day 4 后续）换成自己的服务器时，只需改 `js/shared.js` 一个文件。
- **Idle 动画**：`js/idle.js` 顶部 `IDLE_CONFIG` 可调整速度（`fps`，当前 6）和帧列表；帧图片在 `assets/idle/frames/`，路径相对 `screen/index.html` 页面。
- 五个角色（Environment / Movement / Action / Object / Tool）是占位设计，Day 1 确定最终规则后替换；每个角色同一时间只有一个玩家（后加入的覆盖先加入的）。

## 项目结构

```
├── index.html                入口页
├── screen/index.html         Shared Main Screen（笔记本）
├── player/index.html         手机玩家页
├── assets/idle/frames/       Idle 动画帧（008.png / 009.png）
├── assets/room/Map.png       房间背景（16:9 像素画）
├── css/
│   ├── base.css              共享基础样式
│   ├── screen.css            主屏幕样式（含角色定位、天气效果）
│   └── player.css            玩家页样式
└── js/
    ├── vendor/mqtt.min.js    MQTT 客户端库（本地）
    ├── shared.js             共享数据 + 房间码 + MQTT 通信层
    ├── screen.js             主屏幕逻辑
    ├── player.js             玩家页逻辑
    ├── idle.js               角色 Idle 动画（速度参数在顶部 IDLE_CONFIG）
    └── environment.js        Sunny/Rain/Snow 环境系统（参数在顶部 ENV_CONFIG）
```

## GitHub Pages

站点地址：`https://gauuuh.github.io/my-project-phase-2/`
（`Settings → Pages → Build and deployment → Deploy from a branch → main / (root)`）

## 下一步（对应 PLAN.md）

- **Day 4 完整版**：可选把公共 MQTT 服务器换成自己的 Node.js + Socket.IO 服务器（托管到 Render/Railway），房间管理更可控。
- **Day 5 / Playtest**：多名玩家实机测试不同角色和隐藏选择如何形成可理解的共享结果。
