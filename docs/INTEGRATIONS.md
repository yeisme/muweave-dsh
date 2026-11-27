# 配套引擎与外部服务

> 本仓库是**编排层**：界面、审核、账本、能力网关。真正出图 / 出片 / 出声 / 写剧本的引擎是独立的 owner CLI，**目前不开源，计划后续开源**。
>
> 没有引擎时插件不是不能用，而是相关能力在目录里显示为 `blocked` 并写明原因——能规划、能审核、能排期，只是不能付费生成。

## 1 为什么切成「编排层 + 引擎」

生成能力换得比界面快。把模型调用钉死在插件里，等于每次换供应商都要重写 UI。所以这里只做三件事：

1. **能力目录**：插件知道「这台机器上有什么能做、要花多少钱、敢不敢自动跑」；
2. **安全闸**：付费动作默认关闭，agent 只能发起申请不能自行批准，每笔都带费用上限与幂等键；
3. **账本**：每次生成、审阅、退回、绑定都留痕，可回放。

引擎那边只需要提供一个**能被验证的 CLI**：带 `--dry-run` 估价、带 `--max-cost-usd` 封顶、带幂等参数、输出 `--json`。

## 2 引擎一览

引擎之间不互相调用，靠**工作区标记目录**协作：每个引擎在自己目录里写产物，`.muweave/` 只记录引用与审核状态，`muweave-bundle doctor` 通过标记判断工作区完整度。

| 引擎 | 做什么 | 工作区标记 | 提供的能力 | 集成状态 | 开源状态 |
| --- | --- | --- | --- | --- | --- |
| **eikona** | 图像生成：角色定妆、场景、候选图组、2-up/4-up 对比与评估分 | `.eikona/` | `eikona.image.generate` | ✅ 可用（已核对 CLI 契约） | 计划开源 |
| **sonora** | 声音：音效、配音（TTS）、配乐 | `.sonora/` | `sonora.sfx.generate` ✅<br>`sonora.voice.tts` ⛔<br>`sonora.music.generate` ⛔ | 仅音效可用 | 计划开源 |
| **scaena** | 分镜与成片：镜头出图、镜头生成视频、剪辑会话 | `.scaena/` | `scaena.shot.draw` ⛔<br>`scaena.shot.video` ⛔ | 仅目录可见 | 计划开源 |
| **auctra** | 剧本工程：项目、场次、场景卡；插件只读写其结构化数据，不直接调生成 | `.auctra/` | `auctra.text.generate` ⛔<br>另有 `auctra.scene_card.save/submit` RPC | 剧本读写可用，文本生成不可用 | 计划开源 |
| **anatomia** | 参考视频拆解：结构、节奏、镜头分析 | `.anatomia/` | `anatomia.reference.analyze` ⛔ | 仅目录可见 | 计划开源 |
| **pinax** | 笔记与灵感箱：把想法收进可检索的知识库 | `.pinax/` | `pinax.inbox.capture` ⛔ | 未安装即显示 `OWNER_NOT_INSTALLED` | 计划开源 |
| **manju-hotlist** | 漫剧热榜：选题与题材的行情参考 | — | `manju-hotlist.research.query` ⛔ | 同上 | 计划开源 |
| **promptrepo** | 提示词模板库：以 `promptrepo://` URI 引用成体系的出图/写作模板 | — | 模板引用（非生成能力） | 模板引用已就绪 | 计划开源 |

> 公开后各引擎仓库地址会补在这张表里；在此之前表里写「计划开源」就是字面意思，不要去找。

## 3 为什么一半能力是灰的

能力要进「可用」，必须同时满足四条，缺一条就只进目录、不进执行：

| 闸 | 要求 | 现状 |
| --- | --- | --- |
| 费用上限 | 提交命令有 `--max-cost-usd` 之类的封顶参数 | `scaena.draw run`、`scaena vg`、`anatomia analysis start`、`auctra text` 缺 |
| 幂等键 | 重复提交不会重复扣费 | `scaena draw run` 缺 |
| 提交命令 | 有真正创建任务的子命令，而不是只有估价/查询 | `sonora tts` 只有 `estimate` 与 `job status` |
| 可核对产物 | 能拿到产物 id / sha256，供宿主核对后再入库 | 多数满足 |

对应原因码会原样显示在界面上，不会静默失败：

- `OWNER_NOT_INSTALLED`：PATH 上找不到该 CLI
- `MARKER_MISSING`：工作区缺少对应标记目录
- `NO_COST_CAP`：命令没有费用封顶
- `NO_SUBMIT_COMMAND`：没有提交子命令
- `ADAPTER_PENDING`：契约还没接完
- `PAID_DISABLED_BY_HOST`：宿主关闭了付费生成

