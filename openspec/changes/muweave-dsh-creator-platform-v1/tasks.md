## 1. 合同与宿主

- [x] 1.1 `capability-protocol.ts` 线协议并从 protocol 导出
- [x] 1.2 能力适配器（eikona / scaena / sonora / anatomia / auctra / pinax / manju-hotlist），每个参数用 `--help` 核对
- [x] 1.3 任务仓库 `jobs.v1.json`、轮询、重启后进入 `reconcile_required`
- [x] 1.4 新 RPC 分派、付费开关、预算、审批校验
- [x] 1.5 超时分类修正：被杀的子进程归为需要核对

## 2. Bundle

- [x] 2.1 bindings `shotMedia` 与 schema 校验
- [x] 2.2 任务产物写入 CAS，并带上锚点（episode / scene / shot）
- [x] 2.3 分镜元素携带关联媒体

## 3. 界面

- [x] 3.1 生成台抽屉：能力列表、表单、估价、任务格子
- [x] 3.2 审批卡：上限、未知费用勾选、开关关闭时的说明、实花
- [x] 3.3 成稿房间：剧本加分镜，提供「为此镜出图」和「配音」
- [x] 3.4 分镜网格显示关联画面

## 4. 智能体、测试、文档

- [x] 4.1 kit 四个智能体工具（不能批准）和技能说明
- [x] 4.2 假 owner CLI 与 e2e：估价 → 批准 → 格子完成 → 采纳 → 镜头显示
- [x] 4.3 设计文档回填实测参数；所有检查通过
