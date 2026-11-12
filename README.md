# my-project-phase-2

DECIDER 游戏 Phase 2 基础网页原型（对应 `PLAN.md` 的 Day 2–3，提前做了 Day 4 的跨设备联机）。

## 页面

| 页面 | 文件 | 用途 |
| --- | --- | --- |
| 入口页 | `index.html` | 链接到下面两个页面 |
| Shared Main Screen | `screen/index.html` | 笔记本上显示的共享主屏幕（生成房间码） |
| 手机玩家页 | `player/index.html` | 真手机/平板：输入房间码、选角色、测试五种真实交互 |

## 当前视觉效果

- **背景**：`assets/room/Map.png`（像素风室内房间）铺满 Game Area，保持 16:9 原比例。
- **角色**：独立图层站在房间中央木地板上，7 个 Character State（Idle / Walk / Run / Jump / Fall / Blown by Wind / Eat），由 `js/animations.js` 统一管理。
  - 所有动画都是单帧 PNG 序列；除 Idle 外，原始帧带不透明背景，**运行时用洪泛填充抠图**（不修改原始 PNG）。
  - 每个动画有独立的 `fps`（在 `js/animations.js` 顶部 `ANIM_CONFIG`），并带校准数据，切换动画时角色的身体大小、脚底位置和中心位置保持一致。
  - Walk / Run / Idle 循环播放；Jump / Fall / Blown by Wind / Eat 播放一遍后自动回到 Idle。
  - **Character Test Panel**（页面右侧竖排按钮，开发测试用，之后会删除）可手动切换动画。
- **Objects & Tools**：Pizza / Football / Umbrella / Hammer / Flashlight / Phone / None，由 `js/items.js` 管理。
  - 作为独立图层显示在角色附近（不合并进角色动画），同一时间只显示一个，保持图片原比例和透明背景。
  - **Item Test Panel**（CHAR TEST 下方，开发测试用）可手动切换。位置/大小在 `js/items.js` 顶部 `ITEM_CONFIG` 里调（left/top = 中心点 %，height = 高度 %）。
  - 素材来源：`protection.png` → umbrella，`mobile-phone.png` → phone（仅重命名复制，内容未改）。
- **Environment Test Panel**：顶栏三个按钮 ☀️ Sunny / 🌧️ Rain / ❄️ Snow，同一时间只有一种环境。
  - Sunny：地图本身的晴天 + 轻微暖光。
  - Rain / Snow：`js/environment.js` 代码生成的雨滴/雪花，只出现在背景大窗户区域内，窗外会稍微变暗，不会落到室内。数量、大小、速度在文件顶部 `ENV_CONFIG` 里调。

## 如何运行（联机版）

1. 笔记本用 Chrome/Edge 打开 `screen/index.html`（本地双击，或 Pages 上的链接均可）。
2. 记住主屏幕右上角的 **4 位房间码**（如 `KX7P`）。
3. 手机上打开玩家页 `player/index.html`：输入房间码 → 选角色 → 输入名字 → **Join the game**。
4. 加入后**自动启动该角色绑定的交互**（`js/shared.js` 里 `DECIDER.ROLE_INTERACTION`，开发绑定）：
   | Role | Interaction |
   | --- | --- |
   | 🌍 Environment | 💨 Blow（麦克风吹气） |
   | 🧭 Movement | 📳 Shake（DeviceMotion 摇晃） |
   | ⚡ Action | 👆 Press & Hold（按住约 1.5 秒） |
   | 📦 Object | 📐 Tilt（DeviceOrientation 倾斜） |
   | 🔧 Tool | 👋 Swipe（快速滑动） |
   页面下方保留 **Manual test (dev)** 五个按钮，可手动切换测试。检测成功后随机生成该 Role 的一个结果（结果池在 `DECIDER.ROLE_RESULTS`）：
   - Environment：Sunny / Rain / Snow
   - Movement：Walk / Run / Jump / Fall
   - Action：Eat / Hit / Use
   - Object：Pizza / Football
   - Tool：Umbrella / Hammer / Flashlight / Phone
   结果生成后保持显示，交互同时锁定（点 ⟳ Try again 解锁重试），暂不触发笔记本上的反馈。阈值在 `js/interactions.js` 顶部 `INTER_CONFIG`。
5. 玩家完成自己 Role 的交互得到结果后，手机立即通过 MQTT 向房间发送 `player-result`（playerId / roleId / result），手机进入 **READY — result sent**，本轮不可重复提交（手动测试其他 Role 的交互只在本机显示，不会提交）。
6. 笔记本收到结果后**只按 Role 秘密保存**（不显示具体选择、不触发任何环境/角色/道具反馈）；五个 Role Card 中已提交的显示 **● READY**，未提交的显示 WAITING/online；主状态显示 **X / 5 READY**（1–2 台手机也能正常测试）。

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
├── assets/char/<state>/frames/  7 个角色动画的帧序列
├── assets/items/           Pizza/Football/Umbrella/Hammer/Flashlight/Phone
├── assets/room/Map.png     房间背景（16:9 像素画）
├── css/
│   ├── base.css              共享基础样式
│   ├── screen.css            主屏幕样式（含角色定位、天气效果）
│   └── player.css            玩家页样式
└── js/
    ├── vendor/mqtt.min.js    MQTT 客户端库（本地）
    ├── shared.js             共享数据 + 房间码 + MQTT 通信层
    ├── screen.js             主屏幕逻辑
    ├── player.js             玩家页逻辑（加入/心跳/离开）
    ├── interactions.js       五种真实手机交互（阈值在顶部 INTER_CONFIG）
    ├── animations.js         角色动画系统（7 状态，fps 在顶部 ANIM_CONFIG）
    ├── items.js              Objects & Tools 图层（位置/大小在顶部 ITEM_CONFIG）
    └── environment.js        Sunny/Rain/Snow 环境系统（参数在顶部 ENV_CONFIG）
```

## GitHub Pages

站点地址：`https://gauuuh.github.io/my-project-phase-2/`
（`Settings → Pages → Build and deployment → Deploy from a branch → main / (root)`）

## 下一步（对应 PLAN.md）

- **Day 4 完整版**：可选把公共 MQTT 服务器换成自己的 Node.js + Socket.IO 服务器（托管到 Render/Railway），房间管理更可控。
- **Day 5 / Playtest**：多名玩家实机测试不同角色和隐藏选择如何形成可理解的共享结果。
