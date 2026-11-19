# 幕织 DSH 创作者平台 v1：能力目录、估价审批、生成任务

OpenSpec：`../../openspec/changes/muweave-dsh-creator-platform-v1/`。线协议：`packages/dsh-muweave-core/src/capability-protocol.ts`。

做剧剧场 v1 只能"看"和少量受控写入：DSH 里没有任何生成入口，Sonora 没接，Scaena 只读，镜头和图片之间也没有关联。本轮把用户自己的工具（Eikona、Scaena、Sonora、Auctra、Anatomia，以及未安装时如实降级的 Pinax、manju-hotlist）接进同一条生成链：

**发现 → 零调用估价 → 人工审批上限 → 带幂等键提交 → 轮询 → 逐格审阅 → 交接回 owner / 关联到镜头**

dsh-media-desk 的做法里，借鉴了"先计划再并行展开""预分配格子、每格单独状态""服务端任务""按钮上写估价、完成后写实花""如实降级"这几条。没有照搬的是：它不设门槛直接调用付费接口，私有 LLM 循环，任务状态只放内存，插件里直连 provider。

## 规矩

- **只走 owner CLI。** 插件不直连任何 provider。每项能力都由一个适配器把请求翻译成 owner 的官方命令（`--json`，估价用 `--dry-run` 或 `estimate`），二进制名写死，不经 shell。
- **付费默认关闭。** 宿主开关 `paidEnabled` 默认 `false`，由插件数据目录里的 `settings.v1.json` 或环境变量 `MUWEAVE_DSH_PAID=1` 打开。开关关闭时估价照常可用，`job.approve` 返回 `PAID_DISABLED`。
- **审批只能来自界面。** 智能体工具只能 `capability.estimate` 和 `job.request`，后者生成 `waiting_approval` 状态的任务；批准必须在界面的审批卡上点。"继续"永远不算授权。宿主路由要求 `job.approve` 带 `Sec-Fetch-Site: same-origin`，没有就返回 403 `APPROVAL_REQUIRED`。这个头只有浏览器会带，但能执行 shell 的智能体仍能伪造请求，这一残余风险已在代码里注明。
- **审批条件。** 上限低于估价时报 `CEILING_BELOW_ESTIMATE`。估价没有金额（单位不是 none）时需要另外勾选"接受未知费用"，否则报 `UNKNOWN_COST_NOT_ACCEPTED`。可选的按日上限 `dailyCap`，超出时报 `BUDGET_EXCEEDED`。上限会原样交给 owner（`--max-cost-usd`、`--max-credits` 等）。
- **预算按最坏情况算。** 只要任务到过 owner，owner 报告实花之前，它的批准上限一直计入「已承诺」，任务失败、取消或放弃都不例外，同时计入「owner 未报告费用」的任务数。只有一种情况不计：提交被 owner 明确拒绝，而且没有拿到 run id。预算检查和转入 queued 在同一把锁里完成，两个并发批准不会一起越过日上限。
- **不重复提交。** 每个任务有固定的幂等键。提交超时、或宿主重启时任务还在跑，都进入 `reconcile_required`，之后只按 `ownerJobRef` 查询状态，绝不重新提交。
- **不落原始提示词。** 提示词只存在于宿主内存和 owner 的临时请求文件里，提交后即删除。任务记录只保存 `promptDigest`；标题由能力名、镜头或场次引用和时间组成，不取提示词里的任何字。估价 15 分钟后过期。镜头等锚点在估价时就按 bundle 的引用规则校验。
- **只传引用。** 生成结果通过 owner 的 handoff 或 review 合同拿到摘要和 digest，再用 `putCasBlob` 写进 `.muweave` CAS，界面通过媒体令牌读取。不读 `.eikona/**` 等私有目录。
- **镜头关联只记引用。** 镜头关联写在 `.muweave` 的 bindings `shotMedia` 里，只保存 shotRef 加 sha256 或 elementId，可以随时重建，不是 owner 真相。

## 能力目录（v1）

下表中的命令全部用 `--help` 核对过，实现时没有跑过任何 generate、run 或 dry-run。只要缺了费用上限、幂等键或确认开关中的任何一个，这项能力就标为不可用，不用别的参数凑。

