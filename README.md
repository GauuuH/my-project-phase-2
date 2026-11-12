# my-project-phase-2

DECIDER 游戏 Phase 2 基础网页原型（对应 `PLAN.md` 的 Day 2–3，提前做了 Day 4 的跨设备联机）。

## 页面

| 页面 | 文件 | 用途 |
| --- | --- | --- |
| 入口页 | `index.html` | 链接到下面两个页面 |
| Shared Main Screen | `screen/index.html` | 笔记本上显示的共享主屏幕（生成房间码） |
| 手机玩家页 | `player/index.html` | 真手机/平板：输入房间码、选角色、测试真实交互 |

## 当前视觉效果

- **背景**：`assets/room/Map.png`（像素风室内房间）铺满 Game Area，保持 16:9 原比例。
- **角色**：独立图层站在房间中央木地板上，7 个 Character State（Idle / Walk / Run / Jump / Fall / Blown by Wind / Eat），由 `js/animations.js` 统一管理。
  - 所有动画都是单帧 PNG 序列；除 Idle 外，原始帧带不透明背景，**运行时用洪泛填充抠图**（不修改原始 PNG）。
  - 每个动画有独立的 `fps`（在 `js/animations.js` 顶部 `ANIM_CONFIG`），并带校准数据，切换动画时角色的身体大小、脚底位置和中心位置保持一致。
  - Walk / Run / Idle 循环播放；Jump / Fall / Blown by Wind / Eat 播放一遍后自动回到 Idle。
  - **Character Test Panel**（页面右侧竖排按钮，开发测试用，之后会删除）可手动切换动画。
- **Items**：Pizza / Football / Umbrella / Hammer / Flashlight / Phone / None，由 `js/items.js` 管理。
  - 作为独立图层显示在角色附近（不合并进角色动画），同一时间只显示一个，保持图片原比例和透明背景。
  - **Item 跟随角色**：Item 不再固定在世界坐标，而是以角色当前位置（`characterWorldX/Y`）为基准 + 锚点偏移（`js/items.js` 顶部 `ITEM_ANCHORS`，hand / mouth / feet），角色移动的每一帧都会同步更新 Item 位置。Umbrella / Hammer / Flashlight / Phone 在身体右侧手边，Football 在脚边，Pizza 在嘴附近。
  - **Item Test Panel**（CHAR TEST 下方，开发测试用）可手动切换。大小在 `js/items.js` 顶部 `ITEM_CONFIG` 里调（height = 高度 %）。
  - 素材来源：`protection.png` → umbrella，`mobile-phone.png` → phone（仅重命名复制，内容未改）。
- **Environment Test Panel**：顶栏三个按钮 ☀️ Sunny / 🌧️ Rain / ❄️ Snow，同一时间只有一种环境。
  - Sunny：地图本身的晴天 + 轻微暖光。
  - Rain / Snow：`js/environment.js` 代码生成的雨滴/雪花，只出现在背景大窗户区域内，窗外会稍微变暗，不会落到室内。数量、大小、速度在文件顶部 `ENV_CONFIG` 里调。

## 如何运行（联机版）

1. 笔记本用 Chrome/Edge 打开 `screen/index.html`（本地双击，或 Pages 上的链接均可）。
2. 记住主屏幕右上角的 **4 位房间码**（如 `KX7P`）。
3. 手机上打开玩家页 `player/index.html`：输入房间码 → 选角色 → 输入名字 → **Join the game**。
   - **角色占用强制规则（一个 Role = 一个在线玩家）**：输入房间码后手机就会**预先监听房间**（Laptop 通过 `screen-ping` / `stage-state` 回复），每个 Role 按钮始终显示 **0/1（空闲）** 或 **1/1（已占用）**：占用的按钮变暗、不可点击、无法选中，JOIN 按钮也会自动禁用。若两台手机同时抢同一个 Role，Laptop 仲裁：先被接受的玩家拥有该 Role，第二台手机收到 `join-rejected` 并自动回到 Role Selection（提示 "This role is already occupied. Please choose another role."）。已占用玩家 Leave 后，该 Role 自动恢复 0/1，所有手机无需刷新即可看到。
