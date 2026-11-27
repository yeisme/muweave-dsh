import { applyEpisodeCut } from './drama-cut-store'
import type {
  ContinuityBibleV1,
  EpisodeCutOverrideV1,
  EpisodeQcFindingV1,
  EpisodeQcReportV1,
  ShotReviewRecordV1,
} from './protocol'

export interface EpisodeQcShotMedia {
  role: 'keyframe' | 'reference' | 'video' | 'voice' | 'music' | 'sfx'
  sha256?: string
  elementId?: string
  mime?: string
}

export interface EpisodeQcShotInput {
  order: number
  episodeRef?: string
  sceneRef: string
  shotRef: string
  plannedDurationMicros: number
  linkedMedia?: readonly EpisodeQcShotMedia[]
}

export interface EpisodeQcAssetInput {
  assetRef: string
  role?: string
  axes?: {
    scaenaAdmission?: string
    subjectFreeze?: string
    productionAcceptance?: string
    currentUsability?: string
  }
}

export interface RunEpisodeQcInput {
  episodeRef?: string
  shots: readonly EpisodeQcShotInput[]
  cutOverride?: EpisodeCutOverrideV1
  reviews?: readonly ShotReviewRecordV1[]
  assets?: readonly EpisodeQcAssetInput[]
  bible?: ContinuityBibleV1
  /** Optional CAS blob existence predicate; returns false when a referenced sha256 blob is missing on disk. */
  hasCasBlob?: (sha256: string) => boolean
  generatedAt?: string
}

/**
 * Pure, zero-cost automated Episode QC Gate covering 5 production pillars:
 * 1. Opening hook & episode pacing
 * 2. Media readiness, CAS integrity & lip-sync duration risk
 * 3. 4-axis asset readiness
 * 4. Director review gate
 * 5. AI compliance disclosure metadata
 */
