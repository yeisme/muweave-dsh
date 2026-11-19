# 幕织 DSH 工作台 v4（排期 · 触发器 · 悬浮分层）

承接 [desk-v3](./desk-v3.md)。这一轮回答三件事：**东西排到哪天**（新房间）、**@ 与 / 好不好用**（触发器质量）、**浮层像不像浮在纸上**（分层质感）。参考对象仍是 dsh-media-desk 的排期页与悬浮手感，只借鉴交互，没有复制文件或素材。

## 1. 排期房间（新插件 `@yeisme/dsh-muweave-schedule`）

### 边界

- `.muweave/` 仍然是元件的唯一真源；排期板只存**引用 + 日期 + 一句备注**，删了随时能重建。
- 存盘：`~/.dsh/plugin-data/muweave-dsh/schedule.v1.json`（`0600`，tmp + rename 原子写），与 `jobs.v1.json` 同目录但**不同文件**——排期写坏不许连累付费任务账本。
- 损坏处理：JSON 读不动时把原文件改名 `schedule.v1.corrupt-<时间>.json` 并空板启动，不静默吞掉。
- 上限 500 条，防智能体写爆。`ref` 精确去重：一个引用只占一天，改期是**移动**不是新增。

### 接口（挂在共享 `/api/muweave-dsh/rpc` 上）

| action | 入参 | 出参 |
| --- | --- | --- |
| `schedule.list` | — | `{ schema, entries, updatedAt }` |
| `schedule.plan` | `ref`、`date`(YYYY-MM-DD)、可选 `label`/`kind`/`note` | 同上（整板） |
| `schedule.clear` | `ref` | 同上（整板） |

错误码稳定：`muweave/invalid_ref`、`muweave/invalid_date`。日期按**真实日历**校验，`2026-02-31`、`2026-13-01` 一律拒绝；`kind`/`label`/`note` 未传时沿用旧值（改期不会把标题冲掉）。

### 界面

- **待排池**（左）：来自 `bundle.elements.list`、且不在板上的元件，按「场次 → 分镜表 → 剧本容器 → 视觉候选」排序；点一下选中，出现备注输入。
- **月历**（右）：周一起始 6 行 × 7 列；有排期的格子显示 chip，今天有描边高亮。选中待排项后点某天即排入；也可以直接把待排项**拖**到某天（`dragstart/drop`）。点 chip 取消该条。
- **Hero**：本月已排 / 待排 / 已过期三个数，加「上月 / 今天 / 下月」。
- 窄屏（容器 < 60rem）自动堆成单列，待排池在上、日历在下。

### 智能体工具（kit）

新增三个 PTC 工具，走同一条 RPC：

- `muweave_schedule_list`（可带 `from`/`to` 过滤）
- `muweave_schedule_plan`（`ref` + `date` 必填）
- `muweave_schedule_clear`

**为什么这三个不需要界面批准**：排期是本地计划、不花钱、随时可撤，和「付费生成必须由用户在生成台批准」是两类事。工具说明里写清了这条边界，并新增 `muweave-schedule-plan` 运行时技能（中文 `/` 也能搜到），要求智能体先从 `.muweave/` 取真实 ref，不许编。

## 2. @ 与 / 的体验

| 之前 | 现在 |
| --- | --- |
| 候选只按 `title/id/kind/ref` 做 `includes`，顺序是索引顺序 | 相关度打分：完全等于 100 → 标题前缀 80 → 标题包含 60 → 其他字段 30 → 子序列 10，`0` 直接不出现 |
| 没有记忆 | 最近使用（localStorage，各留 6 条）置顶为「最近使用」分区 |
| `@` 只能打关键词 | 支持前缀过滤：`@eikona`（域）、`@kind:drama.shot`、`@owner:scaena`、`@scene:ep01:s01`、`@episode:ep01`，剩余词仍做关键词 |
| description 直接吐原始枚举（`waiting_review`） | 走 `statusLabel` 中/英可读标签 |
| `/` 里技能和模板混排、模板可能压过技能 | 技能（动作）恒优先于模板（骨架）；模板按 `预设提示词 · 分类` 分组 |
| 最多 20 条、无上限说明 | 24 条封顶，序列化预算仍是每次发送 32KB（超了报错，不静默截断） |

`@` 插入格式没变（`[MuWeaveElement id=… owner=… ref=… digest=…]`），e2e 依赖的钩子照旧。

## 3. 悬浮分层（“3D”）

老板要的是「浮起来」的手感，不是霓虹。做法是**深度分层**，不是加装饰：