| capabilityId | 状态 | 估价 → 提交 → 查询 |
| --- | --- | --- |
| `eikona.image.generate` | 可用，paid usd | 估价：`generate --input F --count N --dry-run --json`。提交：再加 `--max-cost-usd C --approval-cost-usd C --approve-cost --background --run-id dsh-<幂等键哈希> --json`。查询：`status <run> --json`。Eikona 没有幂等参数，所以 run id 由幂等键派生，核对时按 run id 查。提交时加 `--output-dir <插件数据>/owner-out/<run>`，产物由 owner 复制到这里；宿主只从这个目录读，并核对 owner 报告的 sha256，不碰 `.eikona/**` |
| `sonora.sfx.generate` | 可用，paid usd，1 格 | 估价：`sfx estimate --text-file F --json`。提交：`sfx generate --text-file F --confirm-live --idempotency-key K --max-cost-usd C --json`。查询：`sfx job get <id> --json` |
| `scaena.shot.draw` | 不可用 `NO_COST_CAP` | `draw run` 只有 `--confirm`，没有费用上限，也没有幂等参数 |
| `scaena.shot.video` | 不可用 `NO_COST_CAP` | `--max-cost-usd` 只对部分模型生效，`--idempotency-key` 只适用于 input-bundle |
| `sonora.voice.tts` | 不可用 `NO_SUBMIT_COMMAND` | `tts` 只有 estimate、job status/cancel 和 voices，没有提交命令 |
| `sonora.music.generate` | 不可用 `ADAPTER_PENDING` | 参数都在，但需要 brief、plan、approval issue 一整条链和授权 epoch，下一轮再接 |
| `anatomia.reference.analyze` | 不可用 `NO_COST_CAP` | `analysis start` 没有上限，也没有幂等参数 |
| `auctra.text.generate` | 不可用 `NO_COST_CAP` | owner 没有费用上限 |
| `pinax.inbox.capture`、`manju-hotlist.research.query` | 不可用 `OWNER_NOT_INSTALLED` | 本机没有安装；装上后显示 `ADAPTER_PENDING`，等核对参数 |

不可用的几项要接进来，需要 owner 补上对应的参数（上限、幂等键、提交命令），都应该在各自的 owner 子项目里改。本插件只负责如实显示原因。

## 任务模型

- `job.request` 根据估价创建任务，同时预分配 `slots` 个格子（全部 `pending`），状态为 `waiting_approval`。宿主重启后，提示词随内存丢失，这类任务会标为 `failed` / `ESTIMATE_EXPIRED`。
- `job.approve` 依次检查开关、上限和日预算，然后**先把批准意图写盘**；写盘失败就直接中止，不调用 owner。写盘成功后，带幂等键提交给 owner，拿到 `ownerJobRef` 后进入 `running`。
- 提交结果不确定时（超时、被信号杀掉；Eikona 的任何非零退出也算，因为 `--background` 可能已经排上了队），任务进入 `reconcile_required`。轮询器会继续按 `ownerJobRef` 查询状态，永不重新提交。界面上有「核对」和「放弃（费用未知）」两个按钮，放弃后任务状态为 `cancelled`，错误码 `SPEND_UNKNOWN`。Sonora 的 `sfx job get` 只认 owner 的 job id，不认幂等键，所以 Sonora 的非零退出按失败处理。
- 宿主每 3 秒轮询一次 `running` 任务和带 ref 的 `reconcile_required` 任务，只有存在这类任务时才开计时器。owner 报告某格完成时，宿主把媒体写进 CAS，格子变为 `done`。Eikona 产物没有 `artifact_id`、无法回给 owner 审阅时，这一格直接记 `failed`。全部格子结束后，任务进入 `waiting_for_human`（等待审阅）或 `failed`。
- `job.slot.review` 先完成 owner 的审阅调用（Eikona 是 `feedback accept/reject`）和 `shotMedia` 关联，两步都成功后才改格子并写一次盘。已经审阅过的格子直接返回当前状态，不再调用 owner。所有格子都审阅过以后，任务进入 `completed`。
- `job.cancel` 对 `waiting_approval` 直接生效；已提交的任务调用 owner 的 cancel。
- 任务记录持久化在插件数据目录 `jobs.v1.json`（权限 0600，和 ledger 同目录），最多保留 200 条。文件损坏时，宿主把它改名为 `jobs.v1.corrupt-<时间>.json`，之后所有批准都返回 `PAID_DISABLED`，直到人工处理。启动时还会清理两类残留：超过 5 分钟的临时请求文件，以及已结束或已不在记录里的任务的 `owner-out/<run>` 目录。
- 产物只从私有目录读取：Eikona 读 `owner-out/<run>`；Sonora 没有输出目录参数，只接受工作区内的普通文件。读取前都先用 `lstat` 检查大小，上限 64 MiB。

## 界面

- **生成台（core，所有房间共用）。** 顶栏有一个"生成"胶囊，上面标着活跃任务数，点开是右侧抽屉。抽屉打开时每 2 秒刷新一次；关闭后只在有 queued 或 running 任务时每 5 秒刷新。按 Esc 关闭（输入法组字时忽略），焦点回到打开抽屉的那个按钮。抽屉里有三块：
  - 能力列表：按当前房间筛选；不可用的能力置灰并写明原因。
  - 表单：先估价，结果以计划行加金额的形式显示。
  - 任务列表：每个任务一排格子，每格显示 pending / running / done / failed，done 的格子有缩略图或试听，以及采纳 / 拒绝。
