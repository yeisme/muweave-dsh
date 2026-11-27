import { useState } from 'react'
import {
  EmptyState,
  IconButton,
  SceneMini,
  SectionHead,
  StatusTag,
  shotReadinessSummary,
  stageItemToFloatingAgent,
  type MuweaveElementSummaryV1,
  type MuweaveTranslator,
  type ShotReviewRecordV1,
} from '@yeisme/dsh-muweave-core/client'
import { formatDurationSec, pad2, reviewStatusLabel, type StoryboardRow } from './shot-inspector'

function resolveSceneKey(sc: MuweaveElementSummaryV1): string {
  return sc.sceneRef || sc.sourceRef || sc.elementId
}

export interface SideBySideViewProps {
  scriptCards: readonly MuweaveElementSummaryV1[]
  shotRows: readonly StoryboardRow[]
  reviewsByShot: Record<string, ShotReviewRecordV1>
  storyboards: readonly MuweaveElementSummaryV1[]
  onInspectShot: (shotRef: string) => void
  lang: string
  t: (k: string) => string
  coreT: MuweaveTranslator
}

export function SideBySideView({
  scriptCards,
  shotRows,
  reviewsByShot,
  storyboards,
  onInspectShot,
  lang,
  t,
  coreT,
}: SideBySideViewProps) {
  const [selectedSceneRef, setSelectedSceneRef] = useState<string | null>(null)

  if (scriptCards.length === 0 && shotRows.length === 0) {
    return <EmptyState>{coreT('emptyElements')}</EmptyState>
  }

  const primaryBoard = storyboards[0]
  const visibleShots = selectedSceneRef
    ? shotRows.filter((r) => r.sceneRef === selectedSceneRef)
    : shotRows

  return (
    <div className="mw-split-2" data-drama-script-sidebyside="true">
      <section className="mw-stack" data-gap="sm">
        <SectionHead title={t('scriptSide')} meta={String(scriptCards.length)} />
        {scriptCards.map((sc) => {
          const sceneKey = resolveSceneKey(sc)
          const matchedShots = shotRows.filter((r) => r.sceneRef === sceneKey)
          const totalMicros = matchedShots.reduce((sum, r) => sum + r.plannedDurationMicros, 0)
          const approvedCount = matchedShots.filter((r) => {
            const st = reviewsByShot[r.shotRef]?.status
            return st === 'approved' || st === 'locked'
          }).length
          const isSelected = selectedSceneRef === sceneKey

          return (
            <div
              key={sc.elementId}
              className="mw-stack"
              data-gap="xs"
              data-scene-card={sceneKey}
              data-selected={isSelected ? 'true' : undefined}
            >
              <button
                type="button"
                className="dr-scene-card mw-dsh-card mw-stack"
                data-flat="true"
                data-gap="xs"
                aria-pressed={isSelected}
                onClick={() => setSelectedSceneRef((prev) => (prev === sceneKey ? null : sceneKey))}
              >
                <SceneMini scene={sc} lang={lang} />
                <div className="mw-spread">
                  {matchedShots.length === 0 ? (
                    <span className="dr-coverage-badge mw-status" data-tone="warn" data-scene-uncovered="true">
                      {t('sceneUncovered')}
                    </span>
                  ) : (
                    <span className="dr-coverage-badge mw-dsh-muted" data-scene-coverage={sceneKey}>
                      {matchedShots.length} {t('shotCount')} · {formatDurationSec(totalMicros)}
                      {t('seconds')} · {t('approvedRatio')} {approvedCount}/{matchedShots.length}
                    </span>
                  )}
                </div>
              </button>
            </div>
          )
        })}
      </section>

      <section className="mw-stack" data-gap="sm">
        <SectionHead
          title={t('shotSide')}
          meta={`${visibleShots.length} ${t('shotCount')}`}
          actions={
            selectedSceneRef ? (
              <button
                type="button"
                className="mw-dsh-btn"
                data-size="sm"
                data-variant="ghost"
                data-clear-scene-filter="true"
                onClick={() => setSelectedSceneRef(null)}
              >
                {t('filterAllScenes')} ({selectedSceneRef})
              </button>
            ) : undefined
          }
        />

        {visibleShots.length === 0 ? (
          <EmptyState>{t('noShotsForScene')}</EmptyState>
        ) : (
          visibleShots.map((r) => {
            const review = reviewsByShot[r.shotRef]
            const readiness = shotReadinessSummary(r.linkedMedia)
            return (
              <article
                key={r.shotRef}
                className="mw-dsh-card mw-stack"
                data-flat="true"
                data-gap="xs"
                data-sidebyside-shot={r.shotRef}
              >
                <div className="mw-spread">
                  <span className="mw-row" data-gap="sm">
                    <b className="mw-num">{pad2(r.order)}</b>
                    <span className="mw-dsh-code">{r.shotRef}</span>
                    <span className="mw-dsh-muted">
                      {formatDurationSec(r.plannedDurationMicros)}
                      {t('seconds')}
                    </span>
                  </span>
                  <span className="mw-chip">{r.sceneRef}</span>
                </div>
                <div className="mw-spread">
                  <span className="mw-row" data-gap="xs">
                    <StatusTag
                      status={review?.status ?? 'draft'}
                      lang={lang}
                      label={reviewStatusLabel(review?.status, t)}
                    />
                    <span className="mw-dsh-muted">
                      {readiness.filledCount}/6 {t('mediaRolesFilled')}
                    </span>
                  </span>
                  <span className="mw-row" data-gap="xs">
                    <button
                      type="button"
                      className="mw-dsh-btn"
                      data-size="sm"
                      data-variant="ghost"
                      data-inspect-shot={r.shotRef}
                      onClick={() => onInspectShot(r.shotRef)}
                    >
                      {t('inspectShot')}
                    </button>
                    <IconButton
                      icon="at"
                      size="sm"
                      label={coreT('insertRefChip')}
                      onClick={() =>
                        stageItemToFloatingAgent({
                          kind: 'element',
                          ref: `${primaryBoard?.elementId ?? 'drama'}:${r.shotRef}`,
                          label: `${r.sceneRef}/${r.shotRef}`,
                          serializedLine: `[ScaenaShot breakdown=${primaryBoard?.sourceRef ?? 'drama'} scene=${r.sceneRef} shot=${r.shotRef}]`,
                        })
                      }
                    />
                  </span>
                </div>
              </article>
            )
          })
        )}
      </section>
    </div>
  )
}