export function runEpisodeQc(input: RunEpisodeQcInput): EpisodeQcReportV1 {
  const findings: EpisodeQcFindingV1[] = []
  const epFiltered = input.episodeRef
    ? input.shots.filter((s) => !s.episodeRef || s.episodeRef === input.episodeRef)
    : [...input.shots]
  const activeShots = applyEpisodeCut(epFiltered, input.cutOverride)
  const reviewMap = new Map((input.reviews ?? []).map((r) => [r.shotRef, r]))

  const totalDurationMs = activeShots.reduce(
    (sum, s) => sum + Math.max(0, Math.round((s.plannedDurationMicros || 0) / 1000)),
    0,
  )

  // Pillar 1: Opening hook & duration range
  let pacingClean = true
  if (activeShots.length === 0) {
    pacingClean = false
    findings.push({
      code: 'qc_empty_episode',
      severity: 'blocker',
      message: 'Episode has zero active shots after cut overrides.',
      suggestion: 'Restore omitted shots or sync a Scaena storyboard breakdown before delivery.',
    })
  } else {
    const firstShot = activeShots[0]!
    const firstMs = Math.round((firstShot.plannedDurationMicros || 0) / 1000)
    if (firstMs > 3500) {
      pacingClean = false
      findings.push({
        code: 'qc_opening_hook_slow',
        severity: 'warning',
        shotRef: firstShot.shotRef,
        message: `Opening shot ${firstShot.shotRef} is ${(firstMs / 1000).toFixed(1)}s (> 3.5s hook target).`,
        suggestion: 'Trim shot #1 to <= 3.5s to retain vertical-drama viewers in the opening hook.',
      })
    }
    if (totalDurationMs < 5000 || totalDurationMs > 300_000) {
      pacingClean = false
      findings.push({
        code: 'qc_episode_duration_range',
        severity: 'warning',
        message: `Episode total duration is ${(totalDurationMs / 1000).toFixed(1)}s (outside 5s–300s delivery band).`,
        suggestion: 'Adjust shot durations or verify all scenes are included in the cut.',
      })
    }
  }
  if (pacingClean) {
    findings.push({
      code: 'qc_pacing_ok',
      severity: 'pass',
      message: `Opening hook and total episode duration (${(totalDurationMs / 1000).toFixed(1)}s) are within delivery targets.`,
    })
  }

  // Pillar 2: Media readiness, lip-sync & CAS integrity
  let mediaClean = true
  for (const shot of activeShots) {
    const linked = shot.linkedMedia ?? []
    const roles = new Set(linked.map((m) => m.role))
    const hasVisual = roles.has('keyframe') || roles.has('video')
    const hasAudio = roles.has('voice') || roles.has('music') || roles.has('sfx')
    const durationMs = Math.round((shot.plannedDurationMicros || 0) / 1000)

    if (!hasVisual) {
      mediaClean = false
      findings.push({
        code: 'qc_shot_missing_visual',
        severity: 'blocker',
        shotRef: shot.shotRef,
        message: `Shot ${shot.shotRef} is missing both keyframe and video media.`,
        suggestion: 'Generate or bind a keyframe/video asset in ShotInspector.',
      })
    }
    if (!hasAudio) {
      mediaClean = false
      findings.push({
        code: 'qc_shot_missing_audio',
        severity: 'warning',
        shotRef: shot.shotRef,
        message: `Shot ${shot.shotRef} has no voice, music, or SFX track linked.`,
        suggestion: 'Attach voice/SFX/music or verify room tone before final mix.',
      })
    }
    if (roles.has('voice') && durationMs > 8000) {
      mediaClean = false
      findings.push({
        code: 'qc_shot_lipsync_risk',
        severity: 'warning',
        shotRef: shot.shotRef,
        message: `Shot ${shot.shotRef} has voice track with ${(durationMs / 1000).toFixed(1)}s duration (> 8s lip-sync drift risk).`,
        suggestion: 'Split dialogue into shorter reaction cuts or trim below 8s.',
      })
    }
    if (input.hasCasBlob) {
      for (const m of linked) {
        if (m.sha256 && !input.hasCasBlob(m.sha256)) {
          mediaClean = false
          findings.push({
            code: 'qc_cas_blob_missing',
            severity: 'blocker',
            shotRef: shot.shotRef,
            message: `Shot ${shot.shotRef} references missing CAS blob for role ${m.role}.`,
            suggestion: 'Re-sync the workspace bundle or re-link a valid media blob.',
          })
        }
      }
    }
  }
  if (mediaClean && activeShots.length > 0) {
    findings.push({
      code: 'qc_media_ok',
      severity: 'pass',
      message: 'All active shots have valid visual/audio media links and verified CAS blobs.',
    })
  }

  // Pillar 3: 4-axis asset readiness
  const blockedAssets = (input.assets ?? []).filter((a) => {
    const ax = a.axes
    if (!ax) return false
    return (
      ax.currentUsability === 'blocked' ||
      ax.scaenaAdmission === 'rejected' ||
      ax.productionAcceptance === 'rejected'
    )
  })
  if (blockedAssets.length > 0) {
    for (const asset of blockedAssets) {
      findings.push({
        code: 'qc_asset_axis_blocked',
        severity: 'warning',
        message: `Asset ${asset.assetRef} is blocked on 4-axis readiness (${asset.axes?.currentUsability ?? 'blocked'}).`,
        suggestion: 'Resolve asset admission/freeze/acceptance before final render.',
      })
    }
  } else {
    findings.push({
      code: 'qc_assets_ok',
      severity: 'pass',
      message: 'No blocked 4-axis production assets detected.',
    })
  }

  // Pillar 4: Director review gate
  let reviewClean = true
  for (const shot of activeShots) {
    const status = reviewMap.get(shot.shotRef)?.status ?? 'draft'
    if (status === 'draft') {
      reviewClean = false
      findings.push({
        code: 'qc_shot_unapproved',
        severity: 'blocker',
        shotRef: shot.shotRef,
        message: `Shot ${shot.shotRef} is still in draft review state.`,
        suggestion: 'Review and mark approved or locked in ShotInspector or via batch review.',
      })
    } else if (status === 'needs_revision') {
      reviewClean = false
      findings.push({
        code: 'qc_shot_needs_revision',
        severity: 'blocker',
        shotRef: shot.shotRef,
        message: `Shot ${shot.shotRef} is flagged needs_revision.`,
        suggestion: 'Address director notes and update review status to approved.',
      })
    }
  }
  if (reviewClean && activeShots.length > 0) {
    findings.push({
      code: 'qc_reviews_ok',
      severity: 'pass',
      message: 'All active shots pass the director review gate.',
    })
  }

  // Pillar 5: AI compliance disclosure metadata
  const hasDisclosure = Boolean(input.bible?.complianceDisclosure?.trim())
  if (!hasDisclosure) {
    findings.push({
      code: 'qc_missing_compliance_disclosure',
      severity: 'warning',
      message: 'Continuity Bible is missing AI-generated content compliance disclosure text.',
      suggestion: 'Set complianceDisclosure in the Continuity Bible (e.g. "本片由 AI 辅助生成") before distribution.',
    })
  } else {
    findings.push({
      code: 'qc_compliance_ok',
      severity: 'pass',
      message: 'AI compliance disclosure metadata is configured.',
    })
  }

  const counts = {
    blocker: findings.filter((f) => f.severity === 'blocker').length,
    warning: findings.filter((f) => f.severity === 'warning').length,
    pass: findings.filter((f) => f.severity === 'pass').length,
  }
  const score = Math.max(0, Math.min(100, 100 - 15 * counts.blocker - 5 * counts.warning))
  const readyForDelivery = counts.blocker === 0 && activeShots.length > 0

  return {
    schema: 'muweave.episode-qc.v1',
    ...(input.episodeRef ? { episodeRef: input.episodeRef } : {}),
    score,
    readyForDelivery,
    counts,
    shotCount: activeShots.length,
    totalDurationMs,
    findings,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
  }
}
