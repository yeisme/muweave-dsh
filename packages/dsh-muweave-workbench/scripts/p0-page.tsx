import type { ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { THEATER_PANEL_ID, type DshClientContextLike } from '@yeisme/dsh-muweave-core/client'
import { apply } from '../src/client'

const slots = new Map<string, ComponentType>()
const ctx: DshClientContextLike = {
  effect(setup) { setup() },
  slots: {
    inject(_slot, register) { return register() },
    register(options, Component) {
      const key = String(options.name) + ':' + String(options.key ?? options.id)
      slots.set(key, Component)
      return () => { slots.delete(key) }
    },
  },
  // Reproduce a delayed or unavailable DSH locale registry. The plugin owns the fallback.
  locale: { register: () => () => {}, bind: () => (key) => key },
}
apply(ctx)
const Theater = slots.get('main:' + THEATER_PANEL_ID)
if (!Theater) throw new Error('工作台页面未完成注册')
createRoot(document.getElementById('root')!).render(<Theater />)
