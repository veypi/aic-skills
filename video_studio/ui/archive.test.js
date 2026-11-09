import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ARCHIVE_EXT, ARCHIVE_FORMAT, DEFAULT_DIR,
  toTree, toRef, parentOf, archiveName, assertArchivePath,
  safeRef, resolveRef, defaultArchivePath, assertDocumentRefs, pickerStart,
} from './archive.js'

test('archive paths accept every $fs source and preserve portable references', () => {
  const cases = [
    '/fs/page/.video/demo/demo.video_studio',
    '/fs/cloud/u/admin/videos/demo.video_studio',
    '/fs/ab62a0c624f2496b8e7cf8f63c735d1d/Users/test/demo.video_studio',
  ]
  for (const ref of cases) {
    const path = assertArchivePath(ref)
    assert.equal(toRef(path), ref)
    assert.equal(parentOf(path), ref.slice(3, ref.lastIndexOf('/')))
    assert.equal(archiveName(path), 'demo')
    assert.equal(resolveRef(parentOf(path), 'assets/cover.png'), parentOf(path) + '/assets/cover.png')
  }
  assert.equal(ARCHIVE_EXT, '.video_studio')
  assert.equal(ARCHIVE_FORMAT, 'video_studio/1')
  assert.equal(DEFAULT_DIR, '/page/.video')
})

test('default archive uses an isolated directory per project', () => {
  const path = defaultArchivePath('我的 视频')
  assert.equal(path, '/page/.video/我的-视频/我的-视频.video_studio')
})

test('file pickers create the default directory only when no current directory exists', async () => {
  const calls = []
  const fs = {mkdir: async (...args) => { calls.push(args); return {ok: true} }}
  assert.equal(await pickerStart(fs), DEFAULT_DIR)
  assert.deepEqual(calls, [[DEFAULT_DIR, {parents: true, existOk: true}]])
  assert.equal(await pickerStart(fs, '/cloud/u/admin/videos'), '/cloud/u/admin/videos')
  assert.equal(calls.length, 1)
})

test('relative resources cannot escape the archive root', () => {
  assert.equal(safeRef('assets/cover.png'), 'assets/cover.png')
  assert.equal(safeRef('./assets/cover.png'), 'assets/cover.png')
  for (const ref of ['../a.png', '/tmp/a.png', '/fs/page/a.png', 'https://x/a.png', 'data:image/png;base64,x', 'assets//a.png']) {
    assert.throws(() => safeRef(ref), /相对路径|逃逸/)
  }
})

test('all media fields must be portable relative references', () => {
  assertDocumentRefs({scenes: [{elements: [{src: 'assets/a.png'}]}], music: {src: 'assets/b.mp3'}})
  assert.throws(() => assertDocumentRefs({scenes: [{elements: [{src: '/fs/page/a.png'}]}]}))
  assert.throws(() => assertDocumentRefs({sfx: [{src: 'https://example.com/a.wav'}]}))
})
