import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { createFixture, reviewTime } from './p0-fixture.mjs'

// Usage from the repository root: node packages/dsh-muweave-workbench/scripts/p0-shots.mjs
// Standalone browser fixture for the actual plugin page, without a DSH host or network calls.
const rootDir = fileURLToPath(new URL('../../../', import.meta.url))
const outputDir = join(rootDir, 'temp/p0-shots')
const origin = 'https://muweave.test'
const rootSelector = '[data-muweave-workspace-root="true"]'
const compareSelector = '[data-compare-pane="true"]'
const verdictSelector = '[data-verdict-panel="true"]'
const viewports = [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]
const variants = ['light', 'dark']
const candidate = '雨夜街口 · 终选'
const expectedFiles = new Set(viewports.flatMap(({ width }) => variants.map((theme) => width + '-' + theme + '.png')))
const markup = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>幕织 · 视觉自检</title><style>body{margin:0;background:#fff}</style><div id="root"></div><script src="/app.js" defer></script></html>'

const [fixture, app] = await Promise.all([
  createFixture(),
  build({
    absWorkingDir: rootDir,
    entryPoints: [fileURLToPath(new URL('p0-page.tsx', import.meta.url))],
    bundle: true, format: 'iife', platform: 'browser', write: false,
    define: { 'process.env.NODE_ENV': '"production"' },
  }),
])

async function routeFixture(route, mutations) {
  const request = route.request()
  const url = new URL(request.url())
  if (url.origin !== origin) return route.abort()
  if (url.pathname === '/') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: markup })
  if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: app.outputFiles[0].text })
  if (url.pathname === '/api/muweave-dsh/rpc' && request.method() === 'POST') {
    const { action, payload } = request.postDataJSON()
    if (action === 'eikona.feedback.decide' || action === 'eikona.asset.bind') mutations.push(action)
    return route.fulfill({ json: fixture.rpc(action, payload) })
  }
  if (url.pathname === '/api/muweave-dsh/media') {
    const frame = fixture.media.get(url.searchParams.get('token'))
    if (!frame) return route.fulfill({ status: 404 })
    const headers = { 'accept-ranges': 'bytes' }
    const range = request.headers().range
    if (!range) return route.fulfill({ contentType: frame.mimeType, headers, body: frame.bytes })
    const match = /^bytes=(d+)-(d*)$/.exec(range)
    const start = match ? Number(match[1]) : -1
    const end = match?.[2] ? Math.min(Number(match[2]), frame.bytes.length - 1) : frame.bytes.length - 1
    if (start < 0 || start > end) {
      return route.fulfill({ status: 416, headers: { ...headers, 'content-range': 'bytes */' + frame.bytes.length } })
    }
    return route.fulfill({
      status: 206, contentType: frame.mimeType, body: frame.bytes.subarray(start, end + 1),
      headers: { ...headers, 'content-range': 'bytes ' + start + '-' + end + '/' + frame.bytes.length },
    })
  }
  return route.fulfill({ status: 404 })
}

async function waitForMedia(page, scope, count) {
  await page.waitForFunction(({ scope, count }) => {
    const images = Array.from(document.querySelectorAll(scope + ' img[src*="/api/muweave-dsh/media"]'))
    return images.filter((image) => image.complete && image.naturalWidth > 1 && image.naturalHeight > 1).length >= count
  }, { scope, count })
}

async function checkText(page) {
  const leaks = await page.locator(rootSelector).evaluate((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const keys = new Set(['heroEyebrow', 'heroTitle', 'heroLede', 'panelTitle', 'tabOverview', 'tabPiArtifacts',
      'tabDshArtifacts', 'tabBindWizard', 'metricTotal', 'metricStale', 'viewByStage'])
    const matches = []
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.parentElement?.checkVisibility({ checkVisibilityCSS: true })) continue
      const value = node.textContent.trim()
      if (/^[a-z]+(?:[A-Z][a-z]+)+$/.test(value) || value.split(/\s+/).some((word) => keys.has(word))) matches.push(value)
    }
    return matches
  })
  assert.deepEqual(leaks, [], '画面存在未翻译的键')
}

async function compareColors(page) {
  return page.evaluate(({ rootSelector, compareSelector }) => {
    const root = getComputedStyle(document.querySelector(rootSelector))
    const compare = getComputedStyle(document.querySelector(compareSelector))
    return { shell: root.color, surface: root.backgroundColor, compare: compare.backgroundColor }
  }, { rootSelector, compareSelector })
}

