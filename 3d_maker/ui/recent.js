import {toTree} from './storage.js'

export const RECENT_KEY = '3d_maker.recent'
export const RECENT_MAX = 20

export function loadRecent() {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    const list = raw ? JSON.parse(raw) : []
    if (!Array.isArray(list)) return []
    return list.filter(item => item && typeof item.path === 'string' && item.path).map(item => ({
      path: toTree(item.path),
      name: String(item.name || ''),
      time: Number(item.time) || 0,
    })).filter(item => item.path)
  } catch (error) {
    return []
  }
}

function saveRecent(list) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)) } catch (error) { /* recent history is optional */ }
}

export function pushRecent(path, name) {
  const value = toTree(path)
  if (!value) return
  const list = loadRecent().filter(item => item.path !== value)
  list.unshift({path: value, name: String(name || ''), time: Date.now()})
  saveRecent(list.slice(0, RECENT_MAX))
}

export function removeRecent(path) {
  const value = toTree(path)
  saveRecent(loadRecent().filter(item => item.path !== value))
}

export function clearRecent() {
  saveRecent([])
}
