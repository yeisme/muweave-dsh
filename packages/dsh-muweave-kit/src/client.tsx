import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ALLOWLISTED_CLI_CARDS_BROWSER,
  BUILTIN_CREATOR_TEMPLATES,
  CREATOR_CHINESE_SKILLS,
  EmptyState,
  Icon,
  IconButton,
  Masonry,
  RoomHero,
  SectionHead,
  WorkspaceShell,
  openGeneration,
  registerMuweaveCreatorPlugin,
  stageItemToFloatingAgent,
  type AllowlistedCliCardDefV1,
  type DshClientContextLike,
  type MuweaveRpcClient,
  type MuweaveTranslator,
  type TemplateCatalogEntryV1,
} from '@yeisme/dsh-muweave-core/client'

export const name = '@yeisme/dsh-muweave-kit'
export const inject: readonly string[] = ['slots', 'locale', 'sidebarRightTabs']

export const KIT_PANEL_ID = 'muweave-kit'
export const KIT_COMPANION_ID = 'muweave-kit/companion'
export const KIT_LOCALE_NS = 'muweaveKit'

const zh = {
  panelTitle: '创作工具箱',
  roomTitle: '工具箱',
  subtitle: 'CLI / Skills / 预设提示词',
  companionTitle: '提示词与 CLI 快捷卡',
  tabTemplates: '预设提示词',
  tabSkills: '创作技能',
  tabCli: 'CLI 操作卡',
  stageTemplateBtn: '组装并推入助手',
  copyPromptBtn: '复制提示词',
  copiedPromptReceipt: '已复制提示词',
  generateDirectBtn: '直接去生成',
  catAll: '全部',
  catEikona: '视觉',
  catScript: '剧本',
  catDrama: '分镜',
  catFilterLabel: '按分类筛选模板',
  runCliBtn: '执行只读诊断',
  selectPlaceholder: '请选择',
  slotCount: '{n} 个插槽',
  required: '必填',
  preview: '组装结果',
  skillsHint: '这些技能只在 muweave-creator 预设中按需激活；在输入框键入 / 可用中文检索。',
  stageSkill: '推入悬浮助手',
  copyCommand: '复制命令',
  cliHint: '只开放白名单内的只读诊断命令。',
  output: '输出',
  doctor: '原件体检',
  mcpCardTitle: 'CLI & MCP 接入向导',
  mcpCardHint: '终端直连与外部 AI 客户端接入配置（仅含安全占位符，不含任何本机路径或凭据）。',
  cliCookbookTitle: '常用 Creator CLI 命令',
  mcpConfigTitle: 'MCP Server 配置模板',
  mcpModeStdio: '本地 stdio (Claude/Cursor)',
  mcpModeRemote: '远程 HTTP 服务',
  mcpModeProxy: '联机回环代理',
  copyMcpBtn: '复制 MCP 配置',
  copiedMcpReceipt: '已复制配置',
  copiedCliReceipt: '已复制命令',
}

const en: Record<keyof typeof zh, string> = {
  panelTitle: 'Creator Toolkit',
  roomTitle: 'Toolkit',
  subtitle: 'CLI / Skills / Prompts',
  companionTitle: 'Prompts & Safe CLI',
  tabTemplates: 'Prompt Presets',
  tabSkills: 'Creator Skills',
  tabCli: 'CLI Cards',
  stageTemplateBtn: 'Compose & Stage to Assistant',
  copyPromptBtn: 'Copy Prompt',
  copiedPromptReceipt: 'Prompt copied',
  generateDirectBtn: 'Generate Now',
  catAll: 'All',
  catEikona: 'Visual',
  catScript: 'Script',
  catDrama: 'Storyboard',
  catFilterLabel: 'Filter templates by category',
  runCliBtn: 'Run Diagnostic',
  selectPlaceholder: 'Select',
  slotCount: '{n} slots',
  required: 'Required',
  preview: 'Composed Instruction',
  skillsHint: 'These skills load on demand only in the muweave-creator preset; type / in the composer to search.',
  stageSkill: 'Stage to Assistant',
  copyCommand: 'Copy Command',
  cliHint: 'Only allowlisted read-only diagnostics are exposed.',
  output: 'Output',
  doctor: 'Bundle Doctor',
  mcpCardTitle: 'CLI & MCP Integration Guide',
  mcpCardHint: 'Terminal commands and external AI client MCP configs (safe placeholders only — zero host paths or secrets).',
  cliCookbookTitle: 'Creator CLI Cookbook',
  mcpConfigTitle: 'MCP Server Config',
  mcpModeStdio: 'Local stdio (Claude/Cursor)',
  mcpModeRemote: 'Remote HTTP Server',
  mcpModeProxy: 'Loopback Host Proxy',
  copyMcpBtn: 'Copy MCP Config',
  copiedMcpReceipt: 'Config copied',
  copiedCliReceipt: 'Command copied',
}

