import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {MODEL_EXT, toTree, toRef, parentOf, modelName, assertModelPath} from './storage.js'

const dir = dirname(fileURLToPath(import.meta.url))
const read = path => readFileSync(join(dir, path), 'utf8')

test('model paths are single .3d.js files at arbitrary fs locations', () => {
  assert.equal(MODEL_EXT, '.3d.js')
  const cloud = assertModelPath('/fs/cloud/u/admin/models/bracket.3d.js')
  assert.equal(cloud, '/fs/cloud/u/admin/models/bracket.3d.js')
  assert.equal(toTree(cloud), '/cloud/u/admin/models/bracket.3d.js')
  assert.equal(toRef(toTree(cloud)), cloud)
  assert.equal(parentOf(cloud), '/cloud/u/admin/models')
  assert.equal(modelName(cloud), 'bracket')
  assert.equal(assertModelPath('/page/docs/part.3d.js'), '/fs/page/docs/part.3d.js')
  assert.equal(assertModelPath('/ab62a0c624f2496b8e7cf8f63c735d1d/tmp/part.3d.js'), '/fs/ab62a0c624f2496b8e7cf8f63c735d1d/tmp/part.3d.js')
  assert.throws(() => assertModelPath('part.3d.js'))
  assert.throws(() => assertModelPath('/3d/part.3d.js'))
  assert.throws(() => assertModelPath('/fs/cloud/u/admin/part.js'))
  assert.throws(() => assertModelPath('/fs/cloud/u/admin/../part.3d.js'))
})

test('3d maker separates home, studio, core and vendor without private model storage', () => {
  const home = read('index.html')
  const studio = read('studio.html')
  const manifest = JSON.parse(read('../manifest.json'))
  assert.ok(manifest.ui.pages.index)
  assert.ok(manifest.ui.pages.studio)
  assert.match(home, /pickFiles\(\{accept: \['\.js'\]/)
  assert.match(home, /pickSavePath\(/)
  assert.match(studio, /\$router\.query/)
  assert.match(studio, /<script active>\s*initPage\(\)/)
  assert.match(studio, /name: 'open'/)
  assert.match(studio, /name: 'run_file'/)
  assert.doesNotMatch(studio, /3dmaker_last_code|3dmaker_cur_file|CODE_CACHE_KEY|CURFILE_KEY/)
  assert.doesNotMatch(home + studio, /\/3d\//)
  assert.match(studio, /from '.\/core\/viewer\.js'/)
  assert.match(studio, /from '.\/core\/occt-client\.js'/)
})

test('model exports download directly instead of writing to $fs', () => {
  const studio = read('studio.html')
  const start = studio.indexOf('  doExport = async')
  const end = studio.indexOf('\n  }\n', start)
  const body = studio.slice(start, end)
  assert.ok(start >= 0 && end > start)
  assert.match(body, /bv\?\.download\(format, filename\)/)
  assert.doesNotMatch(body, /pickSavePath|writeFile|pickFs/)
})
