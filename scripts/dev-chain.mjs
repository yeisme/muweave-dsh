#!/usr/bin/env node
/**
 * MuWeave 开发链路驱动器 · 状态读取器
 *
 * 只读、确定性：报告当前状态并给出一行 NEXT ACTION。
 * 定时任务读这一屏就能决定下一步，不用自己 grep。
 *
 * 用法：node scripts/dev-chain.mjs [--json]
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sh = (cmd, fallback = '') => {
  try { return execFileSync('bash', ['-lc', cmd], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() }
  catch { return fallback }
}
const has = (rel, needle) => {
  const p = resolve(root, rel)
  if (!existsSync(p)) return false
  try { return readFileSync(p, 'utf8').includes(needle) } catch { return false }
}
const countIn = (dir, needle) => sh(`grep -rl ${JSON.stringify(needle)} ${dir} 2>/dev/null | grep -v node_modules | wc -l`) || '0'

// ---------- 仓库 ----------
sh('git fetch origin develop -q 2>/dev/null')
const head = sh('git rev-parse --short HEAD')
const remote = sh('git rev-parse --short origin/develop')
const dirty = Number(sh("git status --porcelain | grep -vc '^??'") || 0)
const ahead = Number(sh('git rev-list --count origin/develop..HEAD') || 0)
const behind = Number(sh('git rev-list --count HEAD..origin/develop') || 0)

// ---------- 工单 ----------
// 每项：marker 命中即视为「有实现」，靠单测数确认是否收口
const items = [
  {
    id: 'P2-A', name: 'bot.delegate + DelegationRuleV1 五道闸', core: true,
    checks: [
      ['bot-task/protocol.ts 有 bot.delegate', () => has('packages/dsh-muweave-core/src/bot-task/protocol.ts', 'bot.delegate')],
      ['DelegationRuleV1 类型', () => countIn('packages/dsh-muweave-core/src', 'DelegationRuleV1') !== '0'],
      ['delegate 测试', () => existsSync(resolve(root, 'tests/bot-delegate.test.ts'))],
    ],
  },
  {
    id: 'P2-B', name: 'manager session 绑定与恢复', core: false,
    checks: [
      ['sessionBinding 持久化', () => countIn('packages/dsh-muweave-core/src', 'sessionBinding') !== '0' || countIn('packages/dsh-muweave-core/src/bot-task', 'sessionRef') !== '0'],
      ['session 恢复测试', () => existsSync(resolve(root, 'tests/bot-sessions.test.ts'))],
    ],
  },
  {
    id: 'P2-C', name: 'kit 窄 agent 工具（4 个）', core: false,
    checks: [
      ['muweave_bot_roster', () => countIn('packages/dsh-muweave-kit', 'muweave_bot_roster') !== '0'],
      ['muweave_task_delegate', () => countIn('packages/dsh-muweave-kit', 'muweave_task_delegate') !== '0'],
      ['muweave_task_status', () => countIn('packages/dsh-muweave-kit', 'muweave_task_status') !== '0'],
      ['muweave_task_trace', () => countIn('packages/dsh-muweave-kit', 'muweave_task_trace') !== '0'],
    ],
  },
  {
    id: 'P2-D', name: '@bot-id 入口 + job 卡 requester.botId', core: false,
    checks: [
      ['@bot-id 解析', () => countIn('packages/dsh-muweave-core/src', 'botId') !== '0' && countIn('packages/dsh-muweave-core/src/client', '@bot') !== '0'],
      ['requester 展示', () => countIn('packages/dsh-muweave-core/src/client', 'requester') !== '0'],
    ],
  },
]

for (const it of items) {
  it.done = it.checks.every(([, fn]) => fn())
  it.partial = !it.done && it.checks.some(([, fn]) => fn())
  it.missing = it.checks.filter(([, fn]) => !fn()).map(([n]) => n)
}

// ---------- 门禁 ----------
const tcOk = sh('npx tsc -b tsconfig.json >/tmp/dc-tc.log 2>&1; echo $?') === '0'
const tcErrors = Number(sh("grep -c 'error TS' /tmp/dc-tc.log 2>/dev/null || echo 0") || 0)

// ---------- agent ----------
const panes = sh(`~/.local/bin/herdr pane list 2>/dev/null | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin)
except Exception:
    print(''); raise SystemExit
rows=[(p['pane_id'],p.get('agent_status') or '?',(p.get('terminal_title') or '')[:40]) for p in d['result']['panes'] if 'muweave-dsh' in ((p.get('cwd') or '')+(p.get('terminal_title') or '')) and (p.get('agent_status') or '') in ('working','blocked','reconnecting')]
print('|'.join(f'{a} {b} {c}' for a,b,c in rows))
"`, '')
const running = panes.split('|').filter(Boolean)

// ---------- 决策 ----------
const corePending = items.find((i) => i.core && !i.done)
const sidePending = items.filter((i) => !i.core && !i.done)
const anyRunning = running.length > 0

let action, why
if (dirty > 0) {
  action = 'COMMIT'; why = `${dirty} 个源码改动未提交`
} else if (!tcOk) {
  action = 'FIX'; why = `tsc 有 ${tcErrors} 个错误`
} else if (anyRunning) {
  action = 'WAIT'; why = `${running.length} 个 agent 在跑`
} else if (corePending) {
  action = `DISPATCH ${corePending.id}`; why = `核心项未完成：${corePending.name}`
} else if (sidePending.length) {
  action = `DISPATCH ${sidePending.map((i) => i.id).join('+')}`; why = `${sidePending.length} 个并行项未完成`
} else {
  action = 'DELIVER'; why = '全部工单完成'
}

const out = { head, remote, dirty, ahead, behind, tcOk, tcErrors, items: items.map(({ id, name, done, partial, missing }) => ({ id, name, done, partial, missing })), running, action, why }

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(out, null, 2))
  process.exit(0)
}

const pad = (s, n) => String(s).padEnd(n)
console.log(`MuWeave dev-chain  ${head}  →  ${remote}${head !== remote ? '  (不同步!)' : ''}`)
console.log(`  工作区 ${dirty} 改动 | 领先 ${ahead} 落后 ${behind} | tsc ${tcOk ? 'ok' : `FAIL(${tcErrors})`}`)
console.log('')
for (const it of items) {
  const mark = it.done ? 'DONE' : it.partial ? 'PART' : '    '
  console.log(`  ${mark} ${pad(it.id, 5)} ${it.name}${it.missing.length ? `  · 缺 ${it.missing.join(' / ')}` : ''}`)
}
console.log('')
console.log(`  agent: ${running.length ? running.join(' ; ') : '无'}`)
console.log('')
console.log(`  NEXT ACTION  ${action}`)
console.log(`               ${why}`)
process.exit(0)
