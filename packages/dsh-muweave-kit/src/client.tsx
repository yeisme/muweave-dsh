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
  adapterCardTitle: '外部引擎 Bridge 配置',
  adapterCardHint: '接入 OpenAI / ComfyUI / 自定义 CLI 引擎；仅保存环境变量名，严禁填写明文密钥。',
  adapterPresetOpenAiImage: 'OpenAI 出图',
  adapterPresetOpenAiTts: 'OpenAI 配音',
  adapterPresetComfyUi: '本地 ComfyUI',
  adapterEnvReady: '环境变量已就绪',
  adapterEnvMissing: '未检测到环境变量',
  adapterEnvNone: '无需密钥',
  adapterTestBtn: '测试连通',
  adapterRemoveBtn: '删除',
  adapterEnableLabel: '启用',
  adapterSaveBtn: '保存引擎配置',
  adapterFieldId: '适配器 ID',
  adapterFieldTitle: '显示名称',
  adapterFieldProtocol: '协议类型',
  adapterFieldKind: '媒体类型',
  adapterFieldEndpoint: '接口 URL',
  adapterFieldBinary: 'CLI 可执行文件名',
  adapterFieldModel: '模型名称',
  adapterFieldPrice: '预估单价 (USD，可选)',
  adapterFieldAuthEnv: '环境变量名 (如 OPENAI_API_KEY)',
  adapterFieldPrivateNet: '允许局域网私有地址（如 LAN ComfyUI）',
  adapterSecretWarning: '禁止填写明文 API Key（如 sk-* 或 Bearer）；此处只能填环境变量名（如 OPENAI_API_KEY）。',
  adapterEmpty: '尚未注册外部引擎，可点击上方预设一键预填。',
  adapterSavedReceipt: '已保存引擎配置',
  adapterTestOk: '连通正常',
  adapterTestFail: '连通异常',
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
  adapterCardTitle: 'External Engine Bridge',
  adapterCardHint: 'Connect OpenAI / ComfyUI / CLI engines; store env var names only — never paste plaintext keys.',
  adapterPresetOpenAiImage: 'OpenAI Image',
  adapterPresetOpenAiTts: 'OpenAI Voice',
  adapterPresetComfyUi: 'Local ComfyUI',
  adapterEnvReady: 'Env Ready',
  adapterEnvMissing: 'Env Not Set',
  adapterEnvNone: 'No Key Needed',
  adapterTestBtn: 'Test Connection',
  adapterRemoveBtn: 'Remove',
  adapterEnableLabel: 'Enabled',
  adapterSaveBtn: 'Save Engine',
  adapterFieldId: 'Adapter ID',
  adapterFieldTitle: 'Title',
  adapterFieldProtocol: 'Protocol',
  adapterFieldKind: 'Media Kind',
  adapterFieldEndpoint: 'Endpoint URL',
  adapterFieldBinary: 'CLI Binary Name',
  adapterFieldModel: 'Model',
  adapterFieldPrice: 'Unit Price USD (optional)',
  adapterFieldAuthEnv: 'Auth Env Var Name (e.g. OPENAI_API_KEY)',
  adapterFieldPrivateNet: 'Allow private LAN addresses (e.g. LAN ComfyUI)',
  adapterSecretWarning: 'Plaintext keys (sk-* or Bearer) are forbidden; enter an env var name like OPENAI_API_KEY.',
  adapterEmpty: 'No custom engines registered yet. Use a preset above to prefill.',
  adapterSavedReceipt: 'Engine saved',
  adapterTestOk: 'Reachable',
  adapterTestFail: 'Check failed',
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

type CustomAdapterProtocol = 'openai_http' | 'comfyui_http' | 'cli_wrapper'
type CustomAdapterKind = 'image' | 'voice' | 'video' | 'sfx'
type CustomAdapterStage = 'visual' | 'storyboard' | 'sound'

interface CustomAdapterRow {
  adapterId: string
  title: string
  protocol: CustomAdapterProtocol
  kind: CustomAdapterKind
  stage: CustomAdapterStage
  enabled: boolean
  endpointUrl?: string
  binary?: string
  model?: string
  unitPriceUsd?: number
  authEnvVar?: string
  allowPrivateNetwork?: boolean
  envReady?: boolean
}

function stageForAdapterKind(kind: CustomAdapterKind): CustomAdapterStage {
  if (kind === 'voice' || kind === 'sfx') return 'sound'
  if (kind === 'video') return 'storyboard'
  return 'visual'
}

