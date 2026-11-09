import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync, existsSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {dirname, join} from 'node:path'

const dir = dirname(fileURLToPath(import.meta.url))
const root = join(dir, '..')
const read = path => readFileSync(join(root, path), 'utf8')

test('home owns open, new, recent and examples; studio has no project/sample popups', () => {
  const home = read('ui/index.html')
  const studio = read('ui/studio.html')
  assert.match(home, /pickFiles\(\{accept: \['\.video_studio'\]/)
  assert.match(home, /pickSavePath\(/)
  assert.match(home, /\$t\('home\.recent'\)/)
  assert.match(home, /\$t\('home\.examples'\)/)
  assert.doesNotMatch(home, /\dvw\b|素材与场景始终随项目目录一起迁移|新建或打开存档后|<h1>片架<\/h1>/)
  assert.match(studio, /class="more-actions"/)
  assert.match(studio, /class="tbtn file-action"/)
  assert.match(studio, /name: 'open'/)
  assert.match(studio, /\$router\.query\.url/)
  assert.doesNotMatch(studio, /showProjects|showCases|listProjects|deleteProject|video_studio_last/)
  assert.doesNotMatch(studio, /\$t\('studio\.(?:opened|created|case_loaded)'/)
  assert.doesNotMatch(studio, /showToast|toastTimer|class="toast"|\btoast\s*=/)
})

test('studio uses one archive path and never forces page-local storage', () => {
  const studio = read('ui/studio.html')
  assert.match(studio, /curPath = ''/)
  assert.match(studio, /curDir = ''/)
  assert.match(studio, /\$mod\.\$fs\.readFile\(toTree\(path\)\)/)
  assert.match(studio, /\$mod\.\$fs\.writeFile\(toTree\(path\), content\)/)
  assert.match(studio, /\$mod\.\$fs\.transfer\(source, destination\)/)
  assert.doesNotMatch(studio, /readFile\('\/page'|writeFile\('\/page'|projRoot/)
})

test('initial archive loading waits for the mounted stage instead of reading setup refs', () => {
  const studio = read('ui/studio.html')
  const setup = studio.slice(studio.indexOf('<script setup>'), studio.indexOf('</script>', studio.indexOf('<script setup>')))
  assert.doesNotMatch(setup, /\n\s*initPage\(\)/)
  assert.match(studio, /waitStage = async \(\)/)
  assert.match(studio, /<script>\s*\$scope\.addCleanup\(\$router\.onChange/)
  assert.match(studio, /<script active>\s*initPage\(\)\s*<\/script>/)
  assert.match(studio, /const stage = await waitStage\(\)/)
})

test('archive, reload and case preload all assets before mounting the stage once', () => {
  const studio = read('ui/studio.html')
  assert.match(studio, /for \(const ref of normalizeDoc\(d\)\._assets\)/)
  for (const name of ['openArchive', 'reloadProject', 'openCase']) {
    const start = studio.indexOf('  ' + name + ' = async')
    const end = studio.indexOf('\n  }\n', start)
    assert.ok(start >= 0 && end > start, name)
    const body = studio.slice(start, end)
    const preload = body.indexOf('await loadAssets(')
    const mount = body.indexOf('stage.$data.setDoc(doc, assets)')
    assert.ok(preload >= 0 && mount > preload, name + ' must preload before setDoc')
    assert.equal((body.match(/\$data\.setDoc\(/g) || []).length, 1, name + ' must mount once')
  }
})

test('all visible templates are localized and every static key has both translations', () => {
  const langs = JSON.parse(read('ui/langs.json'))
  const files = ['index.html', 'studio.html', 'video/scenes.html', 'video/assets.html', 'video/stage.html', 'video/timeline.html', 'video/inspector.html']
  for (const path of files) {
    const source = read('ui/' + path)
    const template = source.slice(0, source.indexOf('<script setup>')).replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '')
    assert.doesNotMatch(template, /\p{Script=Han}/u, path + ' has untranslated template text')
    for (const match of source.matchAll(/\$t\(['"]([^'"]+)['"]\s*[,)]/g)) {
      assert.ok(langs['zh-CN']?.[match[1]], 'zh-CN missing ' + match[1])
      assert.ok(langs['en-US']?.[match[1]], 'en-US missing ' + match[1])
    }
  }
  for (const key of ['_studio.saved', '_studio.unsaved', '_studio.saving', '_studio.failed', '_case.lumen-1.1', '_case.showreel']) {
    assert.ok(langs['zh-CN']?.[key] && langs['en-US']?.[key], key)
  }
})

test('manifest and all bundled cases use the portable archive format', () => {
  const manifest = JSON.parse(read('manifest.json'))
  assert.equal(manifest.ui.openers.video.page, 'studio')
  assert.deepEqual(manifest.ui.openers.video.match.extensions, ['video_studio'])
  assert.ok(manifest.ui.pages.index)
  assert.ok(manifest.ui.pages.studio)
  for (const name of ['lumen-1.1', 'card-stack', 'showreel']) {
    const path = 'ui/cases/' + name + '/index.video_studio'
    assert.ok(existsSync(join(root, path)), path)
    assert.equal(JSON.parse(read(path)).format, 'video_studio/1')
    assert.ok(!existsSync(join(root, 'ui/cases/' + name + '/index.json')))
  }
})
