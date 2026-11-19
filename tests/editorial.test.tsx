import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  CoverCollage,
  MediaCard,
  RoomHero,
  RoomNav,
  createFallbackTranslator,
  forgetProjectCovers,
  useProjectCovers,
  type MuweaveRpcClient,
  type TheaterRoom,
} from '@yeisme/dsh-muweave-core/client'

// Editorial v2 (docs/design/editorial-v2.md): hero, covers, pill room nav and real-image covers.

const t = createFallbackTranslator('zh')

afterEach(() => cleanup())

function fakeRoom(id: string, title: string): TheaterRoom {
  return { id, title: () => title, description: () => `${title} 说明` } as unknown as TheaterRoom
}

/** Minimal rpc stub: one candidate group with two digests; counts list calls for the cache check. */
function fakeRpc(withPixels = true) {
  const counts = { list: 0, get: 0, media: 0 }
  const rpc = {
    async call(action: string) {
      if (action === 'bundle.elements.list') {
        counts.list += 1
        return { ok: true, data: { elements: [{ elementId: 'g1', title: '林雾定妆' }] } }
      }
      counts.get += 1
      const candidates = withPixels
        ? [
            { artifactId: 'art_front', sha256: 'sha256:aaa' },
            { artifactId: 'art_side', sha256: 'sha256:bbb' },
          ]
        : [{ artifactId: 'art_front' }]
      return { ok: true, data: { element: { payload: { candidates } } } }
    },
    async resolveMediaUrl(sha: string) {
      counts.media += 1
      return `/media/${sha.slice(-3)}.png`
    },
  }
  return { rpc: rpc as unknown as MuweaveRpcClient, counts }
}

function CoverProbe({ rpc }: { rpc: MuweaveRpcClient }) {
  const covers = useProjectCovers(rpc, 3)
  return <CoverCollage covers={covers} posterTitle="第一集" posterMeta="Eikona" />
}

describe('editorial v2 primitives', () => {
  it('renders a hero with a serif title, stats and a typographic poster when there are no images', () => {
    render(
      <RoomHero
        eyebrow="Scaena"
        title="第一集 分镜"
        stats={[{ icon: 'image', value: 12, label: '镜' }]}
        cover={<CoverCollage covers={[]} posterTitle="第一集" posterMeta="Scaena" />}
      />,
    )
    expect(screen.getByRole('heading', { level: 2, name: '第一集 分镜' })).toBeTruthy()
    expect(screen.getByText('12')).toBeTruthy()
    const cover = document.querySelector('[data-muweave-cover]')
    expect(cover?.getAttribute('data-muweave-cover')).toBe('poster')
    expect(cover?.getAttribute('aria-hidden')).toBe('true')
    expect(document.querySelectorAll('.mw-collage img')).toHaveLength(0)
  })

  it('shows at most three real covers with their artifact ids as alt text', () => {
    const covers = ['a', 'b', 'c', 'd'].map((x) => ({ sha256: x, alt: `art_${x}`, url: `/m/${x}.png` }))
    render(<CoverCollage covers={covers} posterTitle="unused" />)
    const imgs = [...document.querySelectorAll('.mw-collage img')]
    expect(imgs.map((i) => i.getAttribute('alt'))).toEqual(['art_a', 'art_b', 'art_c'])
    expect(document.querySelector('[data-muweave-cover]')?.getAttribute('data-count')).toBe('3')
  })

  it('media card keeps its ratio as a custom property and forwards data attributes', () => {
    render(<MediaCard media={<span>pic</span>} title="01 · 3.5 秒" ratio="16 / 10" data-probe="x" />)
    const card = document.querySelector('[data-probe="x"]') as HTMLElement
    expect(card.style.getPropertyValue('--mw-media-ratio')).toBe('16 / 10')
    expect(screen.getByRole('heading', { name: '01 · 3.5 秒' })).toBeTruthy()
  })
})

describe('pill room nav', () => {
  it('marks only the current room with aria-current="page" and switches on click', () => {
    const picked: string[] = []
    const rooms = [fakeRoom('r1', '总览'), fakeRoom('r2', '视觉')]
    const { rerender } = render(<RoomNav t={t} rooms={rooms} activeId="r1" onSelect={(id) => picked.push(id)} />)
    const nav = screen.getByRole('navigation', { name: '剧场房间' })
    const current = nav.querySelectorAll('[aria-current="page"]')
    expect(current).toHaveLength(1)
    expect(current[0]?.getAttribute('data-room-id')).toBe('r1')
    fireEvent.click(screen.getByRole('button', { name: '视觉' }))
    expect(picked).toEqual(['r2'])
    rerender(<RoomNav t={t} rooms={rooms} activeId="r2" onSelect={() => undefined} />)
    expect(nav.querySelector('[aria-current="page"]')?.getAttribute('data-room-id')).toBe('r2')
    expect(screen.getByRole('button', { name: '视觉' }).getAttribute('title')).toContain('Alt+2')
  })
})

describe('useProjectCovers', () => {
  it('resolves real candidate images and reads the digests only once per rpc client', async () => {
    const { rpc, counts } = fakeRpc()
    forgetProjectCovers(rpc)
    const first = render(<CoverProbe rpc={rpc} />)
    await waitFor(() => expect(document.querySelectorAll('.mw-collage img')).toHaveLength(2))
    expect(document.querySelector('[data-muweave-cover]')?.getAttribute('data-muweave-cover')).toBe('images')
    first.unmount()
    render(<CoverProbe rpc={rpc} />)
    await waitFor(() => expect(document.querySelectorAll('.mw-collage img')).toHaveLength(2))
    expect(counts.list).toBe(1)
    expect(counts.get).toBe(1)
    // URLs expire, so every mount re-resolves them.
    expect(counts.media).toBe(4)
  })

  it('falls back to the poster when no candidate has pixels', async () => {
    const { rpc } = fakeRpc(false)
    forgetProjectCovers(rpc)
    render(<CoverProbe rpc={rpc} />)
    await waitFor(() =>
      expect(document.querySelector('[data-muweave-cover]')?.getAttribute('data-muweave-cover')).toBe('poster'),
    )
  })
})