interface CustomAdapterFormState {
  adapterId: string
  title: string
  protocol: CustomAdapterProtocol
  kind: CustomAdapterKind
  endpointUrl: string
  binary: string
  model: string
  unitPriceUsd: string
  authEnvVar: string
  allowPrivateNetwork: boolean
  enabled: boolean
}

const EMPTY_ADAPTER_FORM: CustomAdapterFormState = {
  adapterId: '',
  title: '',
  protocol: 'openai_http',
  kind: 'image',
  endpointUrl: '',
  binary: '',
  model: '',
  unitPriceUsd: '',
  authEnvVar: '',
  allowPrivateNetwork: false,
  enabled: true,
}

const ADAPTER_UI_PRESETS: ReadonlyArray<{
  key: string
  labelKey: string
  form: CustomAdapterFormState
}> = [
  {
    key: 'openai-image',
    labelKey: 'adapterPresetOpenAiImage',
    form: {
      adapterId: 'openai-image',
      title: 'OpenAI 出图',
      protocol: 'openai_http',
      kind: 'image',
      endpointUrl: 'https://api.openai.com/v1/images/generations',
      binary: '',
      model: 'gpt-image-1',
      unitPriceUsd: '0.08',
      authEnvVar: 'OPENAI_API_KEY',
      allowPrivateNetwork: false,
      enabled: true,
    },
  },
  {
    key: 'openai-tts',
    labelKey: 'adapterPresetOpenAiTts',
    form: {
      adapterId: 'openai-tts',
      title: 'OpenAI 配音',
      protocol: 'openai_http',
      kind: 'voice',
      endpointUrl: 'https://api.openai.com/v1/audio/speech',
      binary: '',
      model: 'gpt-4o-mini-tts',
      unitPriceUsd: '0.02',
      authEnvVar: 'OPENAI_API_KEY',
      allowPrivateNetwork: false,
      enabled: true,
    },
  },
  {
    key: 'comfyui-local',
    labelKey: 'adapterPresetComfyUi',
    form: {
      adapterId: 'comfyui-local',
      title: '本地 ComfyUI',
      protocol: 'comfyui_http',
      kind: 'image',
      endpointUrl: 'http://127.0.0.1:8188',
      binary: '',
      model: 'default-workflow',
      unitPriceUsd: '0',
      authEnvVar: '',
      allowPrivateNetwork: true,
      enabled: true,
    },
  },
]

const ENV_VAR_NAME_RE = /^[A-Z_][A-Z0-9_]{1,63}$/

