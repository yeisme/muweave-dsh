import { useCallback, useEffect, useState } from 'react'
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
}

export function KitIcon({ size = 16, active = false }: { size?: number; active?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" data-active={active ? 'true' : 'false'}>
      <path d="M3 4.5l3 3-3 3M7.5 11.5h5.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
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
  const [selectedTplRef, setSelectedTplRef] = useState<string>(BUILTIN_CREATOR_TEMPLATES[0]?.templateRef ?? '')
  const [slotValues, setSlotValues] = useState<Record<string, string>>({})
  const [previewOutput, setPreviewOutput] = useState<string>('')
  const [cliCards, setCliCards] = useState<AllowlistedCliCardDefV1[]>([...ALLOWLISTED_CLI_CARDS_BROWSER])
  const [cliOutput, setCliOutput] = useState<Record<string, string>>({})

  const loadCatalogs = useCallback(async () => {
    const [tplRes, cliRes] = await Promise.all([
      rpc.call<{ templates: TemplateCatalogEntryV1[] }>('templates.list', {}),
      rpc.call<{ operations: AllowlistedCliCardDefV1[] }>('cli.catalog', {}),
    ])
    if (tplRes.ok && tplRes.data.templates.length > 0) setTemplates(tplRes.data.templates)
    if (cliRes.ok && cliRes.data.operations.length > 0) setCliCards(cliRes.data.operations)
  }, [rpc])

  useEffect(() => {
    void loadCatalogs()
  }, [loadCatalogs])

  const activeTemplate = templates.find((item) => item.templateRef === selectedTplRef) ?? templates[0]

  const handleComposeTemplate = async () => {
    if (!activeTemplate) return
    const res = await rpc.call<{ structuredInstruction: string; templateRef: string }>('templates.render_preview', {
      templateRef: activeTemplate.templateRef,
      values: slotValues,
    })
    if (!res.ok) {
      setPreviewOutput(`✕ ${res.error.message}`)
      return
    }
    setPreviewOutput(res.data.structuredInstruction)
    stageItemToFloatingAgent({
      kind: 'template',
      ref: activeTemplate.templateRef,
      label: activeTemplate.title,
      serializedLine: res.data.structuredInstruction,
    })
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
                <div className="mw-grid-auto kt-tpl-grid">
                  {templates.map((tpl, idx) => {
                    const selected = activeTemplate?.templateRef === tpl.templateRef
                    return (
                      <button
                        key={tpl.templateRef}
                        type="button"
                        className="mw-dsh-card kt-tpl"
                        data-interactive="true"
                        data-ink={idx === 0 ? 'true' : undefined}
                        data-selected={selected ? 'true' : 'false'}
                        aria-pressed={selected}
                        onClick={() => {
                          setSelectedTplRef(tpl.templateRef)
                          setSlotValues({})
                          setPreviewOutput('')
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
                    <div className="mw-row">
                      <button type="submit" className="mw-dsh-btn" data-variant="primary">
                        <Icon name="spark" />
                        {t('stageTemplateBtn')}
                      </button>
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
          render: () =>
            cliCards.length === 0 ? (
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
