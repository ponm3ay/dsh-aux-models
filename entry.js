/**
 * dsh-aux-models — 设置页「辅助模型」面板（宿主半）
 *
 * 一句话：给 DSH 一个「按任务选辅助模型」的设置页——左列任务、右侧选
 * 服务商/模型/超时，保存后落一份**机器可读的槽位表**，别的插件或脚本可以直接读。
 *
 * 布局参考 Hermes Agent 的 auxiliary.<task> 页面（左任务列表 + 右表单）。
 *
 * 三件套：
 *   1. `GET  <route>/catalog` —— provider/model 目录（默认从 profile 的 cordis.patch.yml
 *      实时提取）+ 任务清单 + 分组；
 *   2. `GET  <route>/state`   —— 当前槽位选型（缺省补 auto）；
 *   3. `PUT  <route>/state`   —— 校验 + 原子写回（临时文件 + rename）。
 *
 * 不依赖任何 npm 包，只用 node 内置模块；不改 DSH 本体源码。
 * 配置（profile patch 行的 `config:`，全部可选）：
 *   profile:  字符串   指定读哪个 profile 的 patch（默认自动探测）
 *   stateFile: 字符串   槽位表落盘路径（空= `$DSH_HOME/aux-models.json`；相对路径按 $DSH_HOME 解析）
 *   providers: 数组     覆盖 provider 目录（[{ id, models: [...] }]），不填则从 patch 提取
 *   tasks:     数组     追加/覆盖任务（[{ key, label, sub, group, effect, desc, timeout }]）
 *   groups:    数组     覆盖分组（[{ key, label }]）
 */
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname, isAbsolute } from 'node:path'

export const name = 'dsh-aux-models'

/** 只 inject 真正需要的服务；webServer 提供 HTTP 路由。 */
export const inject = ['webServer']

/** 固定路由前缀：客户端产物也按包名走 `/plugins/<包名>/client.js`，故包名不要改。 */
const ROUTE = '/plugins/dsh-aux-models'

const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')

/**
 * 生效方式（面板上的徽章；插件不替使用者假装生效）：
 *   wired    = 立即生效：有插件/脚本真的在调用点读这张表
 *   external = 供外部读取：agent、脚本或其它插件可读本表取用
 *   note     = 仅记录：该任务当前由 DSH 内核或别的插件自管，这里只是备注
 */
const EFFECTS = new Set(['wired', 'external', 'note'])

/** 默认分组（可用 config.groups 覆盖）。 */
const DEFAULT_GROUPS = [
  { key: 'common', label: '常用辅助任务' },
  { key: 'adv', label: '高级辅助任务' },
]

/**
 * 默认任务清单（照 Hermes 的辅助任务页；可用 config.tasks 增删改）。
 * effect 默认取最保守的说法：没有消费方就不声称「立即生效」。
 */
