// 组件内共享可变状态（setup/script/active/dispose 各块作用域隔离，一律经本模块单例共享；
// disposed/onResize/cesiumPromise 也挂这里，供 active/dispose 块经动态 import 取用）
export const store = { viewer: null, ds: {}, pin: null, hover: null, disposed: false, onResize: null, cesiumPromise: null }
