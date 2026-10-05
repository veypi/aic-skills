import test from 'node:test';
import assert from 'node:assert/strict';
import {BrowserDirectory, browserCall} from './browser.js';
const tick = () => new Promise(r => setImmediate(r));
const host = id => ({id, status:'enabled', caps:{transports:{rtc:{enabled:true,protocol:'hosts_rtc/3'}}}});
const response = value => ({content:JSON.stringify(value),attrs:{exit_code:'0'}});

test('discovery keeps upstream page IDs scoped to their device and uses ordinary exec', async () => {
  const calls = [], closed = [];
  const directory = new BrowserDirectory({directory:{list:async () => ['a','b'].map(host)},openTools:async id => ({
    execCall:async (...args) => {calls.push(args);return response({structuredContent:{response:{data:{tabs:[{tabId:'t1',url:'about:blank',active:true}]}}}})},
    close:async () => closed.push(id),
  })});
  const rows = await directory.refresh();
  assert.deepEqual(rows.map(r => [r.id,r.pages[0]]), ['a','b'].map(id => [id,{tabId:'t1',url:'about:blank',active:true}]));
  assert.deepEqual(calls,Array(2).fill(['mcp call browser agent_browser_tab_list --input - --json',{stdin:'{}'}]));
  await directory.close(); assert.deepEqual(closed.sort(),['a','b']);
});
test('slow device discovery does not block other devices; late connections close after disposal', async () => {
  let finish, closed = 0; const seen = [];
  const directory = new BrowserDirectory({directory:{list:async () => ['slow','ready'].map(host)},openTools:async id => {
    if (id === 'slow') return new Promise(r => finish = r);
    return {execCall:async () => response({structuredContent:{response:{data:{tabs:[]}}}}),close:async () => closed++};
  }}, rows => seen.push(rows.find(r => r.id === 'ready')?.status));
  const pending = directory.refresh(); await tick();
  assert.ok(seen.includes('ready'));
  await directory.close(); finish({close:async () => closed++}); await pending;
  assert.equal(closed,2);
});
test('tool names, parameters and complete MCP result survive exec without translation', async () => {
  const result = {content:[{type:'text',text:'upstream'},{type:'image',mimeType:'image/png',data:'AAAA'}],structuredContent:{response:{data:{tabs:[]}}},isError:false,_meta:{upstream:true}};
  const args = {url:'https://example.test/$(echo no); a b'};
  const connection = {execCall:async (script,options) => {
    assert.equal(script,'mcp call browser agent_browser_open --input - --json');
    assert.deepEqual(JSON.parse(options.stdin),args);
    return response(result);
  }};
  assert.deepEqual(await browserCall(connection,'agent_browser_open',args),result);
});
test('upstream errors and startup failures surface; shell metacharacters in tool names cannot execute', async () => {
  await assert.rejects(browserCall({execCall:async () => response({isError:true,content:[{type:'text',text:'upstream failed'}]})},'agent_browser_tab_list'),/upstream failed/);
  await assert.rejects(browserCall({execCall:async () => ({content:'',attrs:{exit_code:'126',stderr:'service not installed'}})},'agent_browser_tab_list'),/service not installed/);
  await assert.rejects(browserCall({execCall:async () => assert.fail('must not execute')},'agent_browser_tab_list; false'),/Invalid browser command/);
});
