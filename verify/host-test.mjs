// 离线自测：不需要 DSH 进程、不联网、不碰真实家目录。
//
//   node verify/host-test.mjs
//
// 做法：把 DSH_HOME 指向临时目录 + 造一个假 profile patch，然后 import 宿主半、
// mock 一个 webServer，把三条路径当成黑盒打一遍（含校验与钳制）。
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'dsh-aux-models-test-'))
process.env.DSH_HOME = home
process.env.DSH_PROFILE = 'testprofile'

// 假 profile patch：一个 llm-pi-ai 段，两家 provider
const profileDir = join(home, 'profiles', 'testprofile')
mkdirSync(profileDir, { recursive: true })
writeFileSync(join(profileDir, 'cordis.patch.yml'), [
  '- id: other',
  '  name: something',
  '- id: llm-pi-ai',
  '  name: "@deepseek-ai/dsh-llm-pi-ai"',
  '  config:',
  '    providers:',
  '      alpha:',
  '        models:',
  '          - id: alpha-fast',
  '          - id: alpha-pro',
  '      beta:',
  '        models:',
  '          - id: beta-mini',
  '- id: tail',
  '  name: tail',
  '',
].join('\n'))

const { apply } = await import('file://' + join(import.meta.dirname, '..', 'entry.js').replaceAll('\\', '/'))

let pass = 0
let fail = 0
const ok = (cond, label) => {
  if (cond) { pass++; console.log('  PASS', label) } else { fail++; console.log('  FAIL', label) }
}

function mount(config) {
  const routes = []
  const logs = []
  apply({ webServer: { register: (r) => routes.push(r) }, effect: (fn) => fn(), logger: { info: (m) => logs.push(m), error: () => {} } }, config)
  return { routes, logs }
}
function mockRes() {
  const res = { code: 0, body: '' }
  res.writeHead = (c) => { res.code = c }
  res.end = (b) => { res.body = b ?? '' }
  return res
}
function call(routes, path, method, body) {
  const route = routes.find((r) => r.path === path)
  if (!route) throw new Error('未注册路由 ' + path)
  const res = mockRes()
  const req = { method, url: path, headers: {} }
  req.on = body === undefined
    ? () => req
    : (ev, cb) => { if (ev === 'data') cb(Buffer.from(body)); if (ev === 'end') cb(); return req }
  route.handler(req, res)
  return res
}
const tick = () => new Promise((r) => setTimeout(r, 30))

console.log('=== 1. catalog：provider 目录从 profile patch 提取 ===')
const { routes, logs } = mount()
const cat = JSON.parse(call(routes, '/plugins/dsh-aux-models/catalog', 'GET').body)
ok(cat.providerSource === 'patch', 'provider 来源 = patch')
ok(cat.providers.map((p) => p.id).join(',') === 'alpha,beta', 'provider 列表 = alpha,beta')
ok(cat.providers.find((p) => p.id === 'alpha').models.length === 2, 'alpha 模型数 = 2')
ok(cat.profile === 'testprofile', 'profile 探测 = testprofile')
ok(cat.tasks.length === 11, '默认任务数 = 11')
ok(cat.groups.length === 2, '默认分组数 = 2')
ok(cat.stateFile === join(home, 'aux-models.json'), '默认落盘 = $DSH_HOME/aux-models.json')
ok(logs.some((m) => m.includes('已装配')), '装配日志已写')

console.log('=== 2. state：初始全自动 ===')
const st = JSON.parse(call(routes, '/plugins/dsh-aux-models/state', 'GET').body)
ok(Object.values(st.tasks).every((t) => t.mode === 'auto'), '初始 11 个任务全 auto')

console.log('=== 3. PUT：显式指定 + 落盘 + 回读 ===')
const put = JSON.parse(JSON.stringify(st))
put.tasks.vision = { mode: 'custom', provider: 'alpha', model: 'alpha-pro', timeout: 90 }
const r3 = call(routes, '/plugins/dsh-aux-models/state', 'PUT', JSON.stringify(put))
await tick()
ok(r3.code === 200, 'PUT 合法 → 200')
ok(existsSync(cat.stateFile), '槽位表已落盘')
const back = JSON.parse(call(routes, '/plugins/dsh-aux-models/state', 'GET').body)
ok(back.tasks.vision.provider === 'alpha' && back.tasks.vision.model === 'alpha-pro' && back.tasks.vision.timeout === 90, '回读一致')
ok(back.tasks.compression.mode === 'auto', '未指定的任务不受影响')

console.log('=== 4. 校验与钳制 ===')
const bad = JSON.parse(JSON.stringify(back))
bad.tasks.vision = { mode: 'custom', provider: 'nope', model: 'x', timeout: 60 }
const r4 = call(routes, '/plugins/dsh-aux-models/state', 'PUT', JSON.stringify(bad))
await tick()
ok(r4.code === 400 && /不在当前 providers/.test(r4.body), '未知 provider → 400')
const r5 = call(routes, '/plugins/dsh-aux-models/state', 'PUT', '{oops')
await tick()
ok(r5.code === 400, '坏 JSON → 400')
const over = JSON.parse(JSON.stringify(back))
over.tasks.vision = { mode: 'custom', provider: 'alpha', model: 'alpha-fast', timeout: 99999 }
const r6 = call(routes, '/plugins/dsh-aux-models/state', 'PUT', JSON.stringify(over))
await tick()
ok(JSON.parse(call(routes, '/plugins/dsh-aux-models/state', 'GET').body).tasks.vision.timeout === 3600, '超时上限钳到 3600')

console.log('=== 5. 复原 ===')
const r7 = call(routes, '/plugins/dsh-aux-models/state', 'PUT', JSON.stringify(st))
await tick()
ok(r7.code === 200 && Object.values(JSON.parse(call(routes, '/plugins/dsh-aux-models/state', 'GET').body).tasks).every((t) => t.mode === 'auto'), '全部恢复为自动')

console.log('=== 6. 配置覆盖（providers / tasks / stateFile / profile）===')
const custom = mount({
  providers: [{ id: 'gamma', models: ['g1'] }],
  tasks: [{ key: 'vision', label: '看图', effect: 'wired' }, { key: 'my-task', label: '自定义任务', group: 'adv', timeout: 42 }],
  stateFile: 'custom/state.json',
})
const cat2 = JSON.parse(call(custom.routes, '/plugins/dsh-aux-models/catalog', 'GET').body)
ok(cat2.providerSource === 'config' && cat2.providers[0].id === 'gamma', 'providers 覆盖生效')
ok(cat2.tasks.find((t) => t.key === 'vision').label === '看图' && cat2.tasks.find((t) => t.key === 'vision').effect === 'wired', '任务覆盖生效')
ok(cat2.tasks.some((t) => t.key === 'my-task' && t.timeout === 42), '自定义任务追加生效')
ok(cat2.tasks.length === 12, '任务数 = 12')
ok(cat2.stateFile === join(home, 'custom', 'state.json'), 'stateFile 相对路径按 $DSH_HOME 解析')

console.log('=== 7. 坏档容错 ===')
writeFileSync(cat.stateFile, '{ 这不是 JSON')
const st7 = JSON.parse(call(routes, '/plugins/dsh-aux-models/state', 'GET').body)
ok(Object.values(st7.tasks).every((t) => t.mode === 'auto'), '坏槽位表 → 退回默认，不抛错')

rmSync(home, { recursive: true, force: true })
console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail === 0 ? 0 : 1)
