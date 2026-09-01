/* VeriSim Pro - Yosys stat parser, top-module inference, synth-source filtering (data only) */
function splitModules(src) {
  const out = [];
  const re = /\bmodule\s+(\w+)\b[\s\S]*?\bendmodule\b/g;
  let m;
  while ((m = re.exec(src))) out.push({ name: m[1], text: m[0] });
  return out;
}

function isTestbenchModule(name, text) {
  if (/^(tb|testbench|test|.*_tb)$/i.test(name)) return true;
  return /\$(finish|display|write|strobe|monitor|dumpfile|dumpvars)\b/.test(text);
}

function guessTop(src) {
  const mods = [...src.matchAll(/\bmodule\s+(\w+)/g)].map(m => m[1]);
  const instd = new Set();
  for (const m of mods) {
    for (const other of mods) {
      if (other === m) continue;
      const re = new RegExp('\\b' + other + '\\s+(?:#\\s*\\([^;]*?\\)\\s*)?\\w+\\s*\\(', 'g');
      if (re.test(src)) instd.add(other);
    }
  }
  const tops = mods.filter(m => !instd.has(m));
  const synthTops = tops.filter(m => !/^(tb|testbench|test|.*_tb)$/i.test(m));
  return synthTops[0] || tops[0] || mods[0] || '';
}

function stripForSynth(src) {
  const modules = splitModules(src);
  if (!modules.length) return { code: src, top: guessTop(src), dropped: [] };
  const kept = [];
  const dropped = [];
  for (const m of modules) {
    if (isTestbenchModule(m.name, m.text)) dropped.push(m.name);
    else kept.push(m.text);
  }
  if (!kept.length) return { code: src, top: guessTop(src), dropped };
  const code = kept.join('\n\n') + '\n';
  return { code, top: guessTop(code), dropped };
}

function parseStat(out, top) {
  // 取最后一段 stat（映射完成后的最终统计），避免取到综合中间步骤的数据
  const parts = String(out || '').split('Printing statistics.');
  let block = parts[parts.length - 1];
  const cut = block.search(/\n\d+\. Executing/);
  if (cut >= 0) block = block.slice(0, cut);
  const num = (re) => {
    const mm = block.match(re);
    return mm ? mm[1] : '—';
  };

  const wires = num(/^\s*(\d+)\s+wires\s*$/m) !== '—'
    ? num(/^\s*(\d+)\s+wires\s*$/m)
    : num(/Number of wires:\s*(\d+)/);
  const cells = num(/^\s*(\d+)\s+cells\s*$/m) !== '—'
    ? num(/^\s*(\d+)\s+cells\s*$/m)
    : num(/Number of cells:\s*(\d+)/);

  const overview = {
    top: top || '',
    cells,
    cellBits: num(/^\s*(\d+)\s+cell bits\s*$/m),
    wires,
    wireBits: num(/^\s*(\d+)\s+wire bits\s*$/m),
    memories: num(/^\s*(\d+)\s+memories\s*$/m),
    processes: num(/^\s*(\d+)\s+processes\s*$/m)
  };

  // 单元行形如 "        2   SB_CARRY" 或 "        5   $_MUX_"；
  // 跳过 stat 概览关键字行（wires/cells/ports 等）与分节行。
  const STAT_KEYS = new Set(['wires', 'cells', 'memories', 'processes', 'ports', 'bits', 'submodules', 'functions', 'signals', 'chip', 'area']);
  const rows = [];
  let cm;
  const cre1 = /^\s*(\d+)\s+([A-Za-z_$][\w$.]*)\s*$/gm;
  while ((cm = cre1.exec(block))) {
    if (STAT_KEYS.has(cm[2])) continue;
    rows.push([cm[2], cm[1]]);
  }
  if (!rows.length) {
    const cre2 = /^\s{2,}([A-Za-z_$][\w$.]*)\s+(\d+)\s*$/gm;
    while ((cm = cre2.exec(block))) {
      if (STAT_KEYS.has(cm[1])) continue;
      rows.push([cm[1], cm[2]]);
    }
  }

  const merged = {};
  for (const [name, count] of rows) merged[name] = (merged[name] || 0) + (+count);
  const cellRows = Object.keys(merged)
    .map(name => ({ name, count: merged[name] }))
    .sort((a, b) => b.count - a.count);
  overview.dff = cellRows
    .filter(r => /(dff|dfxtp|dfstp|efscn)/i.test(r.name))
    .reduce((sum, r) => sum + r.count, 0);

  return { overview, cellRows };
}

export default { guessTop, stripForSynth, parseStat };
