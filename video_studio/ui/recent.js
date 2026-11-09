/* Video Studio 最近打开历史：只保存 $fs 路径，不扫描目录、不删除文件。 */
export const RECENT_KEY = 'video_studio.recent'
export const RECENT_MAX = 20

export const toTree = path => String(path || '').trim().replace(/^\/fs(?=\/)/, '')
export const toRef = path => String(path || '').startsWith('/fs/') ? path : '/fs' + toTree(path)

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
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)) } catch (error) { /* 历史不可用不影响文件打开 */ }
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