4. 加入后**不会立刻启动交互**——本轮是**顺序依赖流程**（`js/shared.js` 里 `DECIDER.STAGE_ORDER`，顺序固定为 Environment → Direction → Action → Item）：
   | Role | Interaction |
   | --- | --- |
   | 🌍 Environment | 💨 Blow（天气选择器：持续吹气循环 Sunny → Rain → Snow，停止吹气 = 选定，**玩家主动选择，非随机**） |
   | 🧭 Direction | 👋 Swipe（快速滑动，**结果 = 真实滑动方向** Left/Right/Up/Down） |
   | ⚡ Action | 📳 Shake（DeviceMotion 摇晃 → Walk / Run / Jump / Fall / Eat） |
   | 📦 Item | 📐 Tilt（DeviceOrientation 倾斜；**可选 Item 由已完成的 Action 决定**，见 `ACTION_ITEM_MAP`） |
   - 只有**当前轮到的 Role** 才能执行自己的 Interaction 并提交；Laptop 保存结果但不 Reveal，通过 MQTT 广播 `stage-state` 自动推进：上一位玩家提交后，下一位玩家的手机自动从 **WAITING FOR …** 切换成 **YOUR TURN** 并自动启动对应 Interaction（无需任何按钮）。
   - 未轮到的手机显示 `WAITING FOR <当前 Role>` + `Please wait for the <Role> player.`；已完成自己 Role 的手机锁定并显示 READY；迟加入的玩家加入后根据 Laptop 的 currentStage 自动同步（顺序由 Laptop 强制校验，任何 Role 无法绕过顺序提前提交）。
   - Press & Hold（👆）保留在页面上但**不绑定任何 Role**，仅作 dev/test 交互，不产生游戏结果、不参与本轮。页面下方保留 **Manual test (dev)** 按钮。阈值在 `js/interactions.js` 顶部 `INTER_CONFIG`。
5. **Environment = Blow 天气选择器**：初始 selector = Sunny，麦克风 `getLevel() > 0.05` 时每 ~700ms 循环一步 Sunny → Rain → Snow；level 降回阈值以下并保持 ~300ms = 停止吹气，当前显示的天气即为 Environment 结果并自动提交。必须至少发生一次有效循环步（防止瞬间误触）。手机实时高亮 ☀️/🌧️/❄️，只有 Environment 手机看到 selector，Laptop 提前不显示选择。
6. 笔记本收到结果后**只按 Role 秘密保存**（不显示具体选择、不触发任何环境/角色/道具反馈）；四个 Role Card 中已提交的显示 **● READY**，主状态显示 **X / 4 READY**，并显示当前 Turn。
7. **Combine & Command Reveal + Execute**：四个 Role 全部完成后（`state.results.size === DECIDER.ROLES.length`），主屏幕一次性 Reveal（顺序 Environment · Direction · Action · Item）并**执行一次**（`js/screen.js` 的 `executeCommand`），例如：
   - `Rain · Right · Run · Pizza`
   - `Run right in the rain with a pizza.`
   执行直接复用现有系统：Environment → `setEnvironment()`；Action + Direction → `playCharacterState()`（Walk/Run 用 WalkLeft/WalkRight/RunLeft/RunRight 真实方向资产）+ `moveCharacter()`（平滑位移，无瞬移）；Item → `showItem()`（跟随角色）。每轮只执行一次（不受每秒 render() 影响）。
   - **Action → Item 依赖**：Item 的可选池由已完成的 Action 决定（`DECIDER.ACTION_ITEM_MAP`）：Walk/Run → Flashlight/Hammer/Umbrella/Phone；Jump → Football/Hammer/Phone；Fall → Football/Phone；Eat → Pizza。Laptop 通过 `stage-state` 把 pool 发给 Item 手机，Tilt 只在 pool 内随机。
   - **Eat + Pizza 特殊互动**：Pizza 显示在角色嘴附近 → Eat 动画播放 → 动画结束后 Pizza 自动消失；其他 Item 只需正确跟随角色。
   4/4 之前只显示 READY 计数，绝不泄露具体结果。
   - **DEV: Fill Missing Roles** 按钮（右侧 DEV 面板）：按 Environment → Direction → Action → Item 顺序补缺失结果，且 Item 遵守 `ACTION_ITEM_MAP`、Action 遵守 `ACTION_COMPATIBILITY`（目前全部组合都允许五种 Action，后续可加 "Env+Dir" 专属规则）；补足后走同一套 Reveal → Execute 流程，不会破坏 currentStage。仅开发测试用。
