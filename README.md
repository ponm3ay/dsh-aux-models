# dsh-aux-models

> DSH（DeepSeek Harness）插件 · MIT · 宿主半 + 浏览器半 · 无任何 npm 依赖

给 DSH 的**设置页加一页「辅助模型」**：按任务选辅助模型——左边列任务，右边选
**服务商 / 模型 / 调用超时**，保存后落一份**机器可读的槽位表**，别的插件、脚本或 agent 可以直接读。

```
设置 → 辅助模型
┌───────────────┬──────────────────────────────────────────┐
│ 常用辅助任务   │ 视觉分析                    [供外部读取] │
│  视觉分析  自动│ 图片附件与截图的分析路由……               │
│  上下文压缩    │ 服务商  [ Auto 自动选择 · auto      ▾ ]  │
│  网页抽取      │ 模型    [ 自动模式下不需要填写模型   ]   │
│  标题生成      │ 超时    [ 60                        ]    │
│  智能审批      │ [保存此辅助任务] [恢复为自动]  已保存    │
│  MCP 路由      │                                          │
│ 高级辅助任务   │ 生效方式 · 供外部读取：agent、脚本或其它 │
│  技能中心…     │ 插件读本表取用。                         │
└───────────────┴──────────────────────────────────────────┘
```

它**不接管** DSH 内核的模型选择，也不假装生效：每个任务在面板上都标着自己是哪种状态。

## 三种生效方式（面板徽章）

| 徽章 | 含义 |
|---|---|
| **立即生效** | 有插件/脚本在调用点真的读这张表（默认清单里没有；装了消费方插件后可用配置标上） |
| **供外部读取** | agent、脚本或其它插件读本表取用（默认值） |
| **仅记录** | 该任务当前由 DSH 内核或别的插件自管，这里只是备注/预设 |

## 集成契约（别的插件怎么读）

| 路由 | 说明 |
|---|---|
| `GET /plugins/dsh-aux-models/catalog` | 任务清单 + provider 目录 + profile + 落盘路径（面板用的就是这个） |
| `GET /plugins/dsh-aux-models/state` | 当前槽位选型：`{ version, tasks: { <key>: { mode, provider, model, timeout } } }` |
| `PUT /plugins/dsh-aux-models/state` | 整表替换（校验后原子写） |

`mode` 只有两种：`auto`（不干预）与 `custom`（固定走 `provider`/`model`，超时 `timeout` 秒）。
槽位表的**落盘文件**也可直接读（见下面配置的 `stateFile`），消费方插件两种方式都行。

示例（消费方伪代码）：

```js
const res = await fetch('http://127.0.0.1:<DSH 端口>/plugins/dsh-aux-models/state')
const { tasks } = await res.json()
const slot = tasks.compression
if (slot?.mode === 'custom') useModel(slot.provider, slot.model, slot.timeout * 1000)
```

## 安装

### 路线 A：作为 bundle（推荐）

1. 把本目录放到 `$DSH_HOME/plugins/dsh-aux-models/`（或任意路径）。
2. 在 profile 的 `package.json` 里加依赖并注册 bundle，然后 `pnpm install`：

   ```jsonc
   {
     "dependencies": { "dsh-aux-models": "link:<本目录绝对路径>" },
     "dsh": { "profile": { "bundles": ["dsh-aux-models"] } }
   }
   ```

   本包自带 `cordis.patch.yml`，会自动插一行（`id: aux-models-panel`）。

### 路线 B：profile patch 行

在 profile 的 `cordis.patch.yml` 追加：

```yaml
- insert:
    - id: aux-models-panel
      name: dsh-aux-models
```

⚠️ **两条路线只能选一条**：两条同 id 的插入行会被 client-modules 表拒绝。

装完刷新页面 → 设置左侧出现「辅助模型」。

## 配置（profile patch 行的 `config:`，全部可选）

```yaml
- id: aux-models-panel
  name: dsh-aux-models
  config:
    profile: desktop              # 读哪个 profile 的 patch 取 provider 目录（默认自动探测）
    stateFile: aux-models.json    # 槽位表落盘（空= $DSH_HOME/aux-models.json；相对路径按 $DSH_HOME 解析）
    providers:                    # 覆盖 provider 目录（不填则从 profile patch 实时提取）
      - id: deepseek
        models: [deepseek-chat, deepseek-reasoner]
    groups:                       # 覆盖分组（key 要与任务的 group 对得上）
      - { key: common, label: 常用辅助任务 }
      - { key: adv,    label: 高级辅助任务 }
    tasks:                        # 追加 / 覆盖任务（按 key 匹配）
      - { key: vision, label: 看图, effect: wired }   # 覆盖已有任务
      - { key: my-task, label: 我的任务, group: adv, timeout: 42, desc: 说明… }  # 新任务
```

- `profile` 不填时按此顺序探测：`DSH_PROFILE` 环境变量 → 只有一个 profile 就用它 →
  有 `desktop` 就用它 → 目录列表第一个。
- `provider` 目录默认从 `<profile>/cordis.patch.yml` 的 `llm-pi-ai` 段**正则提取**
  （本插件不引第三方依赖，所以不解析完整 YAML）。提取失败会退回内置兜底目录，
  面板上会如实显示「provider 目录来源」——不会假装知道你的配置。
- 下拉里的模型来自提取结果；手输模型名也允许（有些网关的模型 id 不在 patch 里）。

## 自检

```bash
node verify/host-test.mjs        # 离线黑盒：不需要 DSH、不联网、不碰真实家目录
node --check lib/client.js       # 产物语法
```

客户端半体是否真的落位（比 HTTP 更硬的证据，用 cordis inspect）：

```text
cordis_inspect_query(platform: "client", provider: "Slots", method: "listSubTree",
  input: { root: "settings.section" })
→ occupants 里应有 { id: "aux-models", order: 118, active: true }
```

跑起来之后手工验三条路由：

```powershell
$b = "http://127.0.0.1:<DSH 端口>/plugins/dsh-aux-models"
Invoke-WebRequest "$b/catalog" -UseBasicParsing | Select-Object StatusCode
Invoke-WebRequest "$b/state"   -UseBasicParsing | Select-Object StatusCode
```

## 目录结构

```
entry.js            宿主半：/catalog、/state 两条路由 + 校验 + 原子写
src/client.js       浏览器半源码（设置页组件）
lib/client.js       构建产物（= 源码套一层模块加载器壳）
build-client.mjs    构建脚本：改完 src/client.js 必跑
cordis.patch.yml    bundle 层：注册 entry 行
verify/host-test.mjs 离线黑盒自测
```

改 `src/client.js` → `node build-client.mjs` → 刷新页面；
改 `entry.js` → profile patch 被 watch，会自动重组（不行就重启 DSH）。

## 已知边界

- **包名不要改**：客户端产物按包名走 `/plugins/<包名>/client.js`，改名要同步改
  `src/client.js` 顶部的 `ROUTE`。
- 界面文案是中文；要本地化就改 `src/client.js` 里的字符串（没有引入 i18n 依赖）。
- 面板只做「选型 + 落盘 + 暴露读取接口」，**不负责让模型真的被用上**——
  那一步由消费方插件完成（面板会把每个任务标成「立即生效 / 供外部读取 / 仅记录」）。
- provider 目录是正则提取的，profile patch 结构大改时可能失手 → 退回兜底目录，
  此时用配置里的 `providers` 显式写死即可。
