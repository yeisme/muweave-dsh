import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const timestamp = '2026-11-24T11:32:00.000Z'
export const reviewTime = '2026-11-24T12:00:00.000Z'
const workspaceId = 'workspace:rain'
const projectId = 'project:river-street'
const episodeRef = 'episode:01'
const sceneRef = 'scene:01:03'
const shotRefs = ['shot:01:03:01', 'shot:01:03:02']
const taskId = 'task:night-review'
const traceId = 'trace:night-review'
const runId = 'run:street-v4'
const jobId = 'job:street-v4'
const artifactId = 'artifact:street-v4'
const digestOf = (data) => 'sha256:' + createHash('sha256').update(data).digest('hex')

export async function createFixture() {
  // Resized offline copies of the studio prototype's Unsplash reference photos.
  // street-night and its color-grade baseline: https://images.unsplash.com/photo-1519608487953-e999c86e7455
  // rain-detail: https://images.unsplash.com/photo-1428592953211-077101b2021b
  // https://unsplash.com/license
  const frames = await Promise.all(['street-night', 'street-baseline', 'rain-detail'].map(async (name) => {
    const bytes = await readFile(new URL('./fixtures/' + name + '.jpg', import.meta.url))
    return { bytes, sha256: digestOf(bytes), mimeType: 'image/jpeg' }
  }))
  const media = new Map(frames.map((frame) => [frame.sha256, frame]))
  const [current, baseline, detail] = frames
  const mediaBlob = (frame, label) => ({ blobDigest: frame.sha256, mimeType: frame.mimeType, role: 'primary', label })
  const visual = {
    domain: 'eikona', kind: 'eikona.candidate_group', sourceOwner: 'eikona',
    episodeRef, sceneRef, shotRefs, role: 'scene',
  }
  const candidate = (id, frame) => ({
    artifactId: id,
    handle: id.replace('artifact:', ''),
    role: 'scene',
    sha256: frame.sha256,
  })
  const currentCandidate = candidate(artifactId, current)
  const baselineCandidate = candidate('artifact:street-v3', baseline)
  const staged = [
    {
      ...visual, elementId: 'eikona-candidates-street-v4', sourceRef: 'eikona://runs/' + runId,
      title: '雨夜街口 · 终选', subtitle: '保留湿路反光，压暗远处橱窗以突出街道纵深。',
      status: 'waiting_review', sourceRevision: '4', mediaBlobs: [mediaBlob(current, artifactId)],
      payload: { runId, reviewState: 'waiting_review', candidates: [currentCandidate, candidate('artifact:rain-detail', detail)] },
    },
    {
      ...visual, elementId: 'eikona-candidates-street-v3', sourceRef: 'eikona://runs/run:street-v3',
      title: '雨夜街口 · 上一版', subtitle: '对比基线 · 保留早期冷色调',
      status: 'accepted', stale: true, sourceRevision: '3', mediaBlobs: [mediaBlob(baseline, baselineCandidate.artifactId)],
      updatedAt: '2026-11-24T08:00:00.000Z',
      payload: { runId: 'run:street-v3', reviewState: 'accepted', candidates: [baselineCandidate] },
    },
    {
      domain: 'eikona', kind: 'eikona.assessment_card', sourceOwner: 'eikona',
      elementId: 'eikona-assess-street-v4', sourceRef: 'eikona://runs/' + runId + '/assessment',
      title: '雨夜街口 · 评估分卡', status: 'ready',
      payload: { runId, scores: [{ artifact_id: artifactId, character_consistency: 88, lighting_match: 94, composition: 91 }] },
    },
    {
      domain: 'harness', kind: 'harness.pi_goal', sourceOwner: 'pi',
      elementId: 'pi-goal-rain', sourceRef: 'goal:rain', title: '雨夜重逢 · 叙事构想', status: 'ready',
      payload: {},
    },
    {
      domain: 'script', kind: 'script.scene_card', sourceOwner: 'auctra',
      elementId: 'scene-card-rain', sourceRef: sceneRef, episodeRef, sceneRef, title: '外景 · 雨夜街口', status: 'draft',
      payload: { sceneRef, heading: '外景 · 雨夜街口' },
    },
    {
      domain: 'drama', kind: 'drama.storyboard_table', sourceOwner: 'scaena',
      elementId: 'storyboard-rain', sourceRef: 'breakdown:rain', episodeRef, sceneRef, shotRefs,
      title: '第一集 · 街口分镜', status: 'ready',
      payload: { episodeRef, rows: shotRefs.map((shotRef, index) => ({
        shotRef, sceneRef, order: index + 1, plannedDurationMicros: 3500000,
        cells: { camera: index === 0 ? '街道全景' : '积水特写' },
        linkedMedia: [{ sha256: current.sha256, artifactId, role: 'keyframe', mime: current.mimeType }],
      })) },
    },
    {
      domain: 'drama', kind: 'drama.edit_timeline', sourceOwner: 'scaena',
      elementId: 'edit-rain', sourceRef: 'edit:rain', episodeRef, title: '第一集 · 粗剪', status: 'draft',
      payload: { clips: [] },
    },
  ].map((element) => ({
    schemaVersion: 'muweave.element.v1', updatedAt: timestamp, ...element, digest: digestOf(element.elementId),
  }))
  const elements = staged.map(({ schemaVersion, payload, ...summary }) => summary)
  const ownerStates = { eikona: 'ready', auctra: 'ready', scaena: 'ready', pi: 'ready', dsh: 'empty' }
  const project = {
    id: projectId, title: '河街旧影', status: 'in_production', archived: false, ownerBindings: [],
    workspaceRefs: [workspaceId], createdAt: timestamp, updatedAt: timestamp,
  }
  const workspace = { workspaceId, label: project.title, hasBundle: true }
  const index = {
    schemaVersion: 'muweave.index.v1', projectId, title: project.title, revision: 4,
    generatedAt: timestamp, elements, ownerStates,
  }
  const task = {
    taskId, traceId, workspaceId, rootTaskId: taskId, depth: 0, revision: 2,
    assignedTo: { botId: 'bot:visual' }, goal: '审阅街口夜景', status: 'waiting_for_human', attention: 'waiting_for_human',
    idempotencyKey: taskId, payloadDigest: digestOf(taskId), deadline: '2026-11-24T09:30:00.000Z',
    createdAt: '2026-11-24T08:10:00.000Z', updatedAt: timestamp,
  }
  const jobs = [{
    jobId, workspaceId, title: '街口夜景 · 调色候选', owner: 'eikona', kind: 'image', status: 'completed',
    capabilityId: 'eikona.image', ownerJobRef: runId, promptDigest: digestOf(jobId), requestedBy: 'agent',
    requester: { taskId, botId: 'bot:visual' }, traceId, idempotencyKey: jobId, estimate: { unit: 'none' },
    anchor: { episodeRef, sceneRef, shotRef: shotRefs[0] }, createdAt: task.createdAt, updatedAt: timestamp,
    slots: [baseline, current, detail].map((frame, index) => ({
      slotId: 'slot:' + index, index, status: 'done', review: 'unreviewed', sha256: frame.sha256, mime: frame.mimeType,
      label: ['冷调基线', '夜景终选', '雨滴特写'][index],
    })), nextAction: 'review',
  }]
  const events = [
    { ts: task.createdAt, event: 'task.delegated', taskId, traceId, workspaceId, summary: '已交给视觉助手' },
    { ts: '2026-11-24T11:02:00.000Z', event: 'job.completed', taskId, traceId, workspaceId, jobId, summary: '调色工作已完成' },
    { ts: timestamp, event: 'task.waiting_for_human', taskId, traceId, workspaceId, ref: artifactId, summary: '候选已送审' },
  ]
  const schedule = {
    schema: 'muweave.schedule.v1', updatedAt: timestamp,
    entries: [{ projectId, ref: elements[0].sourceRef, label: elements[0].title, kind: elements[0].kind, date: '2026-11-23', updatedAt: timestamp }],
  }
  const success = (data) => ({ ok: true, generation: 1, data })
  return {
    media,
    rpc(action, payload = {}) {
      switch (action) {
        case 'project.list': return success({ projects: [project], activeProjectId: projectId })
        case 'workspace.list': return success({ workspaces: [workspace] })
        case 'bundle.status': return success({ initialized: true, workspace, index })
        case 'bundle.elements.list': return success({
          projectId, title: project.title, revision: 4, ownerStates,
          elements: elements.filter((el) => ['domain', 'kind', 'sourceOwner', 'episodeRef', 'sceneRef'].every((filter) => !payload[filter] || el[filter] === payload[filter])),
        })
        case 'bundle.element.get': {
          const element = staged.find((el) => el.elementId === payload.elementId)
          if (element) return success({ element })
          break
        }
        case 'media.token.issue': {
          if (!media.has(payload.blobDigest)) break
          return success({ token: payload.blobDigest, url: '/api/muweave-dsh/media?token=' + encodeURIComponent(payload.blobDigest), expiresInMs: 60_000 })
        }
        case 'capability.catalog': return success({ paidEnabled: false, capabilities: [] })
        case 'cli.catalog': return success({ entries: [] })
        case 'job.list': return success({ jobs })
        case 'task.get': if (payload.taskId === taskId) return success({ task }); break
        case 'task.list': return success({ tasks: [task] })
        case 'event.list': return success({
          events: events.filter((event) => (!payload.taskId || event.taskId === payload.taskId) && (!payload.traceId || event.traceId === payload.traceId)),
          nextCursor: null, corruptLines: 0,
        })
        case 'schedule.list': return success(schedule)
      }
      return { ok: false, generation: 1, error: { code: 'fixture/unavailable', message: '自检数据未提供此操作', retryable: false } }
    },
  }
}
