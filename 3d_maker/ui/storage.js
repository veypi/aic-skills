export const MODEL_EXT = '.3d.js'

export const toTree = path => String(path || '').trim().replace(/^\/fs(?=\/)/, '')
export const toRef = path => String(path || '').trim().startsWith('/fs/') ? String(path || '').trim() : '/fs' + toTree(path)
export const baseName = path => String(path || '').split('/').filter(Boolean).pop() || ''
export const parentOf = path => {
  const segments = toTree(path).split('/').filter(Boolean)
  segments.pop()
  return segments.length ? '/' + segments.join('/') : ''
}

export function modelName(path) {
  return baseName(path).replace(/\.3d\.js$/i, '')
}

function invalidPath(message) {
  const error = new Error(message)
  error.code = 'INVALID_PATH'
  throw error
}

export function assertModelPath(path) {
  const value = toRef(path)
  const tree = toTree(value)
  if (!tree || tree === '/' || tree.includes('..')) invalidPath('A full /fs model path is required')
  if (!/^\/(cloud|page)\//.test(tree) && !/^\/[0-9a-f]{32}\//i.test(tree)) invalidPath('A full /fs model path is required')
  if (!/\.3d\.js$/i.test(tree)) invalidPath('Model files must use the .3d.js extension')
  return value
}