function isUnsafeAuthEnvVar(raw: string): boolean {
  const trimmed = raw.trim()
  if (!trimmed) return false
  if (/^sk-[A-Za-z0-9_-]{8,}/i.test(trimmed) || /\bBearer\s+/i.test(trimmed)) return true
  return !ENV_VAR_NAME_RE.test(trimmed)
}

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
  const [adapters, setAdapters] = useState<CustomAdapterRow[]>([])
  const [adapterForm, setAdapterForm] = useState<CustomAdapterFormState>(EMPTY_ADAPTER_FORM)
  const [adapterNotice, setAdapterNotice] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const [adapterSecretWarning, setAdapterSecretWarning] = useState<string>('')
  const [adapterTestResults, setAdapterTestResults] = useState<Record<string, { ok: boolean; message: string }>>({})
  const [cliCards, setCliCards] = useState<AllowlistedCliCardDefV1[]>([...ALLOWLISTED_CLI_CARDS_BROWSER])
  const [cliOutput, setCliOutput] = useState<Record<string, string>>({})

  const loadAdapters = useCallback(async () => {
    try {
      const res = await rpc.call<{ adapters?: CustomAdapterRow[] }>('adapter.custom.list', {})
      if (res?.ok && Array.isArray(res.data?.adapters)) {
        setAdapters(res.data.adapters)
      }
    } catch {
      // Gracefully tolerate older/mock hosts without adapter.custom.list.
    }
  }, [rpc])

  const loadCatalogs = useCallback(async () => {
    const [tplRes, cliRes] = await Promise.all([
      rpc.call<{ templates: TemplateCatalogEntryV1[] }>('templates.list', {}),
      rpc.call<{ operations: AllowlistedCliCardDefV1[] }>('cli.catalog', {}),
    ])
    if (tplRes.ok && Array.isArray(tplRes.data?.templates) && tplRes.data.templates.length > 0) setTemplates(tplRes.data.templates)
    if (cliRes.ok && Array.isArray(cliRes.data?.operations) && cliRes.data.operations.length > 0) setCliCards(cliRes.data.operations)
    await loadAdapters()
  }, [rpc, loadAdapters])

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

  const handleSaveAdapter = async () => {
    const adapterId = adapterForm.adapterId.trim()
    const title = adapterForm.title.trim() || adapterId
    const authEnvVar = adapterForm.authEnvVar.trim()
    if (isUnsafeAuthEnvVar(authEnvVar)) {
      setAdapterSecretWarning(t('adapterSecretWarning'))
      setAdapterNotice(null)
      return
    }
    setAdapterSecretWarning('')
    if (!adapterId) return
    const parsedPrice = adapterForm.unitPriceUsd.trim() ? Number(adapterForm.unitPriceUsd.trim()) : undefined
    const payload: Record<string, unknown> = {
      adapterId,
      title,
      protocol: adapterForm.protocol,
      kind: adapterForm.kind,
      stage: stageForAdapterKind(adapterForm.kind),
      enabled: adapterForm.enabled,
      ...(adapterForm.protocol === 'cli_wrapper'
        ? { binary: adapterForm.binary.trim() }
        : { endpointUrl: adapterForm.endpointUrl.trim() }),
      ...(adapterForm.model.trim() ? { model: adapterForm.model.trim() } : {}),
      ...(typeof parsedPrice === 'number' && Number.isFinite(parsedPrice) && parsedPrice >= 0
        ? { unitPriceUsd: parsedPrice }
        : {}),
      ...(authEnvVar ? { authEnvVar } : {}),
      ...(adapterForm.allowPrivateNetwork ? { allowPrivateNetwork: true } : {}),
    }
    const res = await rpc.call<{ adapter?: CustomAdapterRow; adapters?: CustomAdapterRow[] }>('adapter.custom.save', payload)
    if (!res?.ok) {
      setAdapterNotice({ tone: 'bad', text: res?.error?.message ?? '保存失败' })
      return
    }
    setAdapterNotice({ tone: 'ok', text: t('adapterSavedReceipt') })
    if (Array.isArray(res.data?.adapters)) {
      setAdapters(res.data.adapters)
    } else {
      await loadAdapters()
    }
  }

  const handleToggleAdapter = async (adapter: CustomAdapterRow) => {
    const res = await rpc.call<{ adapters?: CustomAdapterRow[] }>('adapter.custom.save', {
      adapterId: adapter.adapterId,
      title: adapter.title,
      protocol: adapter.protocol,
      kind: adapter.kind,
      stage: adapter.stage ?? stageForAdapterKind(adapter.kind),
      enabled: !adapter.enabled,
      ...(adapter.endpointUrl ? { endpointUrl: adapter.endpointUrl } : {}),
      ...(adapter.binary ? { binary: adapter.binary } : {}),
      ...(adapter.model ? { model: adapter.model } : {}),
      ...(adapter.unitPriceUsd !== undefined ? { unitPriceUsd: adapter.unitPriceUsd } : {}),
      ...(adapter.authEnvVar ? { authEnvVar: adapter.authEnvVar } : {}),
      ...(adapter.allowPrivateNetwork ? { allowPrivateNetwork: true } : {}),
    })
    if (res?.ok) {
      if (Array.isArray(res.data?.adapters)) setAdapters(res.data.adapters)
      else await loadAdapters()
    }
  }

  const handleTestAdapter = async (adapterId: string) => {
    const res = await rpc.call<{ ok?: boolean; message?: string; reachable?: boolean; detail?: string }>(
      'adapter.custom.test',
      { adapterId },
    )
    if (!res?.ok) {
      setAdapterTestResults((prev) => ({
        ...prev,
        [adapterId]: { ok: false, message: res?.error?.message ?? t('adapterTestFail') },
      }))
      return
    }
    const ok = res.data?.ok ?? res.data?.reachable ?? true
    const message = res.data?.message ?? res.data?.detail ?? (ok ? t('adapterTestOk') : t('adapterTestFail'))
    setAdapterTestResults((prev) => ({ ...prev, [adapterId]: { ok: Boolean(ok), message } }))
  }

  const handleRemoveAdapter = async (adapterId: string) => {
    const res = await rpc.call<{ adapters?: CustomAdapterRow[] }>('adapter.custom.remove', { adapterId })
    if (res?.ok) {
      if (Array.isArray(res.data?.adapters)) setAdapters(res.data.adapters)
      else setAdapters((prev) => prev.filter((item) => item.adapterId !== adapterId))
    }
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
              <section className="kit-adapter-card mw-dsh-card mw-stack" data-flat="true" data-gap="md" data-kit-adapters-card="true">
                <SectionHead title={t('adapterCardTitle')} meta={t('adapterCardHint')} />
                <div className="kit-adapter-presets" data-kit-adapter-presets="true">
                  {ADAPTER_UI_PRESETS.map((preset) => (
                    <button
                      key={preset.key}
                      type="button"
                      className="mw-dsh-btn"
                      data-variant="quiet"
                      data-size="sm"
                      data-adapter-preset={preset.key}
                      onClick={() => {
                        setAdapterForm({ ...preset.form })
                        setAdapterSecretWarning('')
                        setAdapterNotice(null)
                      }}
                    >
                      {t(preset.labelKey)}
                    </button>
                  ))}
                </div>

                {adapters.length === 0 ? (
                  <p className="mw-dsh-muted" data-kit-adapter-empty="true">
                    {t('adapterEmpty')}
                  </p>
                ) : (
                  <ul className="kit-adapter-list" data-kit-adapter-list="true">
                    {adapters.map((adapter) => {
                      const testRes = adapterTestResults[adapter.adapterId]
                      return (
                        <li key={adapter.adapterId} className="kit-adapter-row" data-adapter-row={adapter.adapterId}>
                          <div className="mw-row" data-gap="xs">
                            <span className="mw-title">{adapter.title}</span>
                            <span className="mw-chip" data-mono="true">
                              {adapter.protocol}
                            </span>
                            {adapter.model ? (
                              <span className="mw-chip" data-mono="true">
                                {adapter.model}
                              </span>
                            ) : null}
                            {adapter.authEnvVar ? (
                              <span
                                className="mw-status"
                                data-tone={adapter.envReady ? 'ok' : 'warn'}
                                data-adapter-env-ready={adapter.envReady ? 'true' : 'false'}
                              >
                                <span className="mw-dot" />
                                {adapter.envReady ? t('adapterEnvReady') : t('adapterEnvMissing')}
                              </span>
                            ) : (
                              <span className="mw-status" data-tone="neutral" data-adapter-env-ready="true">
                                <span className="mw-dot" />
                                {t('adapterEnvNone')}
                              </span>
                            )}
                          </div>
                          <div className="mw-row" data-gap="xs">
                            <label className="mw-row" data-gap="xs">
                              <input
                                type="checkbox"
                                checked={adapter.enabled}
                                data-adapter-toggle={adapter.adapterId}
                                onChange={() => void handleToggleAdapter(adapter)}
                              />
                              <span className="mw-dsh-muted">{t('adapterEnableLabel')}</span>
                            </label>
                            <button
                              type="button"
                              className="mw-dsh-btn"
                              data-variant="quiet"
                              data-size="sm"
                              data-adapter-test={adapter.adapterId}
                              onClick={() => void handleTestAdapter(adapter.adapterId)}
                            >
                              {t('adapterTestBtn')}
                            </button>
                            <button
                              type="button"
                              className="mw-dsh-btn"
                              data-variant="ghost"
                              data-size="sm"
                              data-adapter-remove={adapter.adapterId}
                              onClick={() => void handleRemoveAdapter(adapter.adapterId)}
                            >
                              {t('adapterRemoveBtn')}
                            </button>
                          </div>
                          {testRes ? (
                            <span
                              className="mw-status"
                              role="status"
                              data-tone={testRes.ok ? 'ok' : 'bad'}
                              data-adapter-test-result={adapter.adapterId}
                            >
                              <span className="mw-dot" />
                              {testRes.message}
                            </span>
                          ) : null}
                        </li>
                      )
                    })}
                  </ul>
                )}

                <form
                  className="kit-adapter-form"
                  data-kit-adapter-form="true"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void handleSaveAdapter()
                  }}
                >
                  <label className="mw-field">
                    <span>{t('adapterFieldId')}</span>
                    <input
                      className="mw-input"
                      type="text"
                      data-adapter-field="id"
                      value={adapterForm.adapterId}
                      onChange={(e) => setAdapterForm((prev) => ({ ...prev, adapterId: e.target.value }))}
                    />
                  </label>
                  <label className="mw-field">
                    <span>{t('adapterFieldTitle')}</span>
                    <input
                      className="mw-input"
                      type="text"
                      data-adapter-field="title"
                      value={adapterForm.title}
                      onChange={(e) => setAdapterForm((prev) => ({ ...prev, title: e.target.value }))}
                    />
                  </label>
                  <label className="mw-field">
                    <span>{t('adapterFieldProtocol')}</span>
                    <select
                      className="mw-input"
                      data-adapter-field="protocol"
                      value={adapterForm.protocol}
                      onChange={(e) =>
                        setAdapterForm((prev) => ({ ...prev, protocol: e.target.value as CustomAdapterProtocol }))
                      }
                    >
                      <option value="openai_http">openai_http</option>
                      <option value="comfyui_http">comfyui_http</option>
                      <option value="cli_wrapper">cli_wrapper</option>
                    </select>
                  </label>
                  <label className="mw-field">
                    <span>{t('adapterFieldKind')}</span>
                    <select
                      className="mw-input"
                      data-adapter-field="kind"
                      value={adapterForm.kind}
                      onChange={(e) => setAdapterForm((prev) => ({ ...prev, kind: e.target.value as CustomAdapterKind }))}
                    >
                      <option value="image">image</option>
                      <option value="voice">voice</option>
                      <option value="video">video</option>
                      <option value="sfx">sfx</option>
                    </select>
                  </label>
                  {adapterForm.protocol === 'cli_wrapper' ? (
                    <label className="mw-field">
                      <span>{t('adapterFieldBinary')}</span>
                      <input
                        className="mw-input"
                        type="text"
                        data-adapter-field="binary"
                        value={adapterForm.binary}
                        onChange={(e) => setAdapterForm((prev) => ({ ...prev, binary: e.target.value }))}
                      />
                    </label>
                  ) : (
                    <label className="mw-field">
                      <span>{t('adapterFieldEndpoint')}</span>
                      <input
                        className="mw-input"
                        type="text"
                        data-adapter-field="endpoint"
                        value={adapterForm.endpointUrl}
                        onChange={(e) => setAdapterForm((prev) => ({ ...prev, endpointUrl: e.target.value }))}
                      />
                    </label>
                  )}
                  <label className="mw-field">
                    <span>{t('adapterFieldModel')}</span>
                    <input
                      className="mw-input"
                      type="text"
                      data-adapter-field="model"
                      value={adapterForm.model}
                      onChange={(e) => setAdapterForm((prev) => ({ ...prev, model: e.target.value }))}
                    />
                  </label>
                  <label className="mw-field">
                    <span>{t('adapterFieldPrice')}</span>
                    <input
                      className="mw-input"
                      type="text"
                      data-adapter-field="unitPriceUsd"
                      value={adapterForm.unitPriceUsd}
                      onChange={(e) => setAdapterForm((prev) => ({ ...prev, unitPriceUsd: e.target.value }))}
                    />
                  </label>
                  <label className="mw-field">
                    <span>{t('adapterFieldAuthEnv')}</span>
                    <input
                      className="mw-input"
                      type="text"
                      data-adapter-field="authEnvVar"
                      placeholder="OPENAI_API_KEY"
                      value={adapterForm.authEnvVar}
                      onChange={(e) => {
                        const nextVal = e.target.value
                        setAdapterForm((prev) => ({ ...prev, authEnvVar: nextVal }))
                        if (isUnsafeAuthEnvVar(nextVal)) setAdapterSecretWarning(t('adapterSecretWarning'))
                        else setAdapterSecretWarning('')
                      }}
                    />
                  </label>
                  <label className="mw-row" data-gap="xs">
                    <input
                      type="checkbox"
                      data-adapter-field="allowPrivateNetwork"
                      checked={adapterForm.allowPrivateNetwork}
                      onChange={(e) => setAdapterForm((prev) => ({ ...prev, allowPrivateNetwork: e.target.checked }))}
                    />
                    <span className="mw-dsh-muted">{t('adapterFieldPrivateNet')}</span>
                  </label>
                  <div className="mw-row" data-gap="sm">
                    <button type="submit" className="mw-dsh-btn" data-variant="primary" data-size="sm" data-adapter-save="true">
                      {t('adapterSaveBtn')}
                    </button>
                    {adapterNotice ? (
                      <span className="mw-status" role="status" data-tone={adapterNotice.tone} data-adapter-notice="true">
                        <span className="mw-dot" />
                        {adapterNotice.text}
                      </span>
                    ) : null}
                  </div>
                  {adapterSecretWarning ? (
                    <div className="mw-dsh-notice" data-tone="bad" role="alert" data-adapter-secret-warning="true">
                      <span className="mw-dot" />
                      <span>{adapterSecretWarning}</span>
                    </div>
                  ) : null}
                </form>
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
