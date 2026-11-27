/**
 * Global keyboard shortcuts help modal (`?` or topbar button).
 * Zero inline styles; uses `--mw-*` tokens via `.mw-shortcuts-modal` / `.mw-shortcuts-grid`.
 */

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { MuweaveDictKey, MuweaveTranslator } from './i18n'
import { Icon } from './ui'

export interface ShortcutsHelpModalProps {
  open: boolean
  onClose: () => void
  t: MuweaveTranslator | ((key: string) => string)
}

interface ShortcutRow {
  keys: readonly string[]
  descZh: string
  descEn: string
}

interface ShortcutGroup {
  id: string
  titleZh: string
  titleEn: string
  rows: readonly ShortcutRow[]
}

const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    id: 'global',
    titleZh: '全局与剧场',
    titleEn: 'Global & Theater',
    rows: [
      { keys: ['⌘K', 'Ctrl+K'], descZh: '打开命令面板', descEn: 'Open command palette' },
      { keys: ['Alt+1…7'], descZh: '快速切换剧场房间', descEn: 'Switch theater room' },
      { keys: ['?'], descZh: '打开 / 关闭快捷键总览', descEn: 'Toggle shortcuts help' },
      { keys: ['Esc'], descZh: '关闭弹窗或检查器', descEn: 'Close dialog or inspector' },
    ],
  },
  {
    id: 'workbench',
    titleZh: '总览工作台',
    titleEn: 'Workbench',
    rows: [
      { keys: ['C'], descZh: '设为对比基线', descEn: 'Pin to compare baseline' },
      { keys: ['S'], descZh: '同步 .muweave/ 工作区', descEn: 'Sync .muweave/ bundle' },
      { keys: ['G'], descZh: '打开生成台', descEn: 'Open generation desk' },
    ],
  },
  {
    id: 'drama',
    titleZh: '分镜生产与预演',
    titleEn: 'Drama & Animatic',
    rows: [
      { keys: ['←', 'k'], descZh: '上一镜（检查器 / 预演）', descEn: 'Previous shot (inspector / animatic)' },
      { keys: ['→', 'j'], descZh: '下一镜（检查器 / 预演）', descEn: 'Next shot (inspector / animatic)' },
      { keys: ['Space'], descZh: 'Animatic 播放 / 暂停', descEn: 'Animatic play / pause' },
      { keys: ['a'], descZh: '快速标为已通过', descEn: 'Quick mark approved' },
      { keys: ['r'], descZh: '快速标为需修改', descEn: 'Quick mark needs revision' },
    ],
  },
  {
    id: 'schedule',
    titleZh: '排期日历',
    titleEn: 'Schedule',
    rows: [
      { keys: ['['], descZh: '切换到上一月', descEn: 'Previous month' },
      { keys: [']'], descZh: '切换到下一月', descEn: 'Next month' },
      { keys: ['t'], descZh: '回到今天', descEn: 'Jump to today' },
    ],
  },
]

function isEnglish(t: ShortcutsHelpModalProps['t']): boolean {
  try {
    return t('langCode' as MuweaveDictKey) === 'en'
  } catch {
    return false
  }
}

export function ShortcutsHelpModal({ open, onClose, t }: ShortcutsHelpModalProps) {
  const closeBtnRef = useRef<HTMLButtonElement | null>(null)
  const restoreRef = useRef<Element | null>(null)
  const isEn = isEnglish(t)

  useEffect(() => {
    if (!open) return undefined
    restoreRef.current = typeof document === 'undefined' ? null : document.activeElement
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => closeBtnRef.current?.focus()) : 0
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault()
        ev.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      if (typeof cancelAnimationFrame === 'function' && raf) cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKey, true)
      const prev = restoreRef.current
      if (prev instanceof HTMLElement && prev.isConnected) prev.focus()
    }
  }, [open, onClose])

  if (!open) return null

  const title = isEn ? 'Keyboard Shortcuts' : '键盘快捷键总览'
  const closeLabel = isEn ? 'Close shortcuts help' : '关闭快捷键总览'

  const modal = (
    <div className="mw-dsh-root mw-shortcuts-modal" role="presentation">
      <div className="mw-shortcuts-scrim" role="presentation" onClick={onClose} />
      <div
        className="mw-shortcuts-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-muweave-shortcuts-modal="true"
      >
        <div className="mw-spread">
          <h2 className="mw-dsh-title">{title}</h2>
          <button
            ref={closeBtnRef}
            type="button"
            className="mw-dsh-btn"
            data-icon="true"
            data-variant="ghost"
            data-size="sm"
            aria-label={closeLabel}
            title={closeLabel}
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </div>
        <div className="mw-shortcuts-grid">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.id} className="mw-shortcuts-group" data-shortcuts-group={group.id}>
              <h3 className="mw-eyebrow">{isEn ? group.titleEn : group.titleZh}</h3>
              <dl className="mw-shortcuts-list">
                {group.rows.map((row) => (
                  <div key={row.keys.join('+')} className="mw-shortcuts-row">
                    <dt className="mw-shortcuts-keys">
                      {row.keys.map((k) => (
                        <kbd key={k}>{k}</kbd>
                      ))}
                    </dt>
                    <dd>{isEn ? row.descEn : row.descZh}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  )

  return typeof document !== 'undefined' && document.body ? createPortal(modal, document.body) : modal
}
