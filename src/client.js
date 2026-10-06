// dsh-aux-models — 浏览器半（设置页「辅助模型」面板）。
//
// 布局：左列任务（按 catalog.groups 分组，行尾徽章显示 自动 / provider/model），
// 右侧选中任务的表单（说明 + 服务商 + 模型 + 超时 + 保存 / 恢复为自动），顶栏「全部恢复为自动」。
//
// 契约（改动前先看这几条，都是踩过的）：
//   * `ctx.slots.inject('settings.section', cb)` 等 owner；
//     `ctx.slots.register({ name, id, order, label }, Component)` 落位，id 用新的（别占用别人的格子）。
//   * 只 inject `slots`：在 apply 的同步阶段读别的服务会抛，整页打不开。
//   * 组件是标准 React 组件；`require('react')` 是每个动态包都有的基线词，无需声明依赖。
//   * 数据走 HTTP（`/plugins/dsh-aux-models/*`），不写会话日志、不进模型上下文。
//   * CSS 串里不出现反引号；无 JSX、无打包器——lib/client.js 就是本文件套壳（见 build-client.mjs）。

const React = require('react')

const h = React.createElement
const ROUTE = '/plugins/dsh-aux-models'

/** 生效方式徽章文案（与宿主 EFFECTS 对齐；不替使用者假装生效）。 */
const EFFECT = {
  wired: { text: '立即生效', cls: 'live' },
  external: { text: '供外部读取', cls: 'cmd' },
  note: { text: '仅记录', cls: 'ref' },
}

const STYLE_ID = 'dsh-aux-models-style'

const CSS = [
  '.dam-wrap{display:flex;gap:16px;align-items:flex-start;min-height:420px}',
  '.dam-left{width:290px;flex:none;border:1px solid var(--dsh-border,#2a2a2a);border-radius:10px;overflow:hidden}',
  '.dam-group{padding:8px 14px;font-size:12px;opacity:.55;background:var(--dsh-bg-elev,#1a1a1a)}',
  '.dam-item{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:11px 14px;cursor:pointer;border-bottom:1px solid var(--dsh-border,#2a2a2a)}',
  '.dam-item:last-child{border-bottom:none}',
  '.dam-item:hover{background:var(--dsh-bg-hover,#222)}',
  '.dam-item.on{background:var(--dsh-bg-active,#262626)}',
  '.dam-item-t{display:flex;flex-direction:column;gap:2px;min-width:0}',
  '.dam-item-t b{font-size:14px;font-weight:600}',
  '.dam-item-t span{font-size:11px;opacity:.5}',
  '.dam-badge{font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid var(--dsh-border,#333);white-space:nowrap}',
  '.dam-badge.auto{opacity:.6}',
  '.dam-badge.set{border-color:#4a9;color:#4a9}',
  '.dam-right{flex:1;min-width:0;border:1px solid var(--dsh-border,#2a2a2a);border-radius:10px;padding:20px}',
  '.dam-desc{font-size:13px;line-height:1.7;opacity:.75;margin:0 0 18px}',
  '.dam-eff{display:inline-block;font-size:11px;padding:2px 8px;border-radius:4px;margin-left:8px;vertical-align:middle}',
  '.dam-eff.live{background:#123d2e;color:#5ddba8}',
  '.dam-eff.cmd{background:#3d3412;color:#dbcb5d}',
  '.dam-eff.ref{background:#333;color:#999}',
  '.dam-field{margin-bottom:16px}',
  '.dam-field label{display:block;font-size:13px;font-weight:600;margin-bottom:6px}',
  '.dam-field .hint{font-size:12px;opacity:.55;margin-top:6px;line-height:1.6}',
  '.dam-field select,.dam-field input{width:100%;box-sizing:border-box;padding:9px 12px;font-size:13px;border-radius:8px;border:1px solid var(--dsh-border,#333);background:var(--dsh-bg-input,#111);color:inherit}',
  '.dam-field input:disabled{opacity:.45}',
  '.dam-actions{display:flex;gap:10px;margin-top:20px;align-items:center}',
  '.dam-btn{padding:9px 18px;font-size:13px;border-radius:8px;cursor:pointer;border:1px solid var(--dsh-border,#333);background:var(--dsh-bg-elev,#1a1a1a);color:inherit}',
  '.dam-btn.primary{background:#2563eb;border-color:#2563eb;color:#fff}',
  '.dam-btn.primary:disabled{opacity:.5;cursor:default}',
  '.dam-btn.ghost{background:transparent}',
  '.dam-saved{font-size:12px;color:#5ddba8}',
  '.dam-err{font-size:12px;color:#e57373}',
  '.dam-note{margin-top:18px;padding:10px 12px;border-radius:8px;background:var(--dsh-bg-elev,#1a1a1a);font-size:12px;line-height:1.7;opacity:.7}',
  '.dam-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}',
  '.dam-top h3{margin:0;font-size:15px}',
  '.dam-meta{margin-top:10px;font-size:11px;opacity:.45;line-height:1.7;word-break:break-all}',
].join('')

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = CSS
  document.head.appendChild(el)
}

