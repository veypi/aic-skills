import test from 'node:test'
import assert from 'node:assert/strict'
import {contrastRatio, contrastText, hexToHsl, makeTheme, normalizeHex, themeCSS} from './theme.js'

test('hex normalization accepts short and long forms', () => {
  assert.equal(normalizeHex('#abc'), '#AABBCC')
  assert.equal(normalizeHex('b34a32'), '#B34A32')
  assert.throws(() => normalizeHex('#12'), /RGB|RRGGBB/)
  assert.throws(() => normalizeHex('red'), /RGB|RRGGBB/)
})

test('HSL conversion keeps hue family', () => {
  const [h, s, l] = hexToHsl('#B34A32')
  assert.ok(h >= 5 && h <= 15)
  assert.ok(s > 40 && s < 70)
  assert.ok(l > 35 && l < 55)
})

test('theme derives semantic surfaces and readable action text', () => {
  const theme = makeTheme('#B34A32', 'light')
  assert.equal(theme.primary, '#B34A32')
  assert.notEqual(theme.primaryHover, theme.primary)
  assert.notEqual(theme.primarySoft, theme.canvas)
  assert.ok(contrastRatio(theme.primary, theme.primaryText) >= 4.5)
  assert.equal(contrastText('#FFFFFF'), '#17201C')
  assert.equal(contrastText('#000000'), '#FFFFFF')
})

test('light and dark outputs stay distinct and serializable', () => {
  const light = makeTheme('#315C9B', 'light')
  const dark = makeTheme('#315C9B', 'dark')
  assert.notEqual(light.canvas, dark.canvas)
  assert.notEqual(light.surface, dark.surface)
  const css = themeCSS(dark)
  for (const key of ['primary', 'primaryHover', 'primarySoft', 'primaryText', 'canvas', 'surface', 'text', 'muted', 'border']) {
    assert.match(css, new RegExp('--color-' + key.replace(/[A-Z]/g, char => '-' + char.toLowerCase()) + ':'))
  }
})