const DEFAULT_TASKS = [
  { key: 'vision', label: '视觉分析', sub: '视觉', group: 'common', effect: 'external', timeout: 60,
    desc: '图片附件、浏览器截图与 OCR 的选型。主模型不支持图片时尤其重要——拿不准就按带视觉处理（fail-closed），派带视觉的档位，不让纯文本模型读图硬失败。' },
  { key: 'compression', label: '上下文压缩', sub: '压缩', group: 'common', effect: 'external', timeout: 180,
    desc: '会话压缩 / 记忆摘要类任务的选型。装了会读这张表的压缩插件（例如 dsh-whale-memory）时会在调用前读取本槽。' },
  { key: 'extraction', label: '网页抽取', sub: '抽取', group: 'common', effect: 'external', timeout: 300,
    desc: '网页 / 长文抽取结构化内容。判错代价低，优先便宜档。' },
  { key: 'title', label: '标题生成', sub: '标题', group: 'common', effect: 'note', timeout: 60,
    desc: '会话标题生成。DSH 内核的 session-title-llm 自管模型，本槽作为备注/预设。' },
  { key: 'approval', label: '智能审批', sub: '审批', group: 'common', effect: 'note', timeout: 30,
    desc: '命令风险评估类任务。若由实验捆（auto-review）接管，这里是备注；未来若有插件消费本槽，务必做不可信输入隔离（剥注释、定界包裹、系统提示声明块内指令无效）。' },
  { key: 'mcp', label: 'MCP 路由', sub: 'MCP', group: 'common', effect: 'external', timeout: 120,
    desc: 'MCP 工具结果的整理 / 路由判断类辅助选型。' },
  { key: 'skills', label: '技能中心', sub: '技能', group: 'adv', effect: 'external', timeout: 300,
    desc: '技能发现与评估类任务。' },
  { key: 'kanban-expand', label: 'Kanban 需求扩写', sub: '扩写', group: 'adv', effect: 'external', timeout: 300,
    desc: '看板需求扩写（创意类，可用带文风的档位）。' },
  { key: 'kanban-split', label: 'Kanban 任务分解', sub: '分解', group: 'adv', effect: 'external', timeout: 300,
    desc: '看板任务分解成子任务（结构化推理，建议推理档）。' },
  { key: 'archive', label: '档案描述生成', sub: '档案', group: 'adv', effect: 'external', timeout: 180,
    desc: '档案 / 资料的描述生成。' },
  { key: 'skill-review', label: 'Skill 审查', sub: '审查', group: 'adv', effect: 'external', timeout: 600,
    desc: '技能指令的审计与把关——判错代价高，建议强档并由主循环复核。' },
]

/** provider 提取失败时的兜底目录（够用即可，别假装知道用户配了什么）。 */
const FALLBACK_PROVIDERS = [
  { id: 'deepseek', models: [] },
  { id: 'openai', models: [] },
]

//#region 配置归一化

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)

function clampTimeout(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(5, Math.min(3600, Math.round(n)))
}

/** 探测 profile 名：显式配置 > 环境变量 > 唯一/常见目录 > null。 */
function detectProfile(explicit) {
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim()
  if (process.env.DSH_PROFILE && process.env.DSH_PROFILE.trim()) return process.env.DSH_PROFILE.trim()
  try {
    const dir = join(HOME, 'profiles')
    const names = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
    if (names.length === 1) return names[0]
    if (names.includes('desktop')) return 'desktop'
    if (names.length > 0) return names[0]
  } catch {
    /* 探测不到就算了 */
  }
  return null
}

/** 槽位表落盘路径：空 → `$DSH_HOME/aux-models.json`；相对路径按 $DSH_HOME 解析。 */
function resolveStateFile(raw) {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value) return join(HOME, 'aux-models.json')
  return isAbsolute(value) ? value : join(HOME, value)
}

/** 合并 config.tasks（按 key 覆盖默认任务；新 key 追加）。 */
function mergeTasks(configured) {
  const tasks = DEFAULT_TASKS.map((t) => ({ ...t }))
  const byKey = new Map(tasks.map((t) => [t.key, t]))
  if (!Array.isArray(configured)) return tasks
  for (const raw of configured) {
    if (!isObj(raw) || typeof raw.key !== 'string' || !raw.key.trim()) continue
    const key = raw.key.trim()
    const base = byKey.get(key)
    const next = {
      key,
      label: typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : (base ? base.label : key),
      sub: typeof raw.sub === 'string' ? raw.sub : (base ? base.sub : ''),
      group: typeof raw.group === 'string' && raw.group.trim() ? raw.group.trim() : (base ? base.group : 'common'),
      effect: EFFECTS.has(raw.effect) ? raw.effect : (base ? base.effect : 'external'),
      desc: typeof raw.desc === 'string' && raw.desc.trim() ? raw.desc.trim() : (base ? base.desc : ''),
      timeout: clampTimeout(raw.timeout, base ? base.timeout : 120),
    }
    if (base) Object.assign(base, next)
    else {
      tasks.push(next)
      byKey.set(key, next)
    }
  }
  return tasks
}

