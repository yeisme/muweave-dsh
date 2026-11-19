# .muweave/ 物化信息元件包与 DSH 五插件架构

## 1. 核心原则

1. **真源不迁移（Split-Owner）**：生图与视觉资产真源归 `cli/eikona`，剧本结构与候选审阅归 `cli/auctra`，分镜与生产图归 `agent/scaena`，预设提示词目录归 `backend-server/template-registry`。
2. **物化可重建（Rebuildable Bundle）**：`.muweave/` 由 `muweave-bundle` CLI / 服务通过官方 `--json` 与 `handoff` 契约原子生成（临时文件 + `rename`），支持随时删除重建，绝不手写或直读 `.eikona/**`、`.auctra/**`、`.scaena/**` 私有数据库。
3. **双端同构消费**：`@yeisme/muweave-bundle/consumer` 为零 Node 依赖的纯函数读取与校验层，同时供本仓 5 个 DSH 插件与 `client/muweave-frame-studio` 消费。

## 2. .muweave/ 标准目录布局

```text
.muweave/
├── bundle.v1.json              # 项目级绑定清单（eikona runs/collections、auctra project、scaena episodes/breakdowns）
├── index.v1.json               # 全项目信息元件轻量索引与统计摘要
├── elements/
│   ├── eikona/                 # 候选组、角色/场景母版绑定、评分卡、handoff 元数据
│   ├── script/                 # 双时间轴场次、Scene Card、Context Graph、Candidate Diff
│   ├── drama/                  # 分镜表摘要行、资产四轴状态、剪辑时间线摘要
│   └── harness/                # .pi/goals、.pi/subagent-runs、Plan Markdown、DSH 工具工件
├── cas/sha256/<2-char>/<hash>  # 经 SHA-256 核验的受控预览媒体缓存（.gitignore）
└── events/sync.jsonl           # append-only 同步与操作回执流水
```

## 3. DSH 表面与安全围栏

- **对话页右栏**：通过 `ctx.sidebarRightTabs.register` + `sidebar.right.pane.tab` 挂载进宿主官方 `dockkit`。
- **全局页工作台**：通过 `sidebar.panellist` + `main` 提供可调宽三栏（左树、中舞台多标签与二分屏对比、右检查器）及底部进度条。
- **三态悬浮 Agent**：通过 `shell.overlay` 声明会话作用域子槽，复用宿主原生 `SessionProvider` 与 `conversation.content`，支持胶囊（Pill）、单行输入条（Bar）与展开对话面板（Panel），原生集成 `@` 信息元件引用与 `/` 创作技能/提示词触发。
- **通信与脱敏**：统一经 `POST /api/muweave-dsh/rpc` 与短效令牌 `GET /api/muweave-dsh/media` 通信，深度拦截明文凭据、跨站请求与目录越界。