- 新增 `--mw-elev-4`：接触阴影 + 中景阴影 + 远景柔影三层叠加，再配 `--mw-bevel`（1px 内侧高光，用 label 色 6%）。命令面板、生成台抽屉用 `elev-4`；悬浮助手 panel 用 `elev-3`，bar/pill 用 `elev-2`——三态的高低差异一眼能看出来。
- 浮层入场 `mw-pop`：`perspective(60rem) → translateY → rotateX(1.2deg) → scale(0.99)` 收正，约 200ms；只在 `@supports` 之外无副作用，`prefers-reduced-motion: reduce` 下整体关闭。
- 卡片 hover：`translateY(-0.125rem)` + `elev-1 → elev-2`，按下回位。仍然是 rem 与 token，静态守卫继续管着。
- 面板体不再复述输入框的占位文案（同一句话出现两次是噪音），换成等宽字体的快捷键提示：`@ 引用元件 · / 技能与模板 · Enter 发送`；`core-client.test.tsx` 新增一条断言盯住"面板里不许再出现占位文案"。

## 体积

`lib/client.js`（未压缩）：

| 包 | v3 后 → v4 后 |
| --- | --- |
| core | 224 511 → 235 120 |
| workbench | 258 783 → 269 334 |
| eikona | 252 668 → 263 219 |
| script | 248 972 → 259 523 |
| drama | 253 728 → 264 279 |
| kit | 240 734 → 251 285 |
| schedule（新） | — → 253 051 |

core 与 5 个旧插件各 **+10.5KB**（触发器排序/最近使用/`@` 前缀语法、深度样式），新增 schedule 插件 253KB（复用同一份 core，没有第二份 react）。tgz 187 740–196 888 字节（六个包）。

## 验证

- `pnpm typecheck`、`pnpm build`、`pnpm pack:plugins` 通过（2 core + 6 plugins）。
- `pnpm test`：**98/98**（原 84 + 8 项排期：日期合法性、去重移动、清理、损坏隔离、上限、RPC 端到端、重启后仍在、非法日期错误码；+ 6 项触发器：打分档位、`@` 前缀语法、裸域词、最近使用置顶、序列化预算、`/` 技能优先）。
- `pnpm test:integration`：新增排期旅程——进房间 → 点待排项 → 点某天 → 出现 chip → 截图 → 再点 chip 取消 → chip 消失；截图 `schedule-room-1440x900.png`。

## 本地预览（带演示数据）

```bash
cd cli/muweave-dsh
node scripts/make-demo-workspace.mjs --dir ~/workplace/muweave-demo
MUWEAVE_WORKSPACE_DIR=~/workplace/muweave-demo dsh --profile muweave-lan --host <局域网IP> --port 4283 --no-open
```

演示工作区由 `scripts/fixture-workspace.mjs` 物化（与 e2e 共用同一份 fixture：Eikona 候选、Auctra 场次、Scaena 分镜表、Pi 工件），全程注入 payload，不跑任何 owner CLI。`muweave-lan` 是隔离 profile，六个插件都从 `.work/*.tgz` 装进去，不碰日常 web profile。

**刷新已安装的预览要注意**：profile 里 `file:` 指向 `.work/*.tgz`，路径不变时 pnpm 按 integrity 复用缓存，`pnpm install --force` 也不会重新解包（实测）。改完代码要真正生效，直接解包覆盖：

```bash
cd ~/.dsh/profiles/muweave-lan/node_modules/@yeisme
for p in dsh-muweave-{workbench,eikona,script,drama,kit,schedule}; do
  rm -rf $p && mkdir -p $p
  tar -xzf ~/workplace/yeisme-agent/cli/muweave-dsh/.work/yeisme-$p-0.1.0.tgz -C $p --strip-components=1
done
```

实测（2026-11-18，node1，dsh 0.2.2-rc.2）：七个房间 `workbench / eikona / script / drama / draft / kit / schedule` 全部出现；排期页点待排项 → 点 11-10 → chip 出现；⌘K 面板列出全部房间、当前视图与操作。

## 不做（说清楚为什么）

- **跨设备同步 / 发布后回填数据**：要有真实发布记录才成立，先留接口形状（`entries` 里已有 `note`），不造假的「已发布」。
- **复盘页**：同上，没有平台数据就是空壳。
- **日历拖拽跨月手势**：现在拖到目标月的同一天即生效（落盘按日期），跨月滚动跟随留给下一轮。
- **`@` 全文搜索元件载荷**：只能搜摘要字段，搜 payload 要宿主端建索引，会把 8MB 量级的 bundle 读进内存。