export function KitIcon({ size = 16, active = false }: { size?: number; active?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" data-active={active ? 'true' : 'false'}>
      <path d="M3 4.5l3 3-3 3M7.5 11.5h5.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

type KitTemplateCategory = 'all' | 'eikona' | 'script' | 'drama'

const KIT_TEMPLATE_CATEGORIES: ReadonlyArray<{ id: KitTemplateCategory; labelKey: string }> = [
  { id: 'all', labelKey: 'catAll' },
  { id: 'eikona', labelKey: 'catEikona' },
  { id: 'script', labelKey: 'catScript' },
  { id: 'drama', labelKey: 'catDrama' },
]

type McpConfigMode = 'stdio' | 'remote-http' | 'proxy'

const KIT_CLI_COOKBOOK: ReadonlyArray<{ id: string; command: string }> = [
  { id: 'status', command: 'muweave status' },
  { id: 'shots-missing', command: 'muweave shots list --missing keyframe' },
  { id: 'export-edl', command: 'muweave export cmx3600_edl --out roughcut.edl' },
  { id: 'demo-seed', command: 'muweave demo seed' },
]

const KIT_MCP_MODES: ReadonlyArray<{ id: McpConfigMode; labelKey: string; snippet: string }> = [
  {
    id: 'stdio',
    labelKey: 'mcpModeStdio',
    snippet: JSON.stringify(
      {
        mcpServers: {
          muweave: {
            command: 'npx',
            args: ['-y', '@yeisme/dsh-muweave-core', 'mcp', '--workspace', '${workspaceFolder}'],
          },
        },
      },
      null,
      2,
    ),
  },
  {
    id: 'remote-http',
    labelKey: 'mcpModeRemote',
    snippet: JSON.stringify(
      {
        mcpServers: {
          'muweave-remote': {
            type: 'streamable-http',
            url: 'https://<your-mcp-host>:3741/mcp',
            headers: {
              Authorization: 'Bearer <your-mcp-token>',
            },
          },
        },
      },
      null,
      2,
    ),
  },
  {
    id: 'proxy',
    labelKey: 'mcpModeProxy',
    snippet: JSON.stringify(
      {
        mcpServers: {
          'muweave-proxy': {
            command: 'npx',
            args: ['-y', '@yeisme/dsh-muweave-core', 'mcp', '--host-url', 'http://127.0.0.1:3741'],
            env: {
              MUWEAVE_MCP_TOKEN: '<your-mcp-token>',
            },
          },
        },
      },
      null,
      2,
    ),
  },
]

function capabilityIdForTemplate(tpl: TemplateCatalogEntryV1): string {
  const refLower = tpl.templateRef.toLowerCase()
  if (refLower.includes('audio') || refLower.includes('sfx')) return 'sonora.sfx.generate'
  if (tpl.category === 'eikona') return 'eikona.image.generate'
  return 'eikona.image.generate'
}

export function KitMainPage({
  rpc,
  t,
  coreT,
}: {
  rpc: MuweaveRpcClient
  t: (k: string) => string
  coreT: MuweaveTranslator
}) {
  const [templates, setTemplates] = useState<TemplateCatalogEntryV1[]>([...BUILTIN_CREATOR_TEMPLATES])
  const [categoryFilter, setCategoryFilter] = useState<KitTemplateCategory>('all')
  const [selectedTplRef, setSelectedTplRef] = useState<string>(BUILTIN_CREATOR_TEMPLATES[0]?.templateRef ?? '')
  const [slotValues, setSlotValues] = useState<Record<string, string>>({})
  const [previewOutput, setPreviewOutput] = useState<string>('')
  const [copiedReceipt, setCopiedReceipt] = useState<boolean>(false)
  const [mcpMode, setMcpMode] = useState<McpConfigMode>('stdio')
  const [copiedMcpReceipt, setCopiedMcpReceipt] = useState<boolean>(false)
  const [copiedCliId, setCopiedCliId] = useState<string | null>(null)
  const [cliCards, setCliCards] = useState<AllowlistedCliCardDefV1[]>([...ALLOWLISTED_CLI_CARDS_BROWSER])
  const [cliOutput, setCliOutput] = useState<Record<string, string>>({})

  const loadCatalogs = useCallback(async () => {
    const [tplRes, cliRes] = await Promise.all([
      rpc.call<{ templates: TemplateCatalogEntryV1[] }>('templates.list', {}),
      rpc.call<{ operations: AllowlistedCliCardDefV1[] }>('cli.catalog', {}),
    ])
    if (tplRes.ok && Array.isArray(tplRes.data?.templates) && tplRes.data.templates.length > 0) setTemplates(tplRes.data.templates)
    if (cliRes.ok && Array.isArray(cliRes.data?.operations) && cliRes.data.operations.length > 0) setCliCards(cliRes.data.operations)
  }, [rpc])

  useEffect(() => {
    void loadCatalogs()
  }, [loadCatalogs])

  const visibleTemplates = useMemo(
    () => (categoryFilter === 'all' ? templates : templates.filter((item) => item.category === categoryFilter)),
    [templates, categoryFilter],
  )

  const activeTemplate =
    visibleTemplates.find((item) => item.templateRef === selectedTplRef) ?? visibleTemplates[0] ?? templates[0]

  const renderCurrentPreview = async (): Promise<string | undefined> => {
    if (!activeTemplate) return undefined
    const res = await rpc.call<{ structuredInstruction: string; templateRef: string }>('templates.render_preview', {
      templateRef: activeTemplate.templateRef,
      values: slotValues,
    })
    if (!res.ok) {
      setPreviewOutput(`✕ ${res.error.message}`)
      return undefined
    }
    setPreviewOutput(res.data.structuredInstruction)
    return res.data.structuredInstruction
  }

  const handleComposeTemplate = async () => {
    if (!activeTemplate) return
    const rendered = await renderCurrentPreview()
    if (!rendered) return
    stageItemToFloatingAgent({
      kind: 'template',
      ref: activeTemplate.templateRef,
      label: activeTemplate.title,
      serializedLine: rendered,
    })
  }

  const handleCopyPrompt = async () => {
    const existing = previewOutput && !previewOutput.startsWith('✕ ') ? previewOutput : undefined
    const text = existing ?? (await renderCurrentPreview())
    if (!text) return
    try {
      await navigator.clipboard?.writeText(text)
    } catch {
      // Clipboard may be unavailable in restricted contexts; still surface receipt.
    }
    setCopiedReceipt(true)
  }

  const handleDirectGenerate = async () => {
    if (!activeTemplate) return
    const existing = previewOutput && !previewOutput.startsWith('✕ ') ? previewOutput : undefined
    const text = existing ?? (await renderCurrentPreview())
    if (!text) return
    openGeneration({
      capabilityId: capabilityIdForTemplate(activeTemplate),
      input: { prompt: text },
    })
  }

  const activeMcpConfig = KIT_MCP_MODES.find((item) => item.id === mcpMode) ?? KIT_MCP_MODES[0]!

  const handleCopyMcpConfig = async () => {
    try {
      await navigator.clipboard?.writeText(activeMcpConfig.snippet)
    } catch {
      // Clipboard may be unavailable in restricted contexts; still surface receipt.
    }
    setCopiedMcpReceipt(true)
  }

  const handleCopyCliCommand = async (id: string, command: string) => {
    try {
      await navigator.clipboard?.writeText(command)
    } catch {
      // Clipboard may be unavailable in restricted contexts; still surface receipt.
    }
    setCopiedCliId(id)
  }

  const handleRunCliCard = async (operationId: string) => {
    const res = await rpc.call<{ exitCode: number; outputExcerpt?: string; summary?: Record<string, unknown> }>(
      'cli.run_allowlisted',
      { operationId },
    )
    if (!res.ok) {
      setCliOutput((prev) => ({ ...prev, [operationId]: `✕ [${res.error.code}] ${res.error.message}` }))
      return
    }
    const text = res.data.outputExcerpt ?? JSON.stringify(res.data.summary ?? {}, null, 2)
    setCliOutput((prev) => ({ ...prev, [operationId]: `exit=${res.data.exitCode}\n${text}` }))
  }

  return (
    <WorkspaceShell
      title={t('panelTitle')}
      subtitle={t('subtitle')}
      rpc={rpc}
      t={coreT}
      onSyncRequested={loadCatalogs}
      hero={
        <RoomHero
          eyebrow={t('subtitle')}
          title={t('panelTitle')}
          lede={templates[0]?.summary}
          stats={[
            { icon: 'spark', value: templates.length, label: t('tabTemplates') },
            { icon: 'at', value: CREATOR_CHINESE_SKILLS.length, label: t('tabSkills') },
            { icon: 'play', value: cliCards.length, label: t('tabCli') },
          ]}
        />
      }
      stageTabs={[
        {
          id: 'templates',
          label: () => t('tabTemplates'),
          render: () =>
            templates.length === 0 ? (
              <EmptyState>{coreT('emptyElements')}</EmptyState>
            ) : (
              <div className="mw-stack" data-gap="lg">
                <div className="kit-cat-bar" role="group" aria-label={t('catFilterLabel')} data-kit-cat-bar="true">
                  {KIT_TEMPLATE_CATEGORIES.map((cat) => {
                    const active = categoryFilter === cat.id
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        className="mw-dsh-btn"
                        data-size="sm"
                        data-variant={active ? 'primary' : 'quiet'}
                        data-category={cat.id}
                        aria-pressed={active}
                        onClick={() => {
                          setCategoryFilter(cat.id)
                          setCopiedReceipt(false)
                        }}
                      >
                        {t(cat.labelKey)}
                      </button>
                    )
                  })}
                </div>
                <div className="mw-grid-auto kt-tpl-grid">
                  {visibleTemplates.map((tpl, idx) => {
                    const selected = activeTemplate?.templateRef === tpl.templateRef
                    return (
                      <button
                        key={tpl.templateRef}
                        type="button"
                        className="mw-dsh-card kt-tpl"
                        data-interactive="true"
                        data-ink={idx === 0 ? 'true' : undefined}
                        data-selected={selected ? 'true' : 'false'}
                        data-category={tpl.category}
                        aria-pressed={selected}
                        onClick={() => {
                          setSelectedTplRef(tpl.templateRef)
                          setSlotValues({})
                          setPreviewOutput('')
                          setCopiedReceipt(false)
                        }}
                      >
                        <span className="mw-card-title">{tpl.title}</span>
                        <span className="mw-dsh-muted mw-clamp-2">{tpl.summary}</span>
                        <span className="mw-chip">{t('slotCount').replace('{n}', String(tpl.slots.length))}</span>
                      </button>
                    )
                  })}
                </div>

                {activeTemplate ? (
                  <form
                    className="mw-dsh-card mw-stack"
                    data-flat="true"
                    onSubmit={(e) => {
                      e.preventDefault()
                      void handleComposeTemplate()
                    }}
                  >
                    <SectionHead
                      title={activeTemplate.title}
                      meta={<span className="mw-dsh-code">{activeTemplate.templateRef}</span>}
                    />
                    <div className="mw-form-grid">
                      {activeTemplate.slots.map((slot) => (
                        <label key={slot.name} className="mw-field">
                          <span>
                            {slot.label}
                            {slot.required ? <span className="mw-dsh-muted"> · {t('required')}</span> : null}
                          </span>
                          {slot.inputType === 'enum' && slot.options ? (
                            <select
                              className="mw-input"
                              aria-label={slot.label}
                              value={slotValues[slot.name] ?? ''}
                              onChange={(e) => setSlotValues((p) => ({ ...p, [slot.name]: e.target.value }))}
                            >
                              <option value="">{t('selectPlaceholder')}</option>
                              {slot.options.map((opt) => (
                                <option key={opt} value={opt}>
                                  {opt}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              className="mw-input"
                              type="text"
                              aria-label={slot.label}
                              value={slotValues[slot.name] ?? ''}
                              onChange={(e) => setSlotValues((p) => ({ ...p, [slot.name]: e.target.value }))}
                            />
                          )}
                        </label>
                      ))}
                    </div>
                    <div className="mw-row" data-gap="sm">
                      <button type="submit" className="mw-dsh-btn" data-variant="primary">
                        <Icon name="spark" />
                        {t('stageTemplateBtn')}
                      </button>
                      <button
                        type="button"
                        className="mw-dsh-btn"
                        data-variant="quiet"
                        data-kit-copy-prompt="true"
                        onClick={() => void handleCopyPrompt()}
                      >
                        <Icon name="copy" />
                        {t('copyPromptBtn')}
                      </button>
                      <button
                        type="button"
                        className="mw-dsh-btn"
                        data-variant="quiet"
                        data-kit-generate-direct="true"
                        onClick={() => void handleDirectGenerate()}
                      >
                        <Icon name="play" />
                        {t('generateDirectBtn')}
                      </button>
                      {copiedReceipt ? (
                        <span className="mw-chip" role="status" data-kit-copied-receipt="true">
                          {t('copiedPromptReceipt')}
                        </span>
                      ) : null}
                    </div>
                    {previewOutput ? (
                      <div className="mw-stack" data-gap="xs">
                        <span className="mw-eyebrow">{t('preview')}</span>
                        <pre className="mw-pre" role="status">
                          {previewOutput}
                        </pre>
                      </div>
                    ) : null}
                  </form>
                ) : null}
              </div>
            ),
        },
        {
          id: 'skills',
          label: () => t('tabSkills'),
          render: () => (
            <div className="mw-stack">
              <p className="mw-dsh-muted">{t('skillsHint')}</p>
              <Masonry min="15rem">
                {CREATOR_CHINESE_SKILLS.map((sk) => (
                  <article key={sk.skillName} className="mw-dsh-card">
                    <div className="mw-spread">
                      <span className="mw-card-title">{sk.zhLabel}</span>
                      <span className="mw-row" data-gap="xs">
                        <IconButton
                          icon="copy"
                          size="sm"
                          label={t('copyCommand')}
                          onClick={() => void navigator.clipboard?.writeText(`/${sk.skillName}`).catch(() => undefined)}
                        />
                        <IconButton
                          icon="at"
                          size="sm"
                          label={t('stageSkill')}
                          onClick={() =>
                            stageItemToFloatingAgent({
                              kind: 'skill',
                              ref: sk.skillName,
                              label: sk.zhLabel,
                              serializedLine: `/${sk.skillName} `,
                            })
                          }
                        />
                      </span>
                    </div>
                    <span className="mw-chip" data-mono="true">
                      /{sk.skillName}
                    </span>
                    <span className="mw-dsh-muted mw-clamp-2">{sk.description}</span>
                  </article>
                ))}
              </Masonry>
            </div>
          ),
        },
        {
          id: 'cli-cards',
          label: () => t('tabCli'),
          render: () => (
            <div className="mw-stack" data-gap="lg">
              <section className="kit-mcp-card mw-dsh-card mw-stack" data-flat="true" data-gap="md" data-kit-mcp-card="true">
                <SectionHead title={t('mcpCardTitle')} meta={t('mcpCardHint')} />
                <div className="mw-stack" data-gap="xs">
                  <span className="mw-eyebrow">{t('cliCookbookTitle')}</span>
                  <ul className="kit-cli-list" data-kit-cli-cookbook="true">
                    {KIT_CLI_COOKBOOK.map((item) => (
                      <li key={item.id} className="mw-spread">
                        <code className="mw-dsh-code">{item.command}</code>
                        <button
                          type="button"
                          className="mw-dsh-btn"
                          data-variant="quiet"
                          data-size="sm"
                          data-kit-copy-cli={item.id}
                          onClick={() => void handleCopyCliCommand(item.id, item.command)}
                        >
                          <Icon name="copy" />
                          {copiedCliId === item.id ? t('copiedCliReceipt') : t('copyCommand')}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="mw-stack" data-gap="xs">
                  <span className="mw-eyebrow">{t('mcpConfigTitle')}</span>
                  <div className="kit-cat-bar" role="tablist" aria-label={t('mcpConfigTitle')} data-kit-mcp-modes="true">
                    {KIT_MCP_MODES.map((mode) => {
                      const active = mcpMode === mode.id
                      return (
                        <button
                          key={mode.id}
                          type="button"
                          role="tab"
                          aria-selected={active}
                          className="mw-dsh-btn"
                          data-size="sm"
                          data-variant={active ? 'primary' : 'quiet'}
                          data-mcp-mode={mode.id}
                          onClick={() => {
                            setMcpMode(mode.id)
                            setCopiedMcpReceipt(false)
                          }}
                        >
                          {t(mode.labelKey)}
                        </button>
                      )
                    })}
                  </div>
                  <pre className="kit-mcp-pre mw-pre" data-kit-mcp-snippet={activeMcpConfig.id}>
                    {activeMcpConfig.snippet}
                  </pre>
                  <div className="mw-row" data-gap="sm">
                    <button
                      type="button"
                      className="mw-dsh-btn"
                      data-variant="quiet"
                      data-size="sm"
                      data-kit-copy-mcp="true"
                      onClick={() => void handleCopyMcpConfig()}
                    >
                      <Icon name="copy" />
                      {t('copyMcpBtn')}
                    </button>
                    {copiedMcpReceipt ? (
                      <span className="mw-chip" role="status" data-kit-mcp-copied="true">
                        {t('copiedMcpReceipt')}
                      </span>
                    ) : null}
                  </div>
                </div>
              </section>
              {cliCards.length === 0 ? (
                <EmptyState>{coreT('emptyElements')}</EmptyState>
              ) : (
                <div className="mw-stack">
                  <p className="mw-dsh-muted">{t('cliHint')}</p>
                  <Masonry min="20rem">
                    {cliCards.map((card) => (
                      <article key={card.operationId} className="mw-dsh-card">
                        <div className="mw-spread">
                          <span className="mw-card-title">{card.title}</span>
                          <span className="mw-row" data-gap="xs">
                            <span className="mw-chip">{card.owner}</span>
                            <button
                              type="button"
                              className="mw-dsh-btn"
                              data-size="sm"
                              onClick={() => void handleRunCliCard(card.operationId)}
                            >
                              <Icon name="play" />
                              {t('runCliBtn')}
                            </button>
                          </span>
                        </div>
                        <span className="mw-dsh-muted">{card.description}</span>
                        <code className="mw-chip" data-mono="true">
                          {card.operationId}
                        </code>
                        {cliOutput[card.operationId] ? (
                          <pre className="mw-pre" role="status" aria-label={t('output')}>
                            {cliOutput[card.operationId]}
                          </pre>
                        ) : null}
                      </article>
                    ))}
                  </Masonry>
                </div>
              )}
            </div>
          ),
        },
      ]}
    />
  )
}

export function KitCompanionPane({
  rpc,
  t,
}: {
  rpc: MuweaveRpcClient
  t: (k: string) => string
  coreT: MuweaveTranslator
}) {
  const [diagStatus, setDiagStatus] = useState<string>('')

  const runQuickDoctor = async () => {
    const res = await rpc.call<{ summary?: Record<string, unknown> }>('cli.run_allowlisted', {
      operationId: 'bundle.doctor',
    })
    setDiagStatus(res.ok ? JSON.stringify(res.data.summary ?? {}, null, 2) : `[${res.error.code}] ${res.error.message}`)
  }

  return (
    <div className="mw-dsh-companion" data-muweave-companion="kit">
      <SectionHead
        title={t('companionTitle')}
        actions={<IconButton icon="play" size="sm" label={`${t('runCliBtn')} · ${t('doctor')}`} onClick={() => void runQuickDoctor()} />}
      />
      {diagStatus ? (
        <pre className="mw-pre" role="status">
          {diagStatus}
        </pre>
      ) : null}
      <ul className="mw-stack" data-gap="xs">
        {CREATOR_CHINESE_SKILLS.map((sk) => (
          <li key={sk.skillName} className="mw-dsh-card" data-flat="true">
            <span className="mw-title">{sk.zhLabel}</span>
            <span className="mw-dsh-muted mw-dsh-code">/{sk.skillName}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function apply(ctx: DshClientContextLike): void {
  const tFn = () => ctx.locale.bind(KIT_LOCALE_NS)
  registerMuweaveCreatorPlugin(ctx, {
    pluginNamespace: KIT_LOCALE_NS,
    dictionaries: { zh, en },
    pane: {
      pluginId: 'muweave-kit',
      panelId: KIT_PANEL_ID,
      order: 45,
      title: () => tFn()('panelTitle'),
      roomTitle: () => tFn()('roomTitle'),
      domains: ['harness'],
      companionId: KIT_COMPANION_ID,
      companionTitle: () => tFn()('companionTitle'),
      icon: KitIcon,
      stageTabs: [],
      renderRightbarCompanion: () => null,
    },
    MainComponent: KitMainPage,
    CompanionComponent: KitCompanionPane,
  })
}
