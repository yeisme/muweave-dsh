import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  atomicWriteJson,
  bindBundleRef,
  buildElement,
  cleanAndRebuildBundle,
  containsHostPath,
  createMuweaveBundleConsumer,
  ingestElementsIntoBundle,
  initBundle,
  putCasBlob,
  readBundleIndexFromDisk,
  readCasBlobVerified,
  readElementFromDisk,
  runMuweaveBundleCli,
  stripHostPaths,
  syncBundle,
  validateBundleOnDisk,
  validateEikonaGenerationSpec,
  type CliRunner,
} from '@yeisme/muweave-bundle'

describe('@yeisme/muweave-bundle materialized workspace bundle', () => {
  it('enforces Eikona Sunburst pixel WxH and high-quality rules', () => {
    expect(validateEikonaGenerationSpec({ model: 'openai/gpt-image-2.5-sunburst', size: '1152x2048', quality: 'high' }).ok).toBe(true)
    expect(validateEikonaGenerationSpec({ model: 'openai/gpt-image-2.5-sunburst', size: '2k', quality: 'high' })).toMatchObject({
      ok: false,
      code: 'eikona/shorthand_size_forbidden',
    })
    expect(validateEikonaGenerationSpec({ model: 'gpt-image-2.5', size: '1024x1024', quality: 'high' })).toMatchObject({
      ok: false,
      code: 'eikona/unqualified_model_rejected',
    })
    expect(validateEikonaGenerationSpec({ model: 'openai:gpt-image-2.5-sunburst', size: '1024x1024' })).toMatchObject({
      ok: false,
      code: 'eikona/colon_model_unsupported',
    })
    expect(validateEikonaGenerationSpec({ model: 'openai/gpt-image-2.5-sunburst', size: '1024x1024', quality: 'low' })).toMatchObject({
      ok: false,
      code: 'eikona/sunburst_requires_high_quality',
    })
  })

  it('directly enforces containsHostPath, stripHostPaths, and atomicWriteJson across scheme-prefixed URIs and credentials', async () => {
    // Legitimate scheme URIs without host paths pass
    expect(containsHostPath('eikona://runs/run_001')).toBe(false)
    expect(containsHostPath('promptrepo://official/image/drama-v1@1.0.0?locale=zh')).toBe(false)
    expect(containsHostPath('sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef')).toBe(false)

    // Scheme-prefixed URIs embedding host paths are caught and stripped
    expect(containsHostPath('eikona:///home/user/secret.png')).toBe(true)
    expect(containsHostPath('promptrepo:///home/user/private-template.yaml')).toBe(true)
    expect(containsHostPath('sha256:/tmp/x/bypass')).toBe(true)
    expect(containsHostPath('C:\\Users\\alice\\secret.txt')).toBe(true)
    expect(containsHostPath({ local_object_path: 'relative/still-forbidden.png' })).toBe(true)

    const stripped = stripHostPaths({
      eikonaRef: 'eikona:///home/user/secret.png',
      promptRef: 'promptrepo:///home/user/private-template.yaml',
      digestRef: 'sha256:/tmp/x/bypass',
      winPath: 'C:\\Users\\alice\\secret.txt',
      local_object_path: '/var/data/obj.png',
    })
    expect(containsHostPath(stripped)).toBe(false)
    expect(stripped.eikonaRef).toBe('eikona://[path-redacted]')
    expect(stripped.promptRef).toBe('promptrepo://[path-redacted]')
    expect(stripped.digestRef).toBe('sha256:[path-redacted]')
    expect(stripped.winPath).toBe('[path-redacted]')
    expect('local_object_path' in stripped).toBe(false)

    const tmpDir = await mkdtemp(path.join(tmpdir(), 'muweave-atomic-fence-'))
    try {
      await expect(
        atomicWriteJson(path.join(tmpDir, 'bad-path.json'), { ref: 'promptrepo:///home/user/secret' }),
      ).rejects.toThrow(/unsanitized host path/)
      await expect(
        atomicWriteJson(path.join(tmpDir, 'bad-cred.json'), { key: 'sk-1234567890abcdefghij' }),
      ).rejects.toThrow(/plaintext credential/)
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('fails closed for failed or unrecognized upstream responses', async () => {
    const cases = [
      {
        target: 'eikona-run' as const,
        owner: 'eikona' as const,
        response: { exitCode: 7, body: { schema_version: 'eikona.review_packet.v1', run_id: 'failed-run', candidates: [] } },
        marker: async (_ws: string) => undefined,
      },
      {
        target: 'auctra-project' as const,
        owner: 'auctra' as const,
        response: { exitCode: 0, body: { status: 'failed', kind: 'auctra.screenplay.room.v1', scenes: [] } },
        marker: async (ws: string) => mkdir(path.join(ws, '.auctra'), { recursive: true }),
      },
      {
        target: 'eikona-run' as const,
        owner: 'eikona' as const,
        response: { exitCode: 0, body: { status: 'ok', message: 'unrecognized owner response' } },
        marker: async (_ws: string) => undefined,
      },
      {
        target: 'eikona-run' as const,
        owner: 'eikona' as const,
        response: { exitCode: 0, body: { status: 'ok', schema_version: 'eikona.review_packet.v1' } },
        marker: async (_ws: string) => undefined,
      },
      {
        target: 'scaena-breakdown' as const,
        owner: 'scaena' as const,
        response: { exitCode: 0, body: { status: 'error', schema_version: 'scaena.asset.list_page.v0.1', assets: [] } },
        marker: async (ws: string) => {
          await mkdir(path.join(ws, '.scaena'), { recursive: true })
          await writeFile(path.join(ws, '.scaena', 'project.json'), '{}')
        },
      },
    ]
    for (const testCase of cases) {
      const ws = await mkdtemp(path.join(tmpdir(), 'muweave-owner-failure-'))
      try {
        await testCase.marker(ws)
        await bindBundleRef(ws, testCase.target, 'synthetic-ref')
        const index = await syncBundle({
          workspaceDir: ws,
          runner: async () => ({ exitCode: testCase.response.exitCode, stdout: JSON.stringify(testCase.response.body), stderr: 'synthetic failure' }),
        })
        expect(index.ownerStates[testCase.owner]).toBe('unavailable')
        expect(index.elements.some((element) => element.sourceOwner === testCase.owner)).toBe(false)
      } finally {
        await rm(ws, { recursive: true, force: true })
      }
    }
  })

  it('does not replace an existing invalid manifest during init or sync', async () => {
    const ws = await mkdtemp(path.join(tmpdir(), 'muweave-invalid-manifest-'))
    try {
      const manifestPath = path.join(ws, '.muweave', 'bundle.v1.json')
      const manifest = await initBundle(ws)
      for (const original of [
        '{"schemaVersion":999,"projectId":"KEEP-ME","bindings":{"eikonaRuns":["KEEP-RUN"]}}\n',
        JSON.stringify({ ...manifest, bindings: { ...manifest.bindings, eikonaRuns: 42 } }),
        '{"broken":',
      ]) {
        await writeFile(manifestPath, original)
        const diagnostic = { name: 'BundleValidationError', code: 'contract_mismatch' }
        await expect(initBundle(ws)).rejects.toMatchObject(diagnostic)
        await expect(syncBundle({ workspaceDir: ws, runner: async () => { throw new Error('owner must not run') } })).rejects.toMatchObject(diagnostic)
        expect(await readFile(manifestPath, 'utf8')).toBe(original)
      }
    } finally {
      await rm(ws, { recursive: true, force: true })
    }
  })

  it('skips spawning scaena and auctra CLIs when initialization markers are absent', async () => {
    const ws = await mkdtemp(path.join(tmpdir(), 'muweave-preflight-'))
    try {
      await initBundle(ws, { title: 'Preflight Test' })
      await bindBundleRef(ws, 'scaena-breakdown', 'breakdown:ep01')
      await bindBundleRef(ws, 'auctra-project', 'owner:auctra:drama')

      const calls: string[] = []
      const fakeRunner: CliRunner = async (bin, args) => {
        calls.push(`${bin} ${args.join(' ')}`)
        return { exitCode: 0, stdout: '{}', stderr: '' }
      }

      const idx = await syncBundle({ workspaceDir: ws, runner: fakeRunner })
      expect(calls).toEqual([])
      expect(idx.ownerStates.scaena).toBe('uninitialized_owner')
      expect(idx.ownerStates.auctra).toBe('uninitialized_owner')
    } finally {
      await rm(ws, { recursive: true, force: true })
    }
  })

  it('compiles Eikona, Auctra, Scaena, Pi, and DSH elements atomically, strips host paths, and supports clean rebuild + consumer SDK', async () => {
    const ws = await mkdtemp(path.join(tmpdir(), 'muweave-sync-'))
    try {
      // Set up workspace markers (.auctra, .scaena/project.json, .pi/goals, PLAN.md)
      await mkdir(path.join(ws, '.auctra'), { recursive: true })
      await mkdir(path.join(ws, '.scaena'), { recursive: true })
      await writeFile(path.join(ws, '.scaena', 'project.json'), '{"id":"proj_1"}\n')
      await mkdir(path.join(ws, '.pi', 'goals'), { recursive: true })
      await writeFile(path.join(ws, '.pi', 'goals', 'active_goal_01.md'), '# 第一集分镜交付\n- [x] 完成场次一\n- [ ] 完成场次二\n')
      await writeFile(path.join(ws, 'PLAN.md'), '# 拍摄计划\n- [x] 角色定妆\n')

      await initBundle(ws, { projectId: 'proj_ep01', title: '雨夜重逢' })
      const blob = await putCasBlob(ws, Buffer.from('fake-png-bytes'), 'image/png', 'primary', { width: 1152, height: 2048 })
      const verifiedBytes = await readCasBlobVerified(ws, blob.blobDigest)
      expect(verifiedBytes.toString()).toBe('fake-png-bytes')

      await bindBundleRef(ws, 'eikona-run', 'run_hero_01')
      await bindBundleRef(ws, 'auctra-project', 'owner:auctra:rain')
      await bindBundleRef(ws, 'auctra-scene', 'scene:ep01:s01')
      await bindBundleRef(ws, 'scaena-breakdown', 'breakdown:ep01')

      const fakeRunner: CliRunner = async (bin, args) => {
        if (bin === 'eikona' && args[0] === 'review') {
          return {
            exitCode: 0,
            stderr: '',
            stdout: JSON.stringify({
              ok: true,
              schema_version: 'eikona.review_packet.v1',
              run_id: 'run_hero_01',
              review_state: 'waiting_review',
              candidates: [
                {
                  artifact_id: 'art_01',
                  handle: 'artifact/run_hero_01/art_01',
                  uri: 'eikona://artifact/artifact/run_hero_01/art_01',
                  role: 'primary',
                  prompt_excerpt: '女主角林雾站在霓虹雨夜街口 /home/yeshugen/private/raw.png',
                  sha256: blob.blobDigest,
                  local_object_path: '/home/yeshugen/.eikona/private/art_01.png',
                },
              ],
            }),
          }
        }
        if (bin === 'auctra' && args[2] === 'describe') {
          return {
            exitCode: 0,
            stderr: '',
            stdout: JSON.stringify({
              kind: 'auctra.screenplay.room.v1',
              project_ref: 'owner:auctra:rain',
              title: '雨夜重逢 · 第一集',
              revision: '5',
              scenes: [{ scene_ref: 'scene:ep01:s01', order: 1, title: '街口重逢' }],
              story_time_anchors: [{ scene_ref: 'scene:ep01:s01', label: 'D1 23:15' }],
            }),
          }
        }
        if (bin === 'auctra' && args[2] === 'scene-card') {
          return {
            exitCode: 0,
            stderr: '',
            stdout: JSON.stringify({
              kind: 'auctra.scene_card.v1',
              scene_ref: 'scene:ep01:s01',
              heading: '外景 霓虹街口 - 夜',
              revision: '3',
              goal: '林雾试探沈舟是否认出旧怀表',
              obstacle: '巡逻车逼近',
              stakes: '身份暴露',
              turn: '沈舟压低伞沿递出暗号',
              characters: ['char:linwu', 'char:shenzhou'],
            }),
          }
        }
        if (bin === 'auctra' && args[2] === 'context') {
          return {
            exitCode: 0,
            stderr: '',
            stdout: JSON.stringify({
              kind: 'auctra.context_graph.v1',
              scene_ref: 'scene:ep01:s01',
              nodes: [{ id: 'char:linwu', label: '林雾', kind: 'character' }],
              edges: [],
            }),
          }
        }
        if (bin === 'scaena' && args[0] === 'storyboard') {
          return {
            exitCode: 0,
            stderr: '',
            stdout: JSON.stringify({
              schema_version: 'scaena.storyboard_table_view.v1alpha1',
              episode_ref: 'episode:01',
              rows: [
                {
                  scene_ref: 'scene:ep01:s01',
                  shot_ref: 'shot:01',
                  order: 1,
                  planned_duration_micros: 3500000,
                  cells: { camera: '特写 推镜', prompt_raw: 'secret prompt text' },
                  restricted_fields: ['prompt_raw'],
                },
              ],
            }),
          }
        }
        if (bin === 'scaena' && args[0] === 'asset') {
          return {
            exitCode: 0,
            stderr: '',
            stdout: JSON.stringify({
              schema_version: 'scaena.asset.list_page.v0.1',
              total_count: 1,
              assets: [
                {
                  asset_ref: 'asset:linwu',
                  kind: 'image',
                  role: 'character',
                  status: 'accepted',
                  version: 0,
                  version_ref: 'asset:linwu:v2',
                  scaena_admission: 'admitted',
                  subject_freeze: 'frozen',
                  production_acceptance: 'accepted',
                  current_usability: 'ready',
                },
              ],
            }),
          }
        }
        return { exitCode: 0, stdout: '{}', stderr: '' }
      }

      const index = await syncBundle({
        workspaceDir: ws,
        runner: fakeRunner,
        upstreamPayloads: {
          dshArtifacts: [
            {
              artifactId: 'call_01',
              toolName: 'muweave_check_pacing',
              title: '前三秒钩子节奏评估',
              status: 'completed',
              sceneRef: 'scene:ep01:s01',
              summary: { hookScore: 92 },
            },
          ],
        },
      })

      expect(index.ownerStates).toMatchObject({ eikona: 'ready', auctra: 'ready', scaena: 'ready' })
      expect(index.counts.byDomain.eikona).toBe(1)
      expect(index.counts.byDomain.script).toBe(3)
      expect(index.counts.byDomain.drama).toBe(2)
      expect(index.counts.byDomain.harness).toBe(3) // pi_goal + pi_plan + dsh_tool_artifact

      // Validate path-free & restricted field redaction + CAS verification
      const validation = await validateBundleOnDisk(ws)
      expect(validation.ok).toBe(true)
      expect(validation.findings).toEqual([])

      const eikonaEl = await readElementFromDisk(ws, 'eikona-candidates-run_hero_01')
      expect(JSON.stringify(eikonaEl)).not.toContain('/home/yeshugen')
      expect(JSON.stringify(eikonaEl)).not.toContain('local_object_path')

      const sbEl = await readElementFromDisk(ws, 'drama-storyboard-breakdown_ep01')
      expect(JSON.stringify(sbEl)).toContain('[restricted:prompt_raw]')
      expect(JSON.stringify(sbEl)).not.toContain('secret prompt text')

      // Consumer SDK read-only projection check (used by both DSH & MuWeave Web)
      const consumer = createMuweaveBundleConsumer({
        readIndex: () => readBundleIndexFromDisk(ws),
        readElement: (id) => readElementFromDisk(ws, id),
      })
      const eikonaProjection = await consumer.listElements({ domain: 'eikona' })
      expect(eikonaProjection.state).toBe('ready')
      expect(eikonaProjection.data?.elements).toHaveLength(1)

      // Rebuildability check: wipe .muweave/ and reconstruct from bindings
      const rebuilt = await cleanAndRebuildBundle({ workspaceDir: ws, runner: fakeRunner })
      expect(rebuilt.counts.byDomain.eikona).toBe(1)
      expect(rebuilt.counts.byDomain.script).toBe(3)
      expect(rebuilt.counts.byDomain.drama).toBe(2)

      // CLI smoke check
      const doctorExit = await runMuweaveBundleCli(['doctor', '--workspace', ws, '--json'])
      expect(doctorExit).toBe(0)

      // Concurrent sync serialization check: two parallel syncBundle calls must not clobber elements
      const [c1, c2] = await Promise.all([
        syncBundle({
          workspaceDir: ws,
          runner: fakeRunner,
          upstreamPayloads: {
            dshArtifacts: [{ artifactId: 'p1', toolName: 't1', title: '并发工件1', status: 'completed', summary: {} }],
          },
        }),
        syncBundle({
          workspaceDir: ws,
          runner: fakeRunner,
          upstreamPayloads: {
            dshArtifacts: [{ artifactId: 'p2', toolName: 't2', title: '并发工件2', status: 'completed', summary: {} }],
          },
        }),
      ])
      expect(c2.revision).toBeGreaterThan(c1.revision)
      const afterConcurrent = await readBundleIndexFromDisk(ws)
      const ids = afterConcurrent.elements.map((e) => e.elementId)
      expect(ids).toContain('dsh-artifact-p1')
      expect(ids).toContain('dsh-artifact-p2')

      // Path-bearing status, sourceRevision, and scheme-prefixed URIs (eikona:///home/..., sha256:/tmp/...)
      // are sanitized before hashing AND pass strict validation
      const trickyEl = buildElement({
        elementId: 'dsh-tricky-meta',
        domain: 'harness',
        kind: 'harness.dsh_tool_artifact',
        title: '路径元数据脱敏验证',
        sourceOwner: 'dsh',
        sourceRef: 'eikona:///home/user/secret/ref',
        sourceRevision: 'rev:/home/user/secret',
        status: 'failed at /tmp/x/log.txt',
        payload: { detail: 'from /var/log/app.log', fakeHash: 'sha256:/tmp/x/bypass' },
      })
      await ingestElementsIntoBundle(ws, [trickyEl])
      const postTrickyVal = await validateBundleOnDisk(ws)
      expect(postTrickyVal.ok).toBe(true)
      expect(postTrickyVal.findings).toEqual([])
      const storedTricky = await readElementFromDisk(ws, 'dsh-tricky-meta')
      expect(JSON.stringify(storedTricky)).not.toContain('/home/user')
      expect(JSON.stringify(storedTricky)).not.toContain('/tmp/x')
    } finally {
      await rm(ws, { recursive: true, force: true })
    }
  })
})
