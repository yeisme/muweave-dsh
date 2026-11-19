import { statusLabel, statusTone } from './i18n'
import { Icon, type MuweaveIconName } from './ui'

export const COMPOSER_DICT_ZH = {
  image: '出图',
  voice: '配音',
  schedule: '排期',
  sync: '同步 .muweave/',
  palette: '命令面板',
  keymap: '快捷键帮助',
  mention: '@ 引用',
  skill: '/ 技能',
  actions: '创作动作',
  needVisual: '先 @ 一个视觉元件、场次或镜头',
  needScene: '先 @ 一个场次',
  needElement: '先 @ 一个元件',
  unavailable: '当前工作台未提供此动作',
  busy: '当前动作正在运行',
  cancel: '取消等待',
  cancelled: '已停止等待，宿主可能仍在同步',
  running: '正在运行',
  failed: '动作失败',
  opened: '已打开',
  openedGeneration: '已打开生成台',
  openedSchedule: '已打开排期房间',
  syncResult: '已同步 {count} 个元件 · 修订 {revision}',
  remove: '移除 {label}',
  chipSelected: '已选中 {label}',
  filePending: '文件暂存于输入区',
  fileSize: '{size} 字节',
  noCandidates: '没有匹配的候选',
  candidateLoading: '正在查找候选',
  candidateError: '无法加载候选',
  inserting: '正在插入引用',
  insertError: '无法插入引用',
  useReference: '打开元件候选',
  useSkill: '打开技能与模板候选',
  sendKey: '发送',
  newlineKey: '换行',
  moveKey: '选择候选',
  pickKey: '插入候选',
  deleteKey: '删除相邻或选中的 chip',
  escapeKey: '关闭候选、退出 chip 或收起浮窗',
}

export const COMPOSER_DICT_EN = {
  image: 'Generate image',
  voice: 'Voiceover',
  schedule: 'Schedule',
  sync: 'Sync .muweave/',
  palette: 'Command palette',
  keymap: 'Keyboard shortcuts',
  mention: '@ Reference',
  skill: '/ Skills',
  actions: 'Creator actions',
  needVisual: 'Reference a visual element, scene, or shot with @ first',
  needScene: 'Reference a scene with @ first',
  needElement: 'Reference an element with @ first',
  unavailable: 'This action is unavailable in the current workspace',
  busy: 'An action is already running',
  cancel: 'Stop waiting',
  cancelled: 'Stopped waiting. The host may still be syncing.',
  running: 'Running',
  failed: 'Action failed',
  opened: 'Opened',
  openedGeneration: 'Opened the generation desk',
  openedSchedule: 'Opened the scheduling room',
  syncResult: 'Synced {count} elements · Revision {revision}',
  remove: 'Remove {label}',
  chipSelected: 'Selected {label}',
  filePending: 'File staged in the composer',
  fileSize: '{size} bytes',
  noCandidates: 'No matching suggestions',
  candidateLoading: 'Looking up suggestions',
  candidateError: 'Could not load suggestions',
  inserting: 'Inserting reference',
  insertError: 'Could not insert the reference',
  useReference: 'Open element suggestions',
  useSkill: 'Open skill and template suggestions',
  sendKey: 'Send',
  newlineKey: 'New line',
  moveKey: 'Move through suggestions',
  pickKey: 'Insert suggestion',
  deleteKey: 'Delete the adjacent or selected chip',
  escapeKey: 'Dismiss suggestions, deselect the chip, or collapse the composer',
} satisfies Record<keyof typeof COMPOSER_DICT_ZH, string>

export type ComposerDictionary = typeof COMPOSER_DICT_ZH

interface ChipProps {
  label: string
  copy: ComposerDictionary
  lang: 'zh' | 'en'
  status?: string
  statusText?: string
  selected?: boolean
  onRemove: () => void
}

function Chip({
  kind, label, copy, lang, status, statusText, selected, onRemove, icon, detail,
}: ChipProps & { kind: string; icon: MuweaveIconName; detail?: string }) {
  const name = copy.remove.replace('{label}', () => label)
  const state = statusText ?? (status ? statusLabel(status, lang) : undefined)
  return (
    <span className="mw-chip" data-composer-chip={kind} data-staged-chip={kind} data-selected={selected || undefined} title={label}>
      <Icon name={icon} />
      <span data-composer-chip-title="true">{label}</span>
      {detail ? <span data-composer-chip-detail="true">{detail}</span> : null}
      {state ? (
        <span className="mw-dot" data-tone={statusTone(status)} role="img" aria-label={state} title={state} />
      ) : null}
      <button
        type="button"
        className="mw-dsh-btn"
        data-variant="ghost"
        data-size="sm"
        data-icon="true"
        data-composer-chip-remove="true"
        aria-label={name}
        title={name}
        onClick={onRemove}
      >
        <Icon name="close" />
      </button>
    </span>
  )
}

export function ElementChip(props: ChipProps) {
  return <Chip {...props} label={'@' + props.label} kind="element" icon="at" />
}

export function SkillChip({ template, ...props }: ChipProps & { template?: boolean }) {
  return <Chip {...props} kind={template ? 'template' : 'skill'} icon={template ? 'copy' : 'command'} />
}

export function FileChip({ size, image, ...props }: ChipProps & { size: number; image?: boolean }) {
  return (
    <Chip
      {...props}
      kind="file"
      icon={image ? 'image' : 'link'}
      detail={props.copy.fileSize.replace('{size}', new Intl.NumberFormat(props.lang).format(size))}
    />
  )
}

export function GenerateChip({ icon = 'spark', ...props }: ChipProps & { icon?: MuweaveIconName }) {
  return <Chip {...props} kind="generate" icon={icon} />
}