- **审批卡。** 显示 owner、计划行、估价、可编辑的上限（为空、不大于 0 或低于估价时禁用批准，并给出提示）、今日已承诺和已花费；未知费用时多一个勾选框。主按钮写"批准并生成（≤ $C）"。开关关闭时按钮禁用，并说明怎么打开。完成后显示实花；owner 没报告时写"owner 未报告"，不写 0。
- **成稿房间（新增，放在 workbench 包里）。** 左侧是剧本阅读卡，按场次；右侧是本集分镜网格，镜头有关联图时显示图片。每个镜头有"为此镜出图"按钮，会预填镜头描述和 anchor 并打开生成台。每场有"配音"按钮，打开 `sonora.voice.tts`。在 Sonora 提供提交命令之前，这项显示为不可用并写明原因。
- **分镜房间。** 网格格子优先显示 `shotMedia` 里的 keyframe。
- **智能体工具（kit）。** 新增四个工具：`muweave_capability_catalog`、`muweave_capability_estimate`、`muweave_job_request`、`muweave_job_status`。工具说明里写明：批准只能由用户在界面上完成。

## 不做

- 实际花钱的调用：测试一律使用假 owner CLI 和注入的 runner。
- 改 owner 的合同。
- 升级 dsh 版本固定。
- Auctra 文本生成：没有费用上限，先不接。
- blender-mcp、forma、drivebridge：本轮不接。

## 体积

`lib/client.js` 的大小（字节）对比如下。只打包了一份 react。

| 包 | editorial v2 后 → 本轮后 |
| --- | --- |
| core | 161 368 → 207 981 |
| workbench | 181 737 → 241 519 |
| eikona | 187 645 → 235 404 |
| script | 182 843 → 231 708 |
| drama | 184 821 → 236 464 |
| kit | 174 266 → 223 470 |

## 验证

- `pnpm typecheck` 通过；`pnpm build` 和 `pnpm pack:plugins` 通过。
- `pnpm test`：84 项中 83 项通过。唯一失败的是 `tests/kit.test.ts` 的 preset 对齐检查，原因是本机的 dsh 是 rc.2，与本轮改动无关，详见 [editorial-v2](./editorial-v2.md#宿主版本说明)。本轮新增的测试：
  - `tests/capabilities.test.ts`、`tests/jobs.test.ts`：
    - 审批门：开关关闭、上限低于估价、未知费用、日预算、并发锁；
    - 来源检查：`Sec-Fetch-Site`；
    - 提示词不进任务记录；
    - 锚点校验；
    - 核对与放弃；
    - 写盘失败时不提交；
    - 任务文件损坏后禁止批准；
    - 启动清理；
    - Sonora 读取路径限制。
  - `tests/shot-media.test.ts`：shotMedia 的增删、CAS，以及被信号杀掉的子进程。
  - `tests/generation-ui.test.tsx`：
    - 抽屉、估价和审批卡；
    - 未知费用按估价判断；
    - 核对与两步放弃；
    - 从不显示 $0；
    - 轮询节奏；
    - Esc 与焦点返回；
    - 上限校验；
    - 采纳后成稿房间原地刷新。
  - `tests/kit.test.ts`：四个智能体工具中没有批准类工具，也不会带出 `--approve-cost`。
- `pnpm test:integration` 在最终代码上连续通过 3 次。假 owner CLI 在 `scripts/fake-owners/` 下，不发起任何网络请求。走通的旅程是：成稿房间 → 为此镜出图 → 估价 → 提交 → 填上限并批准 → 格子出图 → 采纳 → 镜头原地显示图片。截图包括 `generation-*` 和 `draft-room-*`，覆盖 1440 宽的浅色和深色，以及 390 宽。证据目录扫描过，没有发现家目录路径、密钥或提示词。
- 本轮没有执行任何真实 owner 的 generate、run 或 dry-run 命令，只看过 `--help`。

## 已知限制

- `job.approve` 的来源检查只能挡住非浏览器的调用方。能执行 shell 的智能体仍然可以伪造请求头，这一点需要靠宿主的工具权限来约束。
- 带 ref 的 `reconcile_required` 任务，如果 owner 一直返回无法识别的状态，会每 3 秒查询一次，直到用户点「放弃」。
- Sonora 目前只接入了音效。配音需要 owner 先提供提交命令，配乐需要接通 brief / plan / approval 整条链。
- 成稿房间的镜头图片依赖重新采集分镜，也就是 `bundle.sync`。没有绑定 breakdown 时，分镜行上不会带出关联媒体。
