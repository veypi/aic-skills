import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const read = path => readFileSync(join(root, path), 'utf8')

test('create keeps conversation-first work free of private project machinery', () => {
  const skill = read('SKILL.md')
  const model = read('references/model.md')
  assert.match(skill, /对话可完成的主任务不另造工作台、项目机制或私有格式/)
  assert.match(skill, /正常打开、新建和切换不弹成功提示/)
  assert.match(model, /主交互就是对话框/)
  assert.match(model, /不为了显得完整而加 UI、项目机制或服务/)
})

test('UI guidance covers activation, shared messages, container sizing and complete i18n', () => {
  const ui = read('references/ui-component.md')
  const materials = read('references/materials.md')
  assert.match(ui, /路由参数驱动的装载放进 `<script active>`/)
  assert.match(ui, /每次激活读取当前 `\$router\.query`/)
  assert.match(ui, /\$message\.info\/success\/warning\/error/)
  assert.match(ui, /禁止在技能里另造 toast/)
  assert.match(ui, /`cqw`\/`clamp`/)
  assert.match(ui, /所有用户可见文案使用 `\$t`/)
  assert.match(ui, /禁止 `--autoremove`/)
  assert.match(materials, /`\$message`/)
})

test('publishing freezes versions until the user chooses a release', () => {
  const publishing = read('references/publishing.md')
  assert.match(publishing, /不随每次修改 bump 版本号/)
  assert.match(publishing, /只有用户明确确定发版时，才统一修改版本号并提交/)
})
