# MuWeave DSH 设计文档索引

先按问题查阅。状态是文档治理标记，不等同于功能交付状态。

## 想了解当前 v8 交付与下一步

| 文件 | 状态 | 一句话作用 | 何时读它 |
| --- | --- | --- | --- |
| [desk-v8-spec.md](./desk-v8-spec.md) | 现行 | v8 的调研依据、交付清单、验收状态和后续待做项 | 需要核对 P0/P1/P2、M1-M4、F1/F2/F3 或 arch P2 状态时 |
| [desk-v8-proposal.md](./desk-v8-proposal.md) | 现行 | v8 工作台的结构线与功能线方案及取舍 | 需要理解 v8 为什么按双轨推进时 |
| [project-features-next.md](./project-features-next.md) | 现行 | F1、F2 已交付与 F3 设计源 | 需要查看项目管理功能的事实、判断和依赖时 |
| [f3-spec.md](./f3-spec.md) | 现行 | F3 项目诊断的只读契约、异常映射和交互验收 | 需要实施或评审项目诊断时 |
| [project-management-arch.md](./project-management-arch.md) | 现行 | 项目注册表、RPC 边界、P0-P2 架构验收 | 需要核对项目数据边界、错误码和长期兼容预留时 |
| [f1-delivery.md](./f1-delivery.md) | 参考（不改） | F1 的实现范围、证据、提交和已知未做项 | 需要核对 F1 已交付事实或验证数字时 |
| [f2-delivery.md](./f2-delivery.md) | 参考（不改） | F2 的实现范围、证据、提交和已知未做项 | 需要核对 F2 认领向导事实或验证数字时 |
| [README.md](./README.md) | 现行 | 本目录的阅读入口和时效性索引 | 进入 docs/design 目录时 |

## 想了解 v8 的专项设计与视觉依据

| 文件 | 状态 | 一句话作用 | 何时读它 |
| --- | --- | --- | --- |
| [desk-v8-p1-compare.md](./desk-v8-p1-compare.md) | 参考（不改） | P1 并排对比的专门交互与验收稿 | 需要追溯对比栏行为或差异摘要规则时 |
| [motion-spec.md](./motion-spec.md) | 参考（不改） | M1-M4 动效、reduced-motion 与死 hook 处置规格 | 需要核对动效约束或 M1-M4 证据时 |
| [mockup-v8.html](./mockup-v8.html) | 参考（不改） | v8 工作台的高保真静态稿 | 需要查看视觉意图而不是当前实现契约时 |

## 想了解较早版本或基础方向

| 文件 | 状态 | 一句话作用 | 何时读它 |
| --- | --- | --- | --- |
| [desk-v7.md](./desk-v7.md) | 已归档（被 desk-v8-spec.md 取代） | v7 项目管理、composer、工具集成和排期收尾记录 | 需要追溯 v8 之前的项目条、排期和工具目录背景时 |
| [desk-v6.md](./desk-v6.md) | 已归档（被 desk-v7.md 取代） | v6 macOS 视觉、keymap 和引用渲染方案 | 需要追溯 v6 的交互基础时 |
| [desk-v5.md](./desk-v5.md) | 已归档（被 desk-v6.md 取代） | v5 动效、排期手速和命令面板方案 | 需要追溯旧动效和排期交互时 |
| [desk-v4.md](./desk-v4.md) | 已归档（被 desk-v5.md 取代） | v4 排期、触发器、@/ 和悬浮分层方案 | 需要追溯房间与悬浮层的初始边界时 |
| [desk-v3.md](./desk-v3.md) | 已归档（被 desk-v4.md 取代） | v3 全宽 Desk、筛选浮层和命令面板方案 | 需要追溯工作台从卡片布局转向画布时 |
| [project-management-plan.md](./project-management-plan.md) | 已归档（被 project-management-arch.md 取代） | 项目管理候选方案、推荐方案和优先级 | 需要理解为什么采用独立项目注册表时 |
| [visual-polish-v1.md](./visual-polish-v1.md) | 已归档（被 visual-macos-v6.md 取代） | 首版视觉 token、外壳和共享原语 | 需要追溯视觉系统的初始约束时 |
| [editorial-v2.md](./editorial-v2.md) | 参考（不改） | editorial 视觉方向和五个房间的版式探索 | 需要理解 editorial 方向的来源时 |
| [visual-macos-v6.md](./visual-macos-v6.md) | 参考（不改） | macOS 液态玻璃 token 与边界 | 需要核对 v6 视觉 token 或玻璃使用边界时 |
| [theater-v1.md](./theater-v1.md) | 参考（不改） | 做剧剧场入口、座位交接和会话视图基础 | 需要理解剧场壳层和会话视图来源时 |
| [creator-platform-v1.md](./creator-platform-v1.md) | 参考（不改） | 创作者平台能力目录、估价、审批和 owner 交接边界 | 需要核对生成任务安全边界和 owner CLI 约束时 |

`已归档` 只表示该文档不再作为对应主题的主入口。交付报告和专项稿保留为事实证据，按索引中的“参考（不改）”读取。
