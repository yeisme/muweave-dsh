## Why

剧场 v1 能看、能做少量受控写入，但 DSH 里还没有任何生成入口：Sonora 没有接入，Scaena 只读，镜头和图片之间也没有关联。用户希望创作者能在平台里直接使用自己的各个工具。

## What Changes

- 新增能力目录。Eikona、Scaena、Sonora、Anatomia、Auctra、Pinax、manju-hotlist 都通过 owner CLI 适配器接入；未安装或缺少费用上限的工具如实标为不可用。
- 新增生成任务链：零调用估价 → 界面审批上限 → 带幂等键提交 → 轮询 → 逐格审阅 → 交接。付费默认关闭，智能体只能发起请求、不能批准，任务记录持久化，宿主重启后只做核对、不重新提交。
- 新增镜头与媒体的关联（`.muweave` bindings `shotMedia`），成稿房间和分镜网格据此显示镜头画面。
- 新增生成台抽屉、审批卡、成稿房间，以及四个智能体工具。
- 修正超时分类：执行被超时杀掉时，记为需要核对，而不是失败。

## Impact

- 代码：`packages/dsh-muweave-core`（协议、宿主、生成台）、`muweave-bundle`（schema、CAS 写入、镜头关联）、`workbench`（成稿房间）、`drama`、`kit`。
- 新增宿主数据文件 `jobs.v1.json` 和 `settings.v1.json`，存放在插件数据目录，权限 0600。
- 不改 owner 合同，不升级 dsh 版本固定，测试不产生真实付费调用。
