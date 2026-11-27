import type { CapabilityDescriptorV1 } from '../capability-protocol'
import { BLOCKED_ADAPTERS } from './blocked'
import { eikonaImageGenerate } from './eikona'
import { LOCAL_PREVIEW_ADAPTER } from './preview-adapter'
import { sonoraSfxGenerate } from './sonora'
import type { AdapterContext, CapabilityAdapter } from './types'

export const CAPABILITY_ADAPTERS: readonly CapabilityAdapter[] = [eikonaImageGenerate, sonoraSfxGenerate, ...BLOCKED_ADAPTERS]

function localPreviewEnabled(): boolean {
  return process.env.MUWEAVE_LOCAL_PREVIEW_ADAPTER === '1'
}

export function findAdapter(capabilityId: string): CapabilityAdapter | undefined {
  if (capabilityId === LOCAL_PREVIEW_ADAPTER.descriptor.capabilityId && localPreviewEnabled()) {
    return LOCAL_PREVIEW_ADAPTER
  }
  return CAPABILITY_ADAPTERS.find((a) => a.descriptor.capabilityId === capabilityId)
}

/** Binary probe results live for the process: `<bin> --version` through the injected runner, never a shell. */
export class CapabilityRegistry {
  private readonly probes = new Map<string, Promise<boolean>>()

  constructor(private readonly adapters: readonly CapabilityAdapter[] = CAPABILITY_ADAPTERS) {}

  private activeAdapters(): readonly CapabilityAdapter[] {
    if (
      localPreviewEnabled() &&
      !this.adapters.some((a) => a.descriptor.capabilityId === LOCAL_PREVIEW_ADAPTER.descriptor.capabilityId)
    ) {
      return [...this.adapters, LOCAL_PREVIEW_ADAPTER]
    }
    return this.adapters
  }

  find(capabilityId: string): CapabilityAdapter | undefined {
    return this.activeAdapters().find((a) => a.descriptor.capabilityId === capabilityId)
  }

  private probe(ctx: AdapterContext, binary: string): Promise<boolean> {
    if (binary === 'builtin') return Promise.resolve(true)
    let hit = this.probes.get(binary)
    if (!hit) {
      hit = ctx.runner(binary, ['--version'], { cwd: ctx.cwd, timeoutMs: 8_000 }).then((r) => r.exitCode === 0, () => false)
      this.probes.set(binary, hit)
    }
    return hit
  }

  async describe(ctx: AdapterContext, adapter: CapabilityAdapter): Promise<CapabilityDescriptorV1> {
    const installed = await this.probe(ctx, adapter.binary)
    const reason = !installed ? 'OWNER_NOT_INSTALLED' : adapter.blockedReason
    return {
      ...adapter.descriptor,
      available: reason === undefined,
      ...(reason ? { unavailableReason: reason } : {}),
    }
  }

  async catalog(ctx: AdapterContext): Promise<CapabilityDescriptorV1[]> {
    return Promise.all(this.activeAdapters().map((a) => this.describe(ctx, a)))
  }
}
