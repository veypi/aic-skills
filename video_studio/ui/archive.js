/* .video_studio 存档路径与相对资源契约。 */
import {toTree, toRef} from './recent.js'

export const ARCHIVE_EXT = '.video_studio'
export const ARCHIVE_FORMAT = 'video_studio/1'
export const DEFAULT_DIR = '/page/.video'

export {toTree, toRef}

export function parentOf(path) {
  const value = toTree(path).replace(/\/+$/, '')
  const index = value.lastIndexOf('/')
  return index > 0 ? value.slice(0, index) : ''
}

export function baseName(path) {
  const value = toTree(path).replace(/\/+$/, '')
  return value.slice(value.lastIndexOf('/') + 1)
}

export function archiveName(path) {
  return baseName(path).replace(/\.video_studio$/i, '')
}

export function assertArchivePath(path) {
  const value = toTree(path)
  if (!/^\/(cloud|page|[0-9a-f]{32})\//i.test(value)) throw new Error('需要完整的 /fs 文件路径')
  if (!value.toLowerCase().endsWith(ARCHIVE_EXT)) throw new Error('存档文件必须使用 .video_studio 扩展名')
  return value
}

export function safeRef(ref) {
  const value = String(ref || '').replace(/\\/g, '/').replace(/^\.\//, '')
  if (!value || value.startsWith('/') || value.startsWith('/fs/') || /^[a-z][a-z0-9+.-]*:/i.test(value)) {
    throw new Error('资源必须使用存档内相对路径：' + ref)
  }
  const parts = value.split('/')
  if (parts.some(part => !part || part === '.' || part === '..')) throw new Error('资源路径不能逃逸存档目录：' + ref)
  return parts.join('/')
}

export function resolveRef(dir, ref) {
  const root = String(dir || '').replace(/\/+$/, '')
  if (!root) throw new Error('未设置存档目录')
  return root + '/' + safeRef(ref)
}

export function assertDocumentRefs(value) {
  const walk = node => {
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (!node || typeof node !== 'object') return
    for (const [key, child] of Object.entries(node)) {
      if ((key === 'src' || key === 'poster' || key === 'asset') && typeof child === 'string' && child) safeRef(child)
      else walk(child)
    }
  }
  walk(value)
  return value
}

export function defaultArchivePath(name) {
  const base = String(name || '').trim().replace(/[\\/:*?"<>|#%\s]+/g, '-').replace(/^-+|-+$/g, '') || 'video-' + Date.now().toString(36)
  return DEFAULT_DIR + '/' + base + '/' + base + ARCHIVE_EXT
}

export async function pickerStart(fs, current = '') {
  if (current) return current
  await fs.mkdir(DEFAULT_DIR, {parents: true, existOk: true})
  return DEFAULT_DIR
}

export async function readText(fs, path) {
  const result = await fs.readFile(toTree(path))
  if (typeof result.content === 'string') return result.content
  if (result.content && typeof result.content.text === 'function') return await result.content.text()
  throw new Error('无法读取文本存档：' + toRef(path))
}
