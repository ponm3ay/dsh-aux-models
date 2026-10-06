// Rebuild lib/client.js from src/client.js.
//
// 浏览器产物 = 源码逐字套一层加载器壳（窗口里的 __ModuleLoader__.load）。
// 没有打包器、没有依赖——所以这个脚本就是「构建」。改完 src/client.js 必须重跑。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const id = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name

const head =
  'window.__ModuleLoader__.load({ id: ' + JSON.stringify(id) + ', factory: (require) => {\n' +
  'var module = { exports: {} }; var exports = module.exports;\n'
const tail = '\nreturn module.exports; } });\n'

const source = readFileSync(join(root, 'src', 'client.js'), 'utf8')
if (source.includes('return module.exports; } });')) {
  throw new Error('build-client: src/client.js 已经带壳（它是源码，不是产物）')
}

const bundle = head + source + tail
mkdirSync(join(root, 'lib'), { recursive: true })
writeFileSync(join(root, 'lib', 'client.js'), bundle)
console.log('build-client: lib/client.js 已写入（' + String(bundle.length) + ' 字符，源 ' + String(source.length) + '）')
