# AGENTS.md — dsh-aux-models（维护说明）

给下一个接手的人/代理：这个插件靠哪些 DSH 契约活着、哪些不变量一破就静默失效、怎么证明改动安全。

## 它是什么

一个 DSH 插件，给设置页加一页「辅助模型」：按任务选 provider/model/超时，落一份机器可读的槽位表。
**它不接管 DSH 内核的模型选择**，也不声称生效——面板上每个任务都标着自己属于哪一种
（立即生效 / 供外部读取 / 仅记录）。

| 半体 | 文件 | 职责 |
|---|---|---|
| 宿主（Node） | `entry.js` | 两条 exact 路由：`/catalog`（任务清单 + provider 目录）、`/state`（GET 读 / PUT 校验后原子写） |
| 浏览器 | `src/client.js` → `lib/client.js` | 注册 `settings.section`（id `aux-models`，order 118），渲染左任务/右表单 |

无 npm 依赖：宿主半只用 node 内置模块；浏览器半只用 `require('react')`（动态包的基线词）。

## 靠哪几条 DSH 契约

1. **`ctx.slots.inject(key, cb)` + `ctx.slots.register({ name, id, order, label }, Component)`**
   是客户端唯一的落位方式。`inject` 会等 owner（设置页 shell 声明 `settings.section`）；
   **id 必须用新格子**，占用已存在的 id 会顶掉别人的设置页且不报错。
2. **宿主半只 inject `webServer`**；`ctx.effect(() => server.register({ kind, path, handler }), label)`
   注册路由，卸载时自动撤销。
3. **`apply(ctx, config)` 的第二个参数就是 profile patch 行里的 `config:`**（本插件没有声明
   Config schema，所以拿到的是原始对象，所有字段都要自己防御性校验）。
4. **客户端产物按包名取**：`/plugins/<包名>/client.js`。所以 `package.json.name`、
   `cordis.patch.yml` 的 `name`、`src/client.js` 里的 `ROUTE` 三者必须一致。
5. **bundle 与 profile patch 行二选一**；两条同 id 的插入行会被 client-modules 表拒绝。

## 不变量（破了会静默失效）

| 规矩 | 破了会怎样 |
|---|---|
| `provider` 必须在当前 provider 目录里才允许写 | 面板会存下点不出模型的路由；校验层因此拒绝未知 provider（400） |
| 槽位表写入用「临时文件 + rename」 | 并发/断电时半截文件被读进面板，且消费方插件可能读到坏 JSON |
| 读档失败/坏 JSON 一律退回默认态 | 面板坏档会让插件罢工，连带 500 |
| 路由前缀固定 `/plugins/dsh-aux-models` | 改了包名没同步 `ROUTE` → 客户端 404，页面空白 |
| 客户端 CSS 串里不出现反引号 | 构建串提前结束，产物等于没改 |
| `lib/client.js` 必须由 `build-client.mjs` 生成 | 手改产物会在下次构建被覆盖；改源码不重建则改动「看起来没效果」 |
| provider 目录正则提取失败要如实报 `source` | 假装知道用户的 provider，面板会给出错的候选 |

## 改动 → 跑什么

| 改了 | 验证 |
|---|---|
| `src/client.js` | `node build-client.mjs` → 刷新页面；必要时 `cordis_inspect_query(client/Slots)` 看 `settings.section` 里 `aux-models` 是否 active |
| `entry.js` | profile patch 被 watch，会自动重组；`node verify/host-test.mjs` 必须全绿 |
| 任务清单/配置字段 | 上面那条自测里有「配置覆盖」用例，跟着扩展 |
| 只改文档 | 无 |

CI（`.github/workflows/ci.yml`）跑：语法、`package.json` 元数据、离线自测、密钥扫描、个人绝对路径检查。

## 探测与兜底的行为约定

- profile 名：显式配置 → `DSH_PROFILE` → 唯一 profile → `desktop` → 目录列表第一个。
- provider 目录：配置 `providers` → profile patch 的 `llm-pi-ai` 段正则提取 → 内置兜底，
  并回报 `providerSource`（`config` / `patch` / `fallback`）供面板显示。
- 槽位表默认 `$DSH_HOME/aux-models.json`；**消费方插件（例如 dsh-whale-memory）约定读哪个路径，
  就用配置把 `stateFile` 指到同一个地方**，别让两边各写一份。
