/**
 * Built-in Module Manager page (`muweave-modules`): role presets, pin/unpin, reorder,
 * and live header bar preview strip.
 */

import type { TheaterRoomGroup } from '../../protocol'
import type { MuweaveTranslator } from '../i18n'
import type { MuweaveRpcClient } from '../rpc-client'
import { EmptyState, SectionHead } from '../ui'
import {
  MODULE_PRESETS,
  applyModulePreset,
  groupHeaderRooms,
  inferTheaterRoomGroup,
  moveModuleOrder,
  resetModuleLayout,
  resolveVisibleHeaderRooms,
  togglePinModule,
  useModuleLayoutState,
} from './module-manager'
import { setActiveTheaterRoom, type TheaterRoom } from './registry'

function groupLabel(group: TheaterRoomGroup, t: MuweaveTranslator): string {
  if (group === 'studio') return t('modulesGroupStudio')
  if (group === 'ops') return t('modulesGroupOps')
  return t('modulesGroupPipeline')
}

export function ModuleManagerPage({
  t,
  rooms,
  rpc,
}: {
  t: MuweaveTranslator
  rooms: readonly TheaterRoom[]
  rpc?: MuweaveRpcClient
}) {
  const layout = useModuleLayoutState()
  const isEn = t('langCode') === 'en'
  const visible = resolveVisibleHeaderRooms(rooms, layout, null)
  const visibleGroups = groupHeaderRooms(visible)
  const visibleIndexMap = new Map(visible.map((r, i) => [r.id, i]))
  const pinnedSet = new Set(layout.pinnedRoomIds.length === 0 ? rooms.map((r) => r.id) : layout.pinnedRoomIds)

  const allGrouped = groupHeaderRooms(
    resolveVisibleHeaderRooms(rooms, { ...layout, pinnedRoomIds: [] }, null),
  )

  return (
    <section className="mw-mod-page" data-muweave-module-manager="true" aria-label={t('modulesTitle')}>
      <header className="mw-mod-head">
        <div className="mw-stack" data-gap="xs">
          <h2 className="mw-dsh-title">{t('modulesTitle')}</h2>
          <p className="mw-dsh-muted">{t('modulesSubtitle')}</p>
        </div>
        <button
          type="button"
          className="mw-dsh-btn"
          data-variant="quiet"
          data-size="sm"
          data-module-reset="true"
          onClick={() => resetModuleLayout(rpc)}
        >
          {t('modulesReset')}
        </button>
      </header>

      <div className="mw-stack" data-gap="xs">
        <span className="mw-eyebrow">{t('modulesPresetsLabel')}</span>
        <div className="mw-mod-presets" role="group" aria-label={t('modulesPresetsLabel')}>
          {MODULE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="mw-dsh-btn"
              data-variant="quiet"
              data-size="sm"
              data-module-preset={preset.id}
              aria-pressed={layout.preset === preset.id}
              onClick={() => applyModulePreset(preset.id, rooms, rpc)}
            >
              {isEn ? preset.labelEn : preset.labelZh}
            </button>
          ))}
        </div>
      </div>

      <div className="mw-stack" data-gap="xs">
        <span className="mw-eyebrow">{t('modulesPreviewLabel')}</span>
        <div className="mw-mod-preview" data-module-preview="true">
          {visibleGroups.map((grp, gi) => (
            <span key={grp.group} className="mw-row" data-gap="xs">
              {gi > 0 ? <span className="mw-room-nav-sep" aria-hidden="true" /> : null}
              {grp.rooms.map((room) => (
                <span key={room.id} className="mw-chip">
                  {room.title()}
                </span>
              ))}
            </span>
          ))}
        </div>
      </div>

      {rooms.length === 0 ? (
        <EmptyState>{t('theaterNoRooms')}</EmptyState>
      ) : (
        <div className="mw-mod-groups">
          {allGrouped.map((grp) => (
            <section key={grp.group} className="mw-mod-group" data-module-group={grp.group}>
              <SectionHead title={groupLabel(grp.group, t)} meta={String(grp.rooms.length)} />
              <div className="mw-mod-grid">
                {grp.rooms.map((room) => {
                  const RoomIcon = room.icon
                  const isPinned = pinnedSet.has(room.id)
                  const visIdx = visibleIndexMap.get(room.id)
                  const roomGroup = room.group ?? inferTheaterRoomGroup(room.id)
                  return (
                    <article
                      key={room.id}
                      className="mw-mod-card"
                      data-module-card={room.id}
                      data-pinned={isPinned ? 'true' : 'false'}
                    >
                      <div className="mw-spread">
                        <span className="mw-row" data-gap="xs">
                          <RoomIcon size={16} active={isPinned} />
                          <span className="mw-title">{room.title()}</span>
                        </span>
                        <span className="mw-row" data-gap="xs">
                          <span className="mw-chip">{groupLabel(roomGroup, t)}</span>
                          {visIdx !== undefined && visIdx < 9 ? (
                            <kbd className="mw-kbd">{`Alt+${visIdx + 1}`}</kbd>
                          ) : null}
                        </span>
                      </div>
                      <p className="mw-dsh-muted mw-clamp-2">{room.description()}</p>
                      <div className="mw-mod-card-actions">
                        <button
                          type="button"
                          className="mw-dsh-btn"
                          data-variant="quiet"
                          data-size="sm"
                          data-module-pin={room.id}
                          aria-pressed={isPinned}
                          onClick={() => togglePinModule(room.id, rooms, rpc)}
                        >
                          {isPinned ? t('modulesUnpin') : t('modulesPin')}
                        </button>
                        <button
                          type="button"
                          className="mw-dsh-btn"
                          data-variant="ghost"
                          data-size="sm"
                          data-module-up={room.id}
                          onClick={() => moveModuleOrder(room.id, -1, rooms, rpc)}
                        >
                          {t('modulesMoveUp')}
                        </button>
                        <button
                          type="button"
                          className="mw-dsh-btn"
                          data-variant="ghost"
                          data-size="sm"
                          data-module-down={room.id}
                          onClick={() => moveModuleOrder(room.id, 1, rooms, rpc)}
                        >
                          {t('modulesMoveDown')}
                        </button>
                        <button
                          type="button"
                          className="mw-dsh-btn"
                          data-variant="ghost"
                          data-size="sm"
                          onClick={() => setActiveTheaterRoom(room.id)}
                        >
                          {t('modulesOpen')}
                        </button>
                      </div>
                    </article>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  )
}
