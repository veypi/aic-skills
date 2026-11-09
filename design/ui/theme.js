export const PRESETS = ['#B34A32', '#2F6B59', '#315C9B', '#8B5E83', '#A47B24', '#3C4140']

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

export function normalizeHex(value) {
  const raw = String(value || '').trim().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/i.test(raw)) return '#' + raw.split('').map(char => char + char).join('').toUpperCase()
  if (/^[0-9a-f]{6}$/i.test(raw)) return '#' + raw.toUpperCase()
  throw new Error('需要 #RGB 或 #RRGGBB 颜色值')
}

function channels(hex) {
  const value = normalizeHex(hex).slice(1)
  return [0, 2, 4].map(index => parseInt(value.slice(index, index + 2), 16))
}

export function hexToHsl(hex) {
  const values = channels(hex).map(value => value / 255)
  const max = Math.max(...values)
  const min = Math.min(...values)
  const light = (max + min) / 2
  const delta = max - min
  if (!delta) return [0, 0, Math.round(light * 100)]
  const saturation = delta / (1 - Math.abs(2 * light - 1))
  let hue = 0
  const [r, g, b] = values
  if (max === r) hue = 60 * (((g - b) / delta) % 6)
  if (max === g) hue = 60 * ((b - r) / delta + 2)
  if (max === b) hue = 60 * ((r - g) / delta + 4)
  return [Math.round((hue + 360) % 360), Math.round(saturation * 100), Math.round(light * 100)]
}

export function hslToHex(hue, saturation, light) {
  const h = ((Number(hue) % 360) + 360) % 360
  const s = clamp(Number(saturation), 0, 100) / 100
  const l = clamp(Number(light), 0, 100) / 100
  const chroma = (1 - Math.abs(2 * l - 1)) * s
  const part = h / 60
  const x = chroma * (1 - Math.abs((part % 2) - 1))
  const table = [[chroma, x, 0], [x, chroma, 0], [0, chroma, x], [0, x, chroma], [x, 0, chroma], [chroma, 0, x]]
  const rgb = table[Math.min(5, Math.floor(part))]
  const offset = l - chroma / 2
  return '#' + rgb.map(value => Math.round((value + offset) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()
}

function luminance(hex) {
  const values = channels(hex).map(value => {
    const channel = value / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722
}

export function contrastRatio(first, second) {
  const a = luminance(first)
  const b = luminance(second)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

export function contrastText(hex) {
  return contrastRatio(hex, '#17201C') >= contrastRatio(hex, '#FFFFFF') ? '#17201C' : '#FFFFFF'
}

export function makeTheme(color, mode = 'light') {
  const primary = normalizeHex(color)
  const [h, s, l] = hexToHsl(primary)
  const dark = mode === 'dark'
  return {
    primary,
    primaryHover: hslToHex(h, s, clamp(l + (dark ? 8 : -8), 12, 88)),
    primarySoft: dark ? hslToHex(h, Math.min(s, 42), 18) : hslToHex(h, Math.min(s, 52), 93),
    primaryText: contrastText(primary),
    canvas: dark ? hslToHex(h, Math.min(s, 16), 10) : hslToHex(h, Math.min(s, 18), 97),
    surface: dark ? hslToHex(h, Math.min(s, 18), 15) : hslToHex(h, Math.min(s, 24), 99),
    text: dark ? '#F2F3EF' : '#202421',
    muted: dark ? '#A8AEA8' : '#68706A',
    border: dark ? hslToHex(h, Math.min(s, 18), 27) : hslToHex(h, Math.min(s, 20), 84),
  }
}

export function themeCSS(theme) {
  return [
    `--color-primary: ${theme.primary};`,
    `--color-primary-hover: ${theme.primaryHover};`,
    `--color-primary-soft: ${theme.primarySoft};`,
    `--color-primary-text: ${theme.primaryText};`,
    `--color-canvas: ${theme.canvas};`,
    `--color-surface: ${theme.surface};`,
    `--color-text: ${theme.text};`,
    `--color-muted: ${theme.muted};`,
    `--color-border: ${theme.border};`,
  ].join('\n')
}
