# 设计：.muweave/ 物化元件中心与 DSH 五插件架构

## 1. 架构全景与数据流

```mermaid
flowchart TB
    subgraph Upstream [领域真源与本地运行态 · Split-Owner]
      Eikona[cli/eikona<br/>review_packet.v1 · asset_handoff.v2 · assess.result.v1]
      Auctra[cli/auctra<br/>screenplay room JSON · Scene Card · Candidate]
      Scaena[agent/scaena<br/>storyboard table summary · asset list/versions · timeline_view.v1]
      PiDir[.pi/ 工作区状态<br/>goals · subagent-runs · Plan Markdown]
      TplReg[template-registry<br/>template-registry.catalog.v1]
    end

    subgraph Bundle [.muweave/ 物化信息元件包 · @yeisme/muweave-bundle]
      Compiler[muweave-bundle CLI / Collector<br/>标记文件预检 · 脱敏与路径剥离 · tmp+rename 原子写]
      Dir[.muweave/<br/>bundle.v1.json · index.v1.json · elements/* · cas/sha256/* · events/sync.jsonl]
      ConsumerSDK[@yeisme/muweave-bundle/consumer<br/>纯浏览器安全解析器 · DSH 与 MuWeave Web 共享]
    end

    subgraph Host [DSH 0.2.2-rc.1 Host Half · @yeisme/dsh-muweave-core]
      RPC[POST /api/muweave-dsh/rpc<br/>同源栅栏 · 凭据扫描 · try/catch JSON 信封 · Generation/Reconcile]
      Media[GET /api/muweave-dsh/media<br/>短 TTL 令牌 · CAS SHA-256 核验 · HTTP Range]
      Preset[muweave-creator PTC Preset<br/>按需创作 Skills · 结构化模型工具]
    end

    subgraph Client [DSH 0.2.2-rc.1 Browser Half · 5 Plugins]
      CoreUI[双模 Tab/Pane 容器<br/>对话右栏官方 dockkit + 全局三栏/多标签/二分屏对比]
      FloatAgent[shell.overlay 三态悬浮 Agent<br/>Pill / Bar / Panel · 原生 SessionProvider · @元件 · /触发]
      Progress[ProgressStrip<br/>drama-process-timing 只读投影 · unknown 仅允许对账]
      P1[workbench 插件<br/>原件总览 + Pi/DSH 工件对比]
      P2[eikona 插件<br/>画廊 · 2/4-up 对比 · 母版 · 受控 Handoff]
      P3[script 插件<br/>双时间轴 · Scene Card · 图谱 · Diff]
      P4[drama 插件<br/>分镜表 · 资产四轴 · 时间线 · 剧镜对照]
      P5[kit 插件<br/>提示词插槽 · 中文 / 技能 · 白名单 CLI]
    end

    Eikona & Auctra & Scaena & PiDir --> Compiler
    Compiler --> Dir
    Dir --> ConsumerSDK
    Dir --> RPC
    Dir --> Media
    TplReg --> RPC
    RPC & Media --> CoreUI
    CoreUI --> P1 & P2 & P3 & P4 & P5
    Preset --> FloatAgent
    RPC --> Progress
```

## 2. 关键技术决策

1. **物化可重建不变量**：`.muweave/` 不存储孤立业务真值。删除 `.muweave/` 后执行 `muweave-bundle sync` 可从已绑定的 Eikona/Auctra/Scaena JSON 输出及 `.pi/` 重建。采集前强制检查 `.scaena/project.json` 与 `.auctra/` 标记文件，防止隐式初始化污染。
2. **双模 Tab/Pane 同构注册**：每个业务插件声明纯数据 `CreatorPaneSpec`，由 `@yeisme/dsh-muweave-core/client` 同时注册到 `ctx.sidebarRightTabs` + `sidebar.right.pane.tab`（对话页官方 `dockkit`）与全局页 `WorkspaceShell`（左树 220px、主舞台 ARIA TabStrip + 左右/上下对比分屏、右检查器 320px）。不自建浮动窗口系统，启动时不调用 `selectPanel`。
3. **原生会话驱动的三态悬浮 Agent**：通过 `shell.overlay` 声明会话级子槽，绑定 `ctx.sessions.retain` 与 `renderFactorySlot('conversation.content', { variant: 'embedded', hero: false })`，提供最小化胶囊、单行输入条（带建议菜单高度让位）与展开面板三态，并通过 `inputTriggers.registerSource` 提供 `@` 信息元件引用与 `/` 技能/提示词中文搜索。
4. **受控写操作与幂等对账**：保存 Scene Card、提交审阅、Eikona `feedback accept/reject`、`assets bind/handoff` 均携带 `expectedRevision` 与 `idempotencyKey`；超时或中断进入 `unknown` / `reconcile_required`，界面禁用重投仅保留对账动作。Eikona 远端付费生图参数默认校验 `openai/gpt-image-2.5-sunburst`、像素 `WxH` 与 `--quality high`，拒绝 `--size 2k` 与裸模型名。
5. **打包与测试隔离**：客户端使用 `esbuild` 构建 `window.__ModuleLoader__.load` lazy-CJS 产物，严格将种子模块标为 external；端到端验证在临时 `DSH_HOME` + `unshare -rn` 断网环境与本地 HTTP SSE 桩模型上执行 Playwright 多断点（1440/1024/768/390）断言，输出标准六件套脱敏证据。
