import { describe, expect, it } from 'vitest'
import { formatKeyHint } from '../packages/dsh-muweave-core/src/client/keymap'

describe('formatKeyHint', () => {
  it('uses the Mac command symbol for mod bindings', () => {
    expect(formatKeyHint('mod+k', 'mac')).toBe('⌘K')
  })

  it('uses Ctrl for non-Mac mod bindings', () => {
    expect(formatKeyHint('mod+k', 'other')).toBe('Ctrl+K')
  })

  it('formats shift and alt modifiers for both platforms', () => {
    expect(formatKeyHint('shift+alt+k', 'mac')).toBe('⇧⌥K')
    expect(formatKeyHint('shift+alt+k', 'other')).toBe('Shift+Alt+K')
  })
})
