/* VeriSim Pro - 引擎与资源的镜像源配置 + 通用加载器
 *
 * 换源 / 加源：只改下面两张表。
 *   MIRRORS   — 镜像名 → 根地址（版本/commit 全部 pin 在这里）
 *   RESOURCES — 资源名 → { mirrors: [按顺序尝试的镜像名], file: 镜像内相对路径, local: ui 根下相对路径 }
 *
 * 加载顺序：mirrors 列表依次尝试，全部失败后用 local（相对于调用方传入的 ui 根）。
 * 三类加载器：loadModule（ESM 引擎）、loadScript（全局脚本）、loadText（文本如 .lib）。
 */
const VERISIM_REV = 'a275a9ac28c59db1130505973644c9a3754ec1d7'; // senolgulgonul/verisim（iverilog 三件套 + 原理图库）
const YOSYS_VER = '0.64.1130';                                  // @yowasp/yosys npm 版本
const ORFS_REV = 'aaf99bfae2bd77848e9778e902d0f4b4c8e1f11c';    // OpenROAD-flow-scripts（NanGate PDK）

// 源顺序约定：国内镜像第一，海外镜像第二，服务器相对地址（local）永远最后。
const MIRRORS = {
  // —— 国内镜像（第一位）——
  // jsdmirror：jsDelivr 国内镜像，gh 仓库路径格式与 jsDelivr 一致
  cn_jsdmirror_gh: 'https://cdn.jsdmirror.com/gh/senolgulgonul/verisim@' + VERISIM_REV,
  cn_jsdmirror_orfs: 'https://cdn.jsdmirror.com/gh/The-OpenROAD-Project/OpenROAD-flow-scripts@' + ORFS_REV,
  // 注：yosys npm 包无可用国内公共 CDN（npmmirror 拒绝分发、elemecdn 已下线），
  // 如需国内加速，把 yosys/gen 目录推到自己的 GitHub 仓库，再在此加一行
  //   cn_myrepo_yosys: 'https://cdn.jsdmirror.com/gh/<user>/<repo>@<sha>'
  // 并把 RESOURCES.yosys.mirrors 改为 ['cn_myrepo_yosys', 'jsdelivr_npm']（file 按仓库内路径调整）。
  // —— 海外镜像（第二位）——
  jsdelivr_gh: 'https://cdn.jsdelivr.net/gh/senolgulgonul/verisim@' + VERISIM_REV,
  jsdelivr_npm: 'https://cdn.jsdelivr.net/npm/@yowasp/yosys@' + YOSYS_VER,
  jsdelivr_orfs: 'https://cdn.jsdelivr.net/gh/The-OpenROAD-Project/OpenROAD-flow-scripts@' + ORFS_REV
};

const GH_VERISIM = ['cn_jsdmirror_gh', 'jsdelivr_gh'];

const RESOURCES = {
  // —— 仿真引擎（ESM）——
  ivlpp: { mirrors: GH_VERISIM, file: '/ivlpp.js', local: 'iverilog/ivlpp.js' },
  ivl: { mirrors: GH_VERISIM, file: '/ivl.js', local: 'iverilog/ivl.js' },
  vvp: { mirrors: GH_VERISIM, file: '/vvp.js', local: 'iverilog/vvp.js' },
  // —— 综合引擎（ESM）——
  yosys: { mirrors: ['jsdelivr_npm'], file: '/gen/bundle.js', local: 'yosys/gen/bundle.js' },
  // —— 原理图渲染库（全局脚本）——
  elk: { mirrors: GH_VERISIM, file: '/elk.bundled.js', local: 'vendor/elk.bundled.js' },
  netlistsvg: { mirrors: GH_VERISIM, file: '/netlistsvg.bundle.js', local: 'vendor/netlistsvg.bundle.js' },
  // —— 内置 ASIC 工艺库（文本）——
  lib_nangate45: {
    mirrors: ['cn_jsdmirror_orfs', 'jsdelivr_orfs'],
    file: '/flow/platforms/nangate45/lib/NangateOpenCellLibrary_typical.lib',
    local: 'libs/NangateOpenCellLibrary_typical.lib'
  }
};

const sourceList = (key) => {
  const r = RESOURCES[key];
  if (!r) throw new Error('未知资源：' + key);
  const list = [];
  for (const m of r.mirrors) {
    const base = MIRRORS[m] || m; // mirrors 里也允许直接写完整 URL
    list.push({ label: m, url: String(base).replace(/\/+$/, '') + r.file });
  }
  list.push({ label: 'local', url: null, local: r.local }); // 本地永远是最后一个源
  return list;
};

const localUrl = (localBase, rel) => String(localBase || '.').replace(/\/+$/, '') + '/' + rel;
const errMsg = (e) => (e && e.message ? e.message : String(e));

// ESM 引擎：按源列表依次 import，返回模块对象。
// onStage 收到结构化事件 {phase: 'ok'|'fail', key, from}，界面文案由调用方决定。
const loadModule = async (key, localBase, onStage) => {
  let lastErr = null;
  for (const s of sourceList(key)) {
    const url = s.url || localUrl(localBase, s.local);
    try {
      const m = await import(url);
      onStage && onStage({phase: 'ok', key, from: s.label});
      return m;
    } catch (e) {
      lastErr = e;
      onStage && onStage({phase: 'fail', key, from: s.label});
    }
  }
  throw new Error('resource ' + key + ' failed from all sources: ' + errMsg(lastErr));
};

// 全局脚本：按源列表依次创建 <script>，onload 成功即返回
const loadScript = (key, localBase, onStage) => new Promise((resolve, reject) => {
  const list = sourceList(key);
  const tryNext = (i) => {
    if (i >= list.length) { reject(new Error('脚本 ' + key + ' 所有源加载失败')); return; }
    const s = list[i];
    const el = document.createElement('script');
    el.src = s.url || localUrl(localBase, s.local);
    el.onload = () => { onStage && onStage({phase: 'ok', key, from: s.label}); resolve(s.label); };
    el.onerror = () => {
      el.remove();
      onStage && onStage({phase: 'fail', key, from: s.label});
      tryNext(i + 1);
    };
    document.head.appendChild(el);
  };
  tryNext(0);
});

// 文本资源（如 .lib）：按源列表依次 fetch，返回文本
const loadText = async (key, localBase, onStage) => {
  let lastErr = null;
  for (const s of sourceList(key)) {
    const url = s.url || localUrl(localBase, s.local);
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const text = await r.text();
      onStage && onStage({phase: 'ok', key, from: s.label});
      return text;
    } catch (e) {
      lastErr = e;
      onStage && onStage({phase: 'fail', key, from: s.label});
    }
  }
  throw new Error('resource ' + key + ' failed from all sources: ' + errMsg(lastErr));
};

export default { MIRRORS, RESOURCES, sourceList, loadModule, loadScript, loadText };
