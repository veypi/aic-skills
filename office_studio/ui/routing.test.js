import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))

for (const name of ['excel.html', 'word.html']) {
  test(name + ' reloads the current url query on every activation', () => {
    const source = readFileSync(join(dir, name), 'utf8')
    const setupStart = source.indexOf('<script setup>')
    const setupEnd = source.indexOf('</script>', setupStart)
    const setup = source.slice(setupStart, setupEnd)
    assert.match(source, /\$router\.query\s*&&\s*\$router\.query\.url/)
    assert.match(setup, /applyRoute = async \(\)/)
    assert.match(setup, /task\.path \+ '\|' \+ task\.newFile/)
    assert.doesNotMatch(setup, /\n\s*applyRoute\(\)/)
    assert.match(source, /<script>\s*\$scope\.addCleanup\(\$router\.onChange\(\(\) => applyRoute\(\)\)\)\s*<\/script>/)
    assert.match(source, /<script active>\s*applyRoute\(\)\s*<\/script>/)
    assert.match(setup, /catch \(error\) \{ if \(seq === _route_seq\) _last_route = '' \}/)
    assert.match(setup, /load_error = ''/)
    assert.match(setup, /load_error = msg/)
    assert.match(source, /class="load-error" v-if="load_error" role="alert"/)
    assert.match(source, /v-if="!file_path && !load_error"/)
    assert.match(source, /v-show="!load_error"/)
    assert.match(setup, /load_error = msg\n\s*file_path = ''/)
  })
}

test('word review panel is closed until revisions are shown or the panel is toggled', () => {
  const source = readFileSync(join(dir, 'word.html'), 'utf8')
  assert.match(source, /rev_render = false/)
  assert.match(source, /panel_open = false/)
  assert.match(source, /panel_open = rev_render/)
  assert.match(source, /onTogglePanel = \(\) => \{ panel_open = !panel_open \}/)
  assert.match(source, /\.side \{[^}]*display: none/)
  assert.match(source, /\.side\.open \{ display: flex; \}/)
})
