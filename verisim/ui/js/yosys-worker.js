/**
 * VeriSim Pro - Yosys synthesis Web Worker
 * Runs Yosys WASM off the main thread so the UI stays responsive during synthesis.
 */

let _yosys = null;
const td = new TextDecoder();
const te = new TextEncoder();

function encodeFiles(files) {
  const o = {};
  for (const [k, v] of Object.entries(files)) {
    o[k] = typeof v === 'string' ? te.encode(v) : v;
  }
  return o;
}

function decodeFiles(res) {
  const o = {};
  for (const [k, v] of Object.entries(res)) {
    if (typeof v === 'string') {
      o[k] = v;
    } else if (v instanceof Uint8Array) {
      try { o[k] = td.decode(v); } catch (_) { o[k] = ''; }
    }
  }
  return o;
}

self.onmessage = async (e) => {
  const { id, type, urls, script, files } = e.data;
  if (type !== 'synth') return;

  try {
    // Lazy-load Yosys engine from the first working mirror URL
    if (!_yosys) {
      let lastErr;
      for (const url of urls) {
        try {
          const mod = await import(url);
          _yosys = mod.default || mod;
          break;
        } catch (err) {
          lastErr = err;
        }
      }
      if (!_yosys) {
        throw new Error(
          'Failed to load Yosys engine from all sources: ' +
          (lastErr?.message || 'unknown')
        );
      }
    }

    let out = '';
    const res = await _yosys.runYosys(['-p', script], encodeFiles(files), {
      stdout: b => { if (b) out += td.decode(b); },
      stderr: b => { if (b) out += td.decode(b); }
    });

    // 截断输出，只保留尾部关键信息（stat/error 总在末尾）
    const OUT_TAIL = 256 * 1024;
    const trimmedOut = out.length > OUT_TAIL
      ? '…[truncated ' + (out.length - OUT_TAIL) + ' bytes]…\n' + out.slice(-OUT_TAIL)
      : out;

    self.postMessage({ id, type: 'ok', out: trimmedOut, files: decodeFiles(res) });
  } catch (err) {
    self.postMessage({
      id,
      type: 'err',
      error: err?.message || String(err),
      out: err?.out || ''
    });
  }
};