function AuxPanel() {
  const [catalog, setCatalog] = React.useState(null)
  const [state, setState] = React.useState(null)
  const [selected, setSelected] = React.useState(null)
  const [draft, setDraft] = React.useState(null)
  const [saving, setSaving] = React.useState(false)
  const [msg, setMsg] = React.useState(null)

  React.useEffect(() => {
    ensureStyle()
    let alive = true
    Promise.all([
      fetch(ROUTE + '/catalog').then((r) => r.json()),
      fetch(ROUTE + '/state').then((r) => r.json()),
    ])
      .then(([cat, st]) => {
        if (!alive) return
        setCatalog(cat)
        setState(st)
        const first = (cat.tasks || [])[0]
        if (first) setSelected(first.key)
      })
      .catch(() => {
        if (alive) setMsg({ kind: 'err', text: '读取配置失败——宿主半可能未加载，刷新页面重试' })
      })
    return () => { alive = false }
  }, [])

  React.useEffect(() => {
    if (!state || !selected) return
    const t = state.tasks[selected]
    if (!t) return
    setDraft({ mode: t.mode, provider: t.provider || '', model: t.model || '', timeout: String(t.timeout) })
    setMsg(null)
  }, [state, selected])

  if (!catalog || !draft || !selected) {
    return h('div', { className: 'dam-wrap' }, h('p', { style: { opacity: .6 } }, '正在读取辅助模型配置…'))
  }

  const tasks = catalog.tasks || []
  const groups = catalog.groups && catalog.groups.length ? catalog.groups : [{ key: 'common', label: '任务' }]
  const current = state.tasks[selected]
  const meta = tasks.find((t) => t.key === selected)
  const isCustom = draft.mode === 'custom'
  const dirty = current && (
    current.mode !== draft.mode ||
    (draft.mode === 'custom' && (current.provider !== draft.provider || current.model !== draft.model)) ||
    String(current.timeout) !== String(draft.timeout)
  )

  function badgeFor(key) {
    const t = state.tasks[key]
    if (!t || t.mode !== 'custom') return h('span', { className: 'dam-badge auto' }, '自动')
    return h('span', { className: 'dam-badge set' }, t.provider + (t.model ? '/' + t.model : ''))
  }

  function put(next, okText) {
    setSaving(true)
    setMsg(null)
    fetch(ROUTE + '/state', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(next),
    })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(body.error || ('HTTP ' + r.status))
        setState(body)
        setMsg({ kind: 'ok', text: okText })
      })
      .catch((err) => setMsg({ kind: 'err', text: String(err.message || err) }))
      .finally(() => setSaving(false))
  }

  function save() {
    const next = JSON.parse(JSON.stringify(state))
    next.tasks[selected] = {
      mode: draft.mode,
      provider: draft.mode === 'custom' ? draft.provider : '',
      model: draft.mode === 'custom' ? draft.model : '',
      timeout: Number(draft.timeout) || 60,
    }
    put(next, '已保存')
  }

  function resetOne() {
    setDraft({ mode: 'auto', provider: '', model: '', timeout: String(meta ? meta.timeout : 60) })
    setMsg(null)
  }

  function resetAll() {
    if (!window.confirm('把所有任务恢复为「自动」？')) return
    const next = JSON.parse(JSON.stringify(state))
    for (const t of tasks) next.tasks[t.key] = { mode: 'auto', provider: '', model: '', timeout: t.timeout }
    put(next, '已全部恢复为自动')
  }

  const eff = EFFECT[meta ? meta.effect : 'external'] || EFFECT.external
  const providerOptions = [{ id: '', label: 'Auto 自动选择 · auto' }].concat(
    (catalog.providers || []).map((p) => ({ id: p.id, label: p.id + ' · ' + p.id })),
  )
  const modelCandidates = ((catalog.providers || []).find((p) => p.id === draft.provider) || {}).models || []

  return h('div', null,
    h('div', { className: 'dam-top' },
      h('h3', null, '辅助模型按任务生效'),
      h('button', { className: 'dam-btn ghost', onClick: resetAll, disabled: saving }, '全部恢复为自动'),
    ),
    h('p', { style: { fontSize: '13px', opacity: .65, marginTop: 0, lineHeight: 1.7 } },
      '这里配置的是每个辅助任务的选型槽位。「自动」＝不干预，交给默认路由；显式指定后，该任务固定走选中的 provider/model。',
      h('br'),
      '选型落盘一份机器可读的 JSON，其它插件 / 脚本可以直接读取（见 README 的集成契约）。',
    ),
    h('div', { className: 'dam-wrap' },
      h('div', { className: 'dam-left' },
        groups.map((g) =>
          h(React.Fragment, { key: g.key },
            h('div', { className: 'dam-group' }, g.label),
            tasks.filter((t) => t.group === g.key).map((t) =>
              h('div', {
                key: t.key,
                className: 'dam-item' + (t.key === selected ? ' on' : ''),
                onClick: () => setSelected(t.key),
              },
                h('div', { className: 'dam-item-t' }, h('b', null, t.label), h('span', null, t.sub)),
                badgeFor(t.key),
              ),
            ),
          ),
        ),
      ),
      h('div', { className: 'dam-right' },
        h('p', { className: 'dam-desc' }, (meta ? meta.desc : ''), h('span', { className: 'dam-eff ' + eff.cls }, eff.text)),
        h('div', { className: 'dam-field' },
          h('label', null, '服务商'),
          h('select', {
            value: isCustom ? draft.provider : '',
            onChange: (e) => {
              const v = e.target.value
              setDraft((d) => ({ ...d, provider: v, model: '', mode: v ? 'custom' : 'auto' }))
            },
          }, providerOptions.map((o) => h('option', { key: o.id || '__auto', value: o.id }, o.label))),
          h('div', { className: 'hint' }, isCustom
            ? '显式指定后该任务固定走此服务商；选回 Auto 即恢复「不干预」。'
            : '自动模式：本面板不改写该任务的模型选择。'),
        ),
        h('div', { className: 'dam-field' },
          h('label', null, '模型'),
          h('input', {
            list: 'dam-models-' + selected,
            value: isCustom ? draft.model : '',
            disabled: !isCustom,
            placeholder: '自动模式下不需要填写模型',
            onChange: (e) => setDraft((d) => ({ ...d, model: e.target.value })),
          }),
          h('datalist', { id: 'dam-models-' + selected }, modelCandidates.map((m) => h('option', { key: m, value: m }))),
        ),
        h('div', { className: 'dam-field' },
          h('label', null, '调用超时（秒）'),
          h('input', {
            type: 'number', min: 5, max: 3600,
            value: draft.timeout,
            onChange: (e) => setDraft((d) => ({ ...d, timeout: e.target.value })),
          }),
        ),
        h('div', { className: 'dam-actions' },
          h('button', { className: 'dam-btn primary', onClick: save, disabled: saving || !dirty }, saving ? '保存中…' : '保存此辅助任务'),
          h('button', { className: 'dam-btn ghost', onClick: resetOne, disabled: saving }, '恢复为自动'),
          msg ? h('span', { className: msg.kind === 'ok' ? 'dam-saved' : 'dam-err' }, msg.text) : null,
        ),
        h('div', { className: 'dam-note' },
          '生效方式 · ' + eff.text + '：',
          meta && meta.effect === 'wired'
            ? '已有插件在调用点读取本槽（保存后即生效）。'
            : meta && meta.effect === 'external'
              ? '供外部读取：agent、脚本或其它插件读本表取用。'
              : '仅记录：该任务当前由 DSH 内核或别的插件自管，这里作为备注/预设。',
        ),
        h('div', { className: 'dam-meta' },
          'profile: ' + (catalog.profile || '未探测到') + (catalog.profileExplicit ? '（配置指定）' : '（自动探测）') +
          ' · provider 目录来源: ' + (catalog.providerSource || '未知') +
          h('br'), '槽位表: ' + (catalog.stateFile || ''),
        ),
      ),
    ),
  )
}

exports.inject = ['slots']
exports.apply = function apply(ctx) {
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      { name: 'settings.section', id: 'aux-models', order: 118, label: '辅助模型' },
      AuxPanel,
    ),
  )
  try {
    console.info('[aux-models] 已注册设置页「辅助模型」（settings.section id=aux-models order=118）')
  } catch {
    /* 没有控制台也要活 */
  }
}