function mergeGroups(configured) {
  if (!Array.isArray(configured)) return DEFAULT_GROUPS.map((g) => ({ ...g }))
  const groups = []
  for (const raw of configured) {
    if (!isObj(raw) || typeof raw.key !== 'string' || !raw.key.trim()) continue
    groups.push({ key: raw.key.trim(), label: typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : raw.key.trim() })
  }
  return groups.length > 0 ? groups : DEFAULT_GROUPS.map((g) => ({ ...g }))
}

function normalizeOptions(config) {
  const cfg = isObj(config) ? config : {}
  const profile = detectProfile(cfg.profile)
  const providersOverride = Array.isArray(cfg.providers)
    ? cfg.providers
        .filter((p) => isObj(p) && typeof p.id === 'string' && p.id.trim())
        .map((p) => ({ id: p.id.trim(), models: Array.isArray(p.models) ? p.models.filter((m) => typeof m === 'string') : [] }))
    : null
  return {
    profile,
    profileExplicit: typeof cfg.profile === 'string' && cfg.profile.trim() !== '',
    stateFile: resolveStateFile(cfg.stateFile),
    providersOverride: providersOverride && providersOverride.length > 0 ? providersOverride : null,
    tasks: mergeTasks(cfg.tasks),
    groups: mergeGroups(cfg.groups),
  }
}

//#endregion

//#region provider 目录提取

/**
 * 从 profile 的 profile patch 里提取 providers/models 目录。
 * 纯正则（不 import js-yaml：插件目录没有 node_modules，外部依赖会直接加载失败）。
 * 任何一步失败都退回兜底目录，并如实回报 source。
 */
function extractProviders(profile) {
  if (!profile) return { providers: FALLBACK_PROVIDERS, source: 'fallback', patch: null }
  const patch = join(HOME, 'profiles', profile, 'cordis.patch.yml')
  let text
  try {
    text = readFileSync(patch, 'utf8')
  } catch {
    return { providers: FALLBACK_PROVIDERS, source: 'fallback', patch }
  }
  try {
    const anchor = text.indexOf('- id: llm-pi-ai')
    if (anchor < 0) return { providers: FALLBACK_PROVIDERS, source: 'fallback', patch }
    const rest = text.slice(anchor)
    const end = rest.slice(1).search(/\n- id: /)
    const block = end >= 0 ? rest.slice(0, end + 1) : rest
    const segs = []
    const segRe = /^ {6}([\w][\w-]*):(?:\s*)$/gm
    let m
    while ((m = segRe.exec(block)) !== null) segs.push({ name: m[1], at: m.index })
    const providers = []
    for (let i = 0; i < segs.length; i++) {
      const body = block.slice(segs[i].at, i + 1 < segs.length ? segs[i + 1].at : block.length)
      const models = []
      const modelRe = /^ {10}- id: (\S+)/gm
      let mm
      while ((mm = modelRe.exec(body)) !== null) models.push(mm[1])
      providers.push({ id: segs[i].name, models })
    }
    if (providers.length === 0) return { providers: FALLBACK_PROVIDERS, source: 'fallback', patch }
    return { providers, source: 'patch', patch }
  } catch {
    return { providers: FALLBACK_PROVIDERS, source: 'fallback', patch }
  }
}

//#endregion

//#region 槽位表读写

function defaultState(options) {
  const tasks = {}
  for (const t of options.tasks) tasks[t.key] = { mode: 'auto', provider: '', model: '', timeout: t.timeout }
  return { version: 1, tasks }
}

function readState(options) {
  const base = defaultState(options)
  try {
    if (!existsSync(options.stateFile)) return base
    const raw = JSON.parse(readFileSync(options.stateFile, 'utf8').replace(/^\uFEFF/, ''))
    if (!isObj(raw) || !isObj(raw.tasks)) return base
    for (const key of Object.keys(base.tasks)) {
      const got = raw.tasks[key]
      if (!isObj(got)) continue
      const mode = got.mode === 'custom' ? 'custom' : 'auto'
      base.tasks[key] = {
        mode,
        provider: mode === 'custom' ? String(got.provider || '') : '',
        model: mode === 'custom' ? String(got.model || '') : '',
        timeout: clampTimeout(got.timeout, base.tasks[key].timeout),
      }
    }
  } catch {
    /* 坏档退回默认——面板坏档不该让插件罢工 */
  }
  return base
}