**所以这不是「没做完」，是「不敢自动花钱」**。等引擎补上缺失参数，把 `blocked()` 换成真适配器即可，界面与审核链路不用改。

## 4 已核对的 CLI 契约

### eikona（可用）

```bash
# 估价（不产生费用）
eikona generate --input <file> --count N --dry-run --json

# 提交（封顶 + 幂等 + 后台）
eikona generate --input <file> --count N \
  --max-cost-usd C --approval-cost-usd C --approve-cost \
  --background --run-id <由幂等键派生> --json

# 轮询 / 取消
eikona status <run> --json      # data.status / data.artifacts[] / data.cost
eikona cancel <run> --json

# 审阅
eikona feedback accept|reject <run> --artifact <id> --reason <code> --json
```

eikona 没有独立幂等参数，所以幂等键被派生成 `--run-id`；产物由引擎写到 `--output-dir` 指定的插件私有目录，宿主只读那里，**不碰引擎自己的证据根目录**。

### sonora（仅音效）

```bash
sonora sfx estimate --text-file <f> [--duration-seconds D] --json
sonora sfx generate --text-file <f> [--duration-seconds D] \
  --confirm-live --idempotency-key K --max-cost-usd C [--confirm-unknown-price] --json
sonora sfx job get <job-id> --json
```

音效任务没有 cancel 子命令，所以取消在界面上是置灰的。

## 5 没有引擎时能做什么

四种用法，按投入从低到高：

1. **5 秒零成本全链路体验**：运行 `pnpm muweave demo seed --episodes 2` 生成示例工作区，并显式设置 `MUWEAVE_LOCAL_PREVIEW_ADAPTER=1` 启用零费用本地预览适配器（`demo.image.preview`，默认关闭），无需外部 API 即可走通 `estimate → approve → submit → slot review → linkToShot`；
2. **接入自定义外部引擎 Bridge（零明文密钥）**：在工具箱「外部引擎 Bridge 配置」或 `pnpm muweave adapters` 中登记 `openai_http`（OpenAI 兼容出图/配音）、`comfyui_http`（本地/局域网 ComfyUI）或无 shell `cli_wrapper`（配置持久化于 `pluginDataDir/custom-adapters.v1.json`，仅存环境变量名 `authEnvVar`，全程走 `paidEnabled`、`dailyCap` 与人工审批闸）；
3. **只用规划、连续性圣经、质检与交付**：剧本、分镜、连续性圣经、5 维自动质检（`muweave qc`）、离线甲方审片包 HTML、SRT/WebVTT 字幕、FCPXML/剪映/EDL 导出与排期均不依赖外部引擎；
4. **接入官方 owner CLI 或自建同名 CLI**：按第 4 节契约放进 PATH，运行 `pnpm muweave doctor --capabilities` 即可零费用检查每项能力的可用性与阻塞修复指引。

## 6 自己写一个 owner 适配器

代码位置：`packages/dsh-muweave-core/src/capabilities/`。

1. 新建 `myengine.ts`，实现 `CapabilityAdapter`：`descriptor` / `estimate` / `submit` / `poll`（可选 `cancel`、`review`）；
2. 在 `registry.ts` 的 `CAPABILITY_ADAPTERS` 里注册；
3. 拿不到安全参数就先不要接执行——照 `blocked.ts` 的写法登记进目录并给出原因码，这是刻意设计，不是妥协；
4. 补一条测试：断言估价不发付费调用（`--dry-run`）、提交带封顶与幂等、异常码映射到 `OWNER_STATUS_UNKNOWN`。

适配器**不许**自己读引擎的私有目录、不许在宿主侧缓存产物、不许绕过审批直接提交。

## 7 开源计划

| 引擎 | 计划 | 前置 |
| --- | --- | --- |
| eikona | 开源（优先） | 剥离内部部署配置与凭据注入 |
| scaena | 开源 | 补费用封顶与幂等参数 |
| sonora | 开源 | 补 tts 提交命令、music 三步链 |
| auctra | 开源 | 场景工程格式文档化 |
| anatomia / pinax / manju-hotlist | 开源（按需） | 各自依赖清理 |
| promptrepo | 开源 | 模板库与许可确认 |

进度会体现在第 2 节的「开源状态」列与各仓库 README。

## 8 License 与商业边界

本仓库 MIT。引擎各自独立授权（开源后同样会给许可证）。**生成内容的版权与平台合规归使用者**，本仓库不代持、不转售生成能力。
