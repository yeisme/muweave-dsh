# F3 交付报告：项目诊断

> 交付日期：2026-11-20
> 依据：`f3-spec.md`（Codex 写）+ `project-management-arch.md` P2
> 实施：pi（`project.diagnose` 只读 RPC）+ Claude（诊断面板），我收口验证
> 前置：F1（`cdb732c`）、F2（`866ec4d`）

## 1. 一句话结论

F3 做完了：**能诊断出五类项目异常并给出可执行下一步，且「无法判断」永远显示为 `unknown` 而不是「正常」。**

## 2. 后端（pi）

新增 `project.diagnose`（**只读，绝不写盘**）：

| 项 | 内容 |
| --- | --- |
| 入参 | `{ projectId?: string }`，不传则诊断全部 |
| 返回 | `{ reports: DiagnosisReportV1[] }` |
| state | `healthy` / `warning` / `broken` / `unknown` |
| finding code | `registry_corrupt` / `bundle_missing` / `owner_unavailable` / `revision_conflict` / `unknown_operation` |

### 归 `unknown` 的六条判定（pi 给出的，我认同）

以下情况一律 `unknown`，**不会被误报成 healthy**：

1. `bundle.v1.json` 存在但读取或解析失败
2. manifest 与 index 可读，但 `projectId` 或 revision 内部不一致
3. 项目引用的 workspace 当前未注册，无法安全判断其 bundle 状态
4. `lastObservedRevisions` 的 key 无法解析，或 owner key 未知
5. operation ledger 出现无法识别的 status
6. operation 当前仍为 `unknown` 或 `reconcile_required`

这是 arch 文档「不能把未知状态标成成功」的具体落实——不是一句口号，是六条可测的判据。

## 3. 前端（Claude）

| 项 | 内容 |
| --- | --- |
| 位置 | 项目条 popover 底部「诊断」区，与「认领旧 bundle」并列 |
| 呈现 | 折叠一行摘要（全部正常 / N 项需注意 / N 项异常），展开列 findings |
| 懒查询 | 不展开不调 rpc；嵌进 popover 时打开 popover 也不调 |
| unknown 视觉 | 中性灰，文案「无法判断」，**不给「看起来没事」的视觉** |
| action | 有 action 的 finding 是可点文字按钮，点击只切项目，不触发写操作 |
| 失败处理 | rpc 报错/抛异常不崩，可重试 |

state 配色严格映射：healthy=绿 / warning=黄 / broken=红 / **unknown=灰**。

## 4. 实机验证（1440×900）

| 项 | 结果 |
| --- | --- |
| 诊断入口 | 存在，与认领入口并存 |
| 展开后 | `诊断 · 全部正常` / `所有项目正常` / state=`healthy` / 0 findings |
| 重新诊断 | 按钮可用 |
| JS 报错 | 零 |

当前两个项目确实健康，0 findings 是正确结果，不是没检测。

## 5. 文档收口（Codex gpt-6.2-sol）

同批交付：

- **新建 `docs/design/README.md`**：14 份文档的索引，按「想了解什么」组织（不是按时间），三态标注（现行 / 参考不改 / 已归档并注明被谁取代）
- **重写 `desk-v8-spec.md`**：任务清单改为实际交付状态，删掉已被证伪的「DramaSessionView 是死代码」
- **更新 `desk-v8-proposal.md`**：实施顺序改为双轨（结构线 P0/P1/P2 + 功能线 F1/F2/F3）
- **`project-features-next.md`** 顶部加状态横幅（F1/F2 已交付，F3 待做→已做）
- **新建 `f3-spec.md`**：五类异常映射、契约、交互、验收

## 6. 验证数字

| 项 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过 |
| `pnpm test` | **221/221**（30 文件，203 → 221） |
| 静态守卫 | 11/11 |
| `pnpm build` + `pack:plugins` | 通过 |
| `pnpm test:integration` | `passed=true`（`20261120042043932-muweave-dsh-a7c25256`） |

## 7. 已知未做

- **批量修复**：诊断只报告，不提供一键修复（这是有意的：修复需要用户判断）
- **诊断历史**：不记录「上次诊断时间」，每次展开都实时查
- **arch P2 剩余**：注册表迁移报告、schedule v2 预留，仍未做

## 8. 提交

`feat: v8 F3 项目诊断（pi 后端 + Claude 前端）+ 文档索引与 spec 收口`
