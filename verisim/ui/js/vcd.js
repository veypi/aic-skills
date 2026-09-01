/* VeriSim Pro - VCD parser (data only, no UI) */
function parseVCD(text) {
  const vars = {}, changes = {}, order = [];
  const scopeStack = [];
  let tmax = 0, timescale = '';
  let i = 0;
  const n = text.length;
  let curTime = 0;

  function readToken() {
    while (i < n && /\s/.test(text[i])) i++;
    const s = i;
    while (i < n && !/\s/.test(text[i])) i++;
    return text.slice(s, i);
  }

  while (i < n) {
    const ch = text[i];
    if (ch === '$') {
      const kw = readToken();
      if (kw === '$scope') {
        readToken();
        scopeStack.push(readToken());
      } else if (kw === '$upscope') {
        scopeStack.pop();
        readToken();
      } else if (kw === '$var') {
        readToken(); // type
        const width = +readToken();
        const id = readToken();
        const name = readToken();
        const full = [...scopeStack, name].join('.').replace(/^__vcd_dump__\./, '');
        vars[id] = { name: full, short: name, width };
        order.push(id);
        changes[id] = [];
        readToken(); // $end
      } else if (kw === '$timescale') {
        timescale = readToken();
        readToken();
      } else if (kw === '$enddefinitions') {
        readToken();
        break;
      } else {
        let t;
        do { t = readToken(); } while (t !== '$end' && i < n);
        if (kw === '$dumpvars') break;
      }
    } else {
      i++;
    }
  }

  while (i < n) {
    const ch = text[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '#') {
      i++;
      const s = i;
      while (i < n && !/\s/.test(text[i])) i++;
      curTime = parseInt(text.slice(s, i), 10) || 0;
      if (curTime > tmax) tmax = curTime;
      continue;
    }
    if (ch === 'b' || ch === 'B') {
      i++;
      const s = i;
      while (i < n && !/\s/.test(text[i])) i++;
      const bits = text.slice(s, i);
      i++;
      while (i < n && /\s/.test(text[i])) i++;
      const s2 = i;
      while (i < n && !/\s/.test(text[i])) i++;
      const id = text.slice(s2, i);
      if (changes[id]) changes[id].push([curTime, bits]);
      continue;
    }
    if (ch === '0' || ch === '1' || ch === 'x' || ch === 'X' || ch === 'z' || ch === 'Z') {
      const v = ch;
      i++;
      const s = i;
      while (i < n && !/\s/.test(text[i])) i++;
      const id = text.slice(s, i);
      if (changes[id]) changes[id].push([curTime, v]);
      continue;
    }
    i++;
    while (i < n && text[i] !== '\n') i++;
  }

  return { vars, order, changes, tmax, timescale };
}

function bitsToVal(bits) {
  if (/[xXzZ]/.test(bits)) return null;
  return BigInt('0b' + bits);
}

function fmtBits(bits, width) {
  if (bits === 'x' || /[xX]/.test(bits)) return width > 1 ? width + "'hx" : 'x';
  if (/[zZ]/.test(bits)) return width > 1 ? width + "'hz" : 'z';
  const v = bitsToVal(bits);
  if (v === null) return bits;
  return width > 1 ? '0x' + v.toString(16).toUpperCase() : String(v);
}

export default { parseVCD, bitsToVal, fmtBits };