8. **NEXT ROUND**：Reveal 后主屏幕出现 **NEXT ROUND →** 按钮。点击后开始新一轮：清空 `state.results`、`combined = false`、`currentStage` 重置为 Environment、取消未完成的 Item/移动/天气选择计时器，Character 回到初始中央位置并回 Idle、Environment 回 Sunny、Item 回 None、四个 Role Card 回到已加入但未 READY、主状态回到 `0 / 4 READY`；同时通过 MQTT 广播 `round-reset`（带新 currentStage）：Environment 手机自动进入 YOUR TURN 并重启 Blow 选择器，其余手机自动显示 WAITING FOR ENVIRONMENT，无需退出或刷新。

> 联机要求：笔记本和手机都要能上网（消息经公共 MQTT 服务器中转）。房间码保存在本地，下次打开还会沿用同一个码。

## 技术说明

- **跨设备通信**：MQTT over WebSocket，使用公共服务器 `broker.emqx.io`（备用 `broker.hivemq.com`），客户端库 `js/vendor/mqtt.min.js` 已下载到项目里，不依赖任何 CDN，无需注册、无需自己部署服务器。
- **隐私提醒**：公共服务器上任何知道房间码的人都能收发该房间的消息。原型阶段可以接受；正式版（Day 4 后续）换成自己的服务器时，只需改 `js/shared.js` 一个文件。
- **Idle 动画**：`js/idle.js` 顶部 `IDLE_CONFIG` 可调整速度（`fps`，当前 6）和帧列表；帧图片在 `assets/idle/frames/`，路径相对 `screen/index.html` 页面。
- 四个角色（Environment / Action / Item / Direction），每个角色同一时间只有一个在线玩家（Laptop 在 player-join 时强制仲裁，后加入的会被 join-rejected 拒绝，不再覆盖先加入的）；原 Object + Tool 已合并为 Item，Swipe 从 Tool 改为 Direction。

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
    ├── interactions.js       五种真实手机交互（阈值在顶部 INTER_CONFIG；Swipe 带真实方向判断）
    ├── animations.js         角色动画系统（7 状态，fps 在顶部 ANIM_CONFIG；含 characterWorldX/Y 与 MOVE_CONFIG 平滑移动）
    ├── items.js              Item 图层（角色相对定位，锚点在顶部 ITEM_ANCHORS）
    └── environment.js        Sunny/Rain/Snow 环境系统（参数在顶部 ENV_CONFIG）
```

## GitHub Pages

站点地址：`https://gauuuh.github.io/my-project-phase-2/`
（`Settings → Pages → Build and deployment → Deploy from a branch → main / (root)`）

## 下一步（对应 PLAN.md）

- **Day 4 完整版**：可选把公共 MQTT 服务器换成自己的 Node.js + Socket.IO 服务器（托管到 Render/Railway），房间管理更可控。
- **Day 5 / Playtest**：多名玩家实机测试不同角色和隐藏选择如何形成可理解的共享结果。
