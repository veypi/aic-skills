import test from 'node:test'
import assert from 'node:assert/strict'
import {existsSync, readFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))
const root = join(dir, '..')
const read = path => readFileSync(join(root, path), 'utf8')

test('all referenced manuals and templates exist', () => {
  const manual = read('SKILL.md')
  const references = new Set()
  for (const match of manual.matchAll(/`(references\/[^`]+\.md)`/g)) references.add(match[1])
  for (const match of manual.matchAll(/`(templates\/[^`]+)`/g)) references.add(match[1])
  for (const path of references) assert.ok(existsSync(join(root, path)), 'missing ' + path)
  for (const path of ['references/direction.md', 'references/visual-language.md', 'references/interaction-states.md', 'references/reference-contract.md', 'references/review.md', 'references/proofroom-case.md']) {
    assert.ok(references.has(path), 'SKILL.md does not route to ' + path)
  }
  for (const path of ['templates/DESIGN.md', 'templates/direction.md', 'templates/review.md', 'templates/tokens.css']) assert.ok(existsSync(join(root, path)))
})

test('translations cover every static key in both locales', () => {
  const langs = JSON.parse(read('ui/langs.json'))
  const keys = new Set()
  for (const match of read('ui/index.html').matchAll(/\$t\(['"]([^'"]+)['"]\)/g)) keys.add(match[1])
  assert.ok(keys.size > 30)
  for (const locale of ['zh-CN', 'en-US']) {
    for (const key of keys) assert.ok(langs[locale]?.[key], locale + ' missing ' + key)
  }
})

test('gallery contains real distinct HTML examples with executable prompts', () => {
  const cases = JSON.parse(read('ui/cases/cases.json'))
  assert.ok(cases.length >= 3)
  const ids = new Set()
  for (const item of cases) {
    assert.ok(item.id && !item.title && !item.summary && !item.kind)
    assert.ok(item.prompt.length > 100, item.id + ' prompt is too thin')
    assert.ok(!ids.has(item.id), 'duplicate case ' + item.id)
    ids.add(item.id)
    const html = read('ui/cases/' + item.id + '.html')
    assert.match(html, /^<!DOCTYPE html>/)
    assert.match(html, /name="viewport"/)
    assert.match(html, /<title>/)
    assert.match(html, /html,\s*body\s*\{[^}]*overflow:\s*hidden/)
    assert.doesNotMatch(html, /overflow(?:-y)?:\s*(?:auto|scroll)/)
    assert.doesNotMatch(html, /unsplash|placehold|picsum|placekitten/)
  }
})

test('home hands real work back to chat instead of managing projects', () => {
  const home = read('ui/index.html')
  assert.match(home, /user_prompt/)
  assert.match(home, /goChat/)
  assert.match(home, /\$os/)
  assert.match(home, /window\.open/)
  assert.match(home, /quickNew/)
  assert.match(home, /quickExisting/)
  assert.match(home, /useTheme/)
  assert.match(home, /case-overlay/)
  assert.match(home, /overlay-prompt/)
  assert.doesNotMatch(home, /button:focus-visible[^{]*\{[^}]*outline:\s*2px/)
  assert.doesNotMatch(home, /promptId|togglePrompt/)
  assert.match(home, /contentRect\.width \/ 960/)
  assert.doesNotMatch(home, /\dvw\b/)
  assert.doesNotMatch(home, /home\.mast_note|home\.hero_copy|home\.chat_hint|home\.cases_note|home\.theme_note|home\.workflow_title|home\.footer/)
  assert.match(home, /sandbox="allow-scripts"/)
  assert.doesNotMatch(home, /allow-same-origin/)
  assert.doesNotMatch(home, /pickSavePath|pickFiles|loadRecent|design_select|aic\.design\/1/)
  assert.doesNotMatch(home, /\$mod\.\$fs\.(list|remove|search|writeFile)/)
})

test('own UI and gallery cases require visual evidence and stay annotation-free', () => {
  const manual = read('SKILL.md')
  const selfCase = read('references/proofroom-case.md')
  assert.match(manual, /本技能自己的 UI 是方法的第一案例/)
  assert.match(manual, /上架前有真实视觉证据/)
  assert.match(manual, /不加入 `cases\.json`/)
  assert.match(manual, /不为数量或补齐网格/)
  assert.match(selfCase, /悬浮或聚焦遮罩/)
  assert.match(selfCase, /视觉证据是案例准入条件/)
  assert.doesNotMatch(selfCase, /编号、名称和画面|Prompt 按需展开|复制 Prompt|用此方向/)
})

test('private design project mechanism is removed', () => {
  for (const path of ['ui/board.html', 'ui/project.js', 'ui/recent.js', 'references/project-format.md', 'templates/project.design']) {
    assert.equal(existsSync(join(root, path)), false, path + ' should be removed')
  }
  const manifest = JSON.parse(read('manifest.json'))
  assert.deepEqual(Object.keys(manifest.ui.pages), ['index'])
  assert.equal(manifest.ui.openers, undefined)
  assert.doesNotMatch(read('SKILL.md'), /design_reload|design_select|design_status/)
})