async function capture(browser, viewport, theme) {
  const context = await browser.newContext({ viewport, colorScheme: 'light', reducedMotion: 'reduce', timezoneId: 'Asia/Shanghai', locale: 'zh-CN' })
  try {
    const mutations = []
    await context.route('**/*', (route) => routeFixture(route, mutations))
    const page = await context.newPage()
    page.setDefaultTimeout(8000)
    await page.clock.setFixedTime(new Date(reviewTime))
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(origin)
    const spine = page.locator('[data-stage-spine="true"]')
    const visualStage = spine.locator('[data-stage-axis-row="visual"]')
    await visualStage.click()
    assert.equal(await spine.locator('[data-stage-axis-row]').count(), 6, '制作阶段数量应为 6')
    await visualStage.locator('[data-stage-metric="overdue"][aria-label$=" 1"]').waitFor()
    assert.equal(await visualStage.getAttribute('data-stage-blocked'), 'true', '视觉阶段应反映排期阻塞')
    await page.getByText(candidate, { exact: true }).first().waitFor()
    await waitForMedia(page, '[data-stage-region="L1"]', 1)
    await waitForMedia(page, '[data-stage-region="L2"]', 3)
    const verdict = page.locator(verdictSelector)
    const accept = verdict.locator('button[data-variant="primary"]')
    await verdict.getByText('完成生成', { exact: true }).waitFor()
    assert.equal(await accept.count(), 1, '判定面板应只有一个主操作')
    for (const evidence of ['88', '94', '91', 'v3 → v4 · 内容已更新', 'shot:01:03:01', 'shot:01:03:02']) {
      assert.equal(await verdict.getByText(evidence, { exact: true }).count(), 1, '判定面板缺少 ' + evidence)
    }
    if (theme === 'dark') {
      // Test both color preferences on the same compare UI so layout changes cannot mask a theme failure.
      const baselinePin = page.locator('[data-compare-pin="true"]').first()
      await baselinePin.focus()
      await baselinePin.press('Enter')
      await page.locator(compareSelector).waitFor()
      await waitForMedia(page, compareSelector, 2)
      const light = await compareColors(page)
      await page.emulateMedia({ colorScheme: 'dark' })
      const dark = await compareColors(page)
      assert.notEqual(dark.compare, light.compare, '审片对比未应用深色主题')
      assert.equal(dark.shell, light.shell, '审片主题改变了工作台文字')
      assert.equal(dark.surface, light.surface, '审片主题改变了工作台背景')
      await page.evaluate(() => window.scrollTo(0, 0))
    }
    await page.evaluate(() => document.fonts.ready)
    await checkText(page)
    assert.deepEqual(errors, [], '浏览器运行错误')
    const name = viewport.width + '-' + theme + '.png'
    const image = await page.screenshot({ type: 'png', fullPage: true, animations: 'disabled' })
    if (theme === 'light' && viewport.width === 1440) {
      await visualStage.focus()
      await page.keyboard.press('Meta+Enter')
      await verdict.getByText('已通过并绑定母版。', { exact: true }).waitFor()
      assert.deepEqual(mutations, ['eikona.feedback.decide', 'eikona.asset.bind'], '快捷键应先采纳，再绑定一次')
      assert(await accept.isDisabled(), '操作完成后应禁用主按钮')
    }
    return { name, image, md5: createHash('md5').update(image).digest('hex') }
  } finally {
    await context.close()
  }
}

let browser
try {
  browser = await chromium.launch().catch((error) => {
    if (!error.message.includes("Executable doesn't exist")) throw error
    return chromium.launch({ channel: 'chrome' })
  })
  const shots = []
  for (const viewport of viewports) {
    for (const theme of variants) {
      shots.push(await capture(browser, viewport, theme))
    }
  }
  assert.equal(shots.length, 6)
  assert.equal(new Set(shots.map(({ md5 }) => md5)).size, 6, '截图 MD5 有重复')
  await mkdir(outputDir, { recursive: true })
  const extraFiles = (await readdir(outputDir)).filter((name) => name.endsWith('.png') && !expectedFiles.has(name))
  assert.deepEqual(extraFiles, [], '输出目录存在其他 PNG 文件')
  for (const { name, image, md5 } of shots) {
    const path = join(outputDir, name)
    await writeFile(path, image)
    console.log(md5 + '  ' + relative(rootDir, path))
  }
  console.log('截图自检通过：6 张 PNG，6 个不同 MD5，6 个页面均未泄漏翻译键，深色仅用于审片对比。')
  console.log('浏览器夹具验证通过：阶段排期阻塞、判定数据与 ⌘⏎ 采纳 → 绑定回执。')
} finally {
  await browser?.close()
}
