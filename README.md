# my-project-phase-2

DECIDER 游戏 Phase 2 基础网页原型（对应 `PLAN.md` 的 Day 2–3）。

## 页面

| 页面 | 文件 | 用途 |
| --- | --- | --- |
| 入口页 | `index.html` | 链接到下面两个页面 |
| Shared Main Screen | `screen/index.html` | 笔记本上显示的共享主屏幕 |
| 手机玩家页 | `player/index.html` | 模拟一台手机：选角色、加名字、发动作 |

## 如何运行（无需安装任何东西）

1. 用 Chrome 或 Edge 双击打开 `index.html`（或直接打开 `screen/index.html`）。
2. 在**同一个浏览器**的其他标签页/窗口中打开 `player/index.html`，模拟一台"手机"。
3. 在玩家页：选角色 → 输入名字 → **Join the game** → 点击动作（💨 Blow / 📳 Shake / 👆 Press / 📐 Tilt）。
4. 主屏幕会实时更新：中间世界播放对应效果、底部角色卡显示在线状态、五个角色都用过动作后会显示组合结果。

## 当前原型说明

- 主屏幕和"手机"之间使用浏览器自带的 `BroadcastChannel` 通信，所以必须在**同一台电脑的同一个浏览器**里打开（这是 Day 4 之前的临时方案）。
- 五个角色（Environment / Movement / Action / Object / Tool）是占位设计，Day 1 确定最终规则后会替换。
- 每个角色同一时间只有一个玩家（后加入的覆盖先加入的）。
- Blow 和 Shake 目前是按钮模拟；之后会换成手机麦克风吹气、加速度计摇晃等真实物理交互。

## 项目结构

```
├── index.html           入口页
├── screen/index.html    Shared Main Screen（笔记本）
├── player/index.html    手机玩家页
├── assets/idle/frames/   Idle 动画帧（008.png / 009.png）
├── css/
│   ├── base.css         共享基础样式
│   ├── screen.css       主屏幕样式
│   └── player.css       玩家页样式
└── js/
    ├── shared.js        共享数据（角色/动作）+ 跨标签页通信
    ├── screen.js        主屏幕逻辑
    ├── idle.js          角色 Idle 动画（速度参数在文件顶部 IDLE_CONFIG）
    └── player.js        玩家页逻辑
```

## 下一步（对应 PLAN.md）

- **Day 4**：用 Node.js + Socket.IO 服务器替换 `BroadcastChannel`，让真正的手机也能连入同一个房间。
- **Day 5 / Playtest**：多名玩家实机测试不同角色和隐藏选择如何形成可理解的共享结果。
