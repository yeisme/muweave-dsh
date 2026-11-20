# 真实素材验证：结论与阻塞原因

> 日期：2026-11-20
> 目的：验证 v8 的 L1 主产物 / L2 变体带 / 对比栏在**有真实图片**时的效果
> 结论：**当前演示环境无法完成，原因是环境限制，不是代码缺陷**

## 1. 事实链（逐条已实测）

| 步骤 | 实测结果 |
| --- | --- |
| 演示 bundle 的元素是否有封面 | **全部 `cover: None`，payload 全空**（10/10 元素） |
| 封面字段的真实来源 | `coverDigest()` 读 `mediaBlobs[]` 里第一个 `image/*` 的 `blobDigest`（不是 `cover`） |
| 演示 CAS 里有几个 blob | **1 个** |
| 那个 blob 是什么 | **1×1 像素的占位 PNG，70 字节**（e2e 用的最小样本），不是真实图片 |
| 有没有绑定 eikona 的 workspace | `~/workplace`、`~/workspace` 下 **0 个**有 `.eikona` 标记，**0 个** bundle 的 `eikonaRuns` 非空 |
| eikona 有没有历史产出 | 有，**2548 个 runs**，visual-library 里有真实 PNG blob |
| 能不能复用历史产出 | 可以（`eikona library save` / `assets handoff` 是官方路径），但需要把产出绑定到 workspace 才会被 bundle sync 编译进 `.muweave/` |
| 能不能现生成 | **不能**：`eikona generate` 报 `PROVIDER_UNAVAILABLE`；实测 `curl api.openai.com` 返回 **HTTP 000（不可达）** |
| 内网网关 | `10.10.1.101:18976` 返回 **401**（需 MCP token） |

## 2. 所以「No image」到底是谁的问题

**不是 UI 缺陷**，是数据与网络两层限制叠加：

1. 没有任何 workspace 绑定过 eikona 产出 → 元素没有 `mediaBlobs` → 缩略图无 digest 可用
2. 想现生成图 → 公网 provider 不可达、内网网关需 token
3. 演示 CAS 里唯一的 blob 是 1×1 占位图，就算绑上也不可见

## 3. 我做了什么验证（不污染数据的前提下）

用 Playwright 的 `page.route` **在响应层注入 `mediaBlobs`**，纯读侧、不动任何磁盘数据：

- 拦截命中 14 次，10 个元素被注入 digest
- 结果：**缩略图仍为空** → 证明即使有 digest，演示 CAS 里也没有对应的可服务图片
- 这也顺带验证了注入链路本身是通的（说明 UI 读的是 `mediaBlobs`，与我读代码的结论一致）

## 4. 要在真实环境看到图，需要其中一条成立

| 路径 | 前置条件 | 现状 |
| --- | --- | --- |
| A. 绑定既有 eikona 产出 | 选一个 workspace，用 `eikona assets bind` 把某个 run 的 artifact 绑进去，再 `bundle.sync` | **可做**，需要一条命令，但会改变该 workspace 的 owner 事实 |
| B. 现生成 | 公网可达 或 内网网关有 token | **当前不可行** |
| C. 用 1×1 占位图 | 无需前置 | 已排除：图不可见，验证无意义 |

**我选择不做 A**，原因是：给演示 workspace 造 owner 绑定会伪造 ownership 事实，而「不伪造事实」是这个项目从第一天起就在守的边界（`docs/design/project-management-arch.md` 里「不能静默重写 bundle」是同一条原则）。

如果主人要我做 A，一条命令即可，但需要明确知道它会给 `muweave-demo` 写入真实 owner 绑定。

## 5. 这次验证的实际价值

虽然没看到图，但确认了三件对后续有用的事：

1. **UI 的图片链路是 `mediaBlobs[].blobDigest` → `media.token.issue` → `<img>`**，字段名与链路已核实（我一开始误用 `cover`，读代码后纠正）
2. **演示环境的「空」是环境事实，不是 bug**——以后看到 `No image` 不必再排查 UI
3. **生成能力受网络限制**：想在这个环境出图，必须解决公网出口或给内网网关配 MCP token

## 6. 建议

优先级从高到低：

1. **给内网 eikona 网关配 MCP token**（打通后 A/B 两条路都能走）
2. 或在 Mac 侧用 `image_generate` 生成 2–3 张，落到 `~/workspace/media-workbench/assets/images/`，再从那里绑
3. 暂时接受 `No image` 占位——它在设计上是**诚实的空态**，不是错误