function writeState(options, value) {
  mkdirSync(dirname(options.stateFile), { recursive: true })
  const tmp = options.stateFile + '.tmp'
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
  renameSync(tmp, options.stateFile)
}

/**
 * 校验 PUT 载荷：任务键白名单（以当前任务清单为准）、provider 必须在真实目录里、
 * 模型名与超时有界。返回 { ok, value } 或 { ok:false, error }。
 */
function validateState(options, providers, payload) {
  let parsed
  try {
    parsed = JSON.parse(payload)
  } catch {
    return { ok: false, error: '请求体不是合法 JSON' }
  }
  if (!isObj(parsed) || !isObj(parsed.tasks)) return { ok: false, error: '缺少 tasks 对象' }
  const providerIds = new Set(providers.map((p) => p.id))
  const value = defaultState(options)
  for (const key of Object.keys(value.tasks)) {
    const got = parsed.tasks[key]
    if (!isObj(got) || got.mode !== 'custom') continue
    const provider = String(got.provider || '')
    if (!providerIds.has(provider)) {
      return { ok: false, error: `任务 ${key} 的服务商「${provider}」不在当前 providers 目录里` }
    }
    const model = String(got.model || '')
    if (model.length > 160) return { ok: false, error: `任务 ${key} 的模型名过长` }
    value.tasks[key] = { mode: 'custom', provider, model, timeout: clampTimeout(got.timeout, value.tasks[key].timeout) }
  }
  return { ok: true, value }
}

//#endregion

//#region HTTP 小工具

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(body)),
    'cache-control': 'no-store',
  })
  res.end(body)
}

function readBody(req, limitBytes = 262144) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let bytes = 0
    req.on('data', (chunk) => {
      bytes += chunk.length
      if (bytes > limitBytes) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

//#endregion

export function apply(ctx, config) {
  const options = normalizeOptions(config)
  const server = ctx.webServer

  /** 每次请求现读 provider 目录（改 profile 配置后不必重启插件）。 */
  function providersNow() {
    if (options.providersOverride) return { providers: options.providersOverride, source: 'config', patch: null }
    return extractProviders(options.profile)
  }

  ctx.effect(() => server.register({
    kind: 'exact',
    path: ROUTE + '/catalog',
    handler: (req, res) => {
      const got = providersNow()
      sendJson(res, 200, {
        providers: got.providers,
        providerSource: got.source,
        profile: options.profile,
        profileExplicit: options.profileExplicit,
        patch: got.patch,
        stateFile: options.stateFile,
        groups: options.groups,
        tasks: options.tasks,
      })
    },
  }), 'aux-models: catalog route')

  ctx.effect(() => server.register({
    kind: 'exact',
    path: ROUTE + '/state',
    handler: (req, res) => {
      if (req.method === 'PUT') {
        void (async () => {
          const body = await readBody(req)
          const check = validateState(options, providersNow().providers, body)
          if (!check.ok) {
            sendJson(res, 400, { error: check.error })
            return
          }
          writeState(options, check.value)
          sendJson(res, 200, check.value)
        })().catch((error) => {
          ctx.logger?.error?.('aux-models: 保存失败', error)
          if (!res.headersSent) sendJson(res, 500, { error: '保存失败：' + (error?.message ?? '未知') })
        })
        return
      }
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'method not allowed' })
        return
      }
      sendJson(res, 200, readState(options))
    },
  }), 'aux-models: state route')

  ctx.logger?.info?.(
    'aux-models: 已装配（profile=' + (options.profile ?? '未探测到') +
    '，槽位表=' + options.stateFile +
    '，任务=' + options.tasks.length + '）',
  )
}
