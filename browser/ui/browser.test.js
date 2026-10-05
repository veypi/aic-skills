import test from 'node:test';
import assert from 'node:assert/strict';
import {BrowserDirectory, browserCall} from './browser.js';
const tick = () => new Promise(r => setImmediate(r));
const host = id => ({id, status:'enabled', caps:{transports:{rtc:{enabled:true,protocol:'hosts_rtc/3'}}}});
const response = value => ({content:JSON.stringify(value),attrs:{exit_code:'0'}});

test('discovery keeps upstream page IDs scoped to their device and uses ordinary exec', async () => {
  const calls = [], closed = [];
  const directory = new BrowserDirectory({query:() => ({load:async () => ['a','b'].map(host),dispose(){}}),openTools:async id => ({
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
  const directory = new BrowserDirectory({query:() => ({load:async () => ['slow','ready'].map(host),dispose(){}}),openTools:async id => {
    if (id === 'slow') return new Promise(r => finish = r);
    return {execCall:async () => response({structuredContent:{response:{data:{tabs:[]}}}}),close:async () => closed++};
  }}, rows => seen.push(rows.find(r => r.id === 'ready')?.status));
  const pending = directory.refresh(); await tick();
  assert.ok(seen.includes('ready'));
  await directory.close(); finish({close:async () => closed++}); await pending;
  assert.equal(closed,2);
});
test('discovery distinguishes the RTC wait from browser startup without interrupting ready devices', async () => {
  let connected, listed;
  const phases = [];
  const tabs = new Promise(resolve => {listed = resolve;});
  const directory = new BrowserDirectory({
    query:() => ({load:async () => [host('a')], dispose(){}}),
    openTools:() => new Promise(resolve => {connected = resolve;}),
  }, rows => phases.push(rows[0].status));
  const pending = directory.refresh();
  await tick();
  assert.equal(phases.at(-1), 'connecting');
  connected({execCall:() => tabs, close:async () => {}});
  await tick();
  assert.equal(phases.at(-1), 'starting');
  listed(response({structuredContent:{response:{data:{tabs:[]}}}}));
  await pending;
  assert.equal(phases.at(-1), 'ready');
  phases.length = 0;
  await directory.refresh();
  assert.ok(phases.every(status => status === 'ready'));
  await directory.close();
});
test('failed probes require explicit retry, while host availability still updates', async () => {
  let current = host('a'), attempts = 0;
  const directory = new BrowserDirectory({
    query:() => ({load:async () => [current], dispose(){}}),
    openTools:async () => ({
      execCall:async () => {attempts++; throw new Error('browser service timeout');},
      close:async () => {},
    }),
  });
  await directory.refresh();
  await directory.refresh();
  assert.equal(attempts, 1);
  assert.equal(directory.rows[0].error, 'browser service timeout');
  await directory.refresh({retryFailed:true});
  assert.equal(attempts, 2);
  for (const [changes, status] of [
    [{last_seen:'2000-01-01T00:00:00Z'}, 'offline'],
    [{status:'disabled'}, 'disabled'],
    [{caps:{}}, 'unavailable'],
  ]) {
    const before = attempts;
    current = {...host('a'), ...changes};
    const rows = await directory.refresh();
    assert.equal(rows[0].status, status);
    assert.equal(rows[0].error, '');
    assert.equal(attempts, before, 'ineligible hosts never reconnect');
    current = host('a');
    await directory.refresh({retryFailed:true});
    assert.equal(directory.rows[0].status, 'error');
  }
  await directory.close();
});
for (const staleResult of ['list', 'error']) {
  test(`setPages survives a late ${staleResult} and other devices publishing their results`, async () => {
    let hosts = [host('ready')], finishList, failList, connectSlow, lists = 0, closed = 0;
    const snapshots = [];
    const tabList = tabs => response({structuredContent:{response:{data:{tabs}}}});
    const current = [{tabId:'t5', active:true, url:'https://current.test'}];
    const stale = [{tabId:'t4', active:true, url:'https://closed.test'}, ...current];
    const connection = {
      execCall:async () => ++lists === 1 ? tabList(stale) : new Promise((resolve, reject) => {
        finishList = resolve; failList = reject;
      }),
      close:async () => {closed++;},
    };
    const directory = new BrowserDirectory({
      query:() => ({load:async () => hosts, dispose(){}}),
      openTools:async id => id === 'ready' ? connection : new Promise(resolve => {connectSlow = resolve;}),
    }, rows => snapshots.push(rows.find(row => row.id === 'ready').pages.map(page => page.tabId)));
    await directory.refresh();
    hosts = [host('ready'), host('slow')];
    const pending = directory.refresh();
    await tick();
    const row = directory.rows[0];
    assert.throws(() => directory.setPages('ready', null), /Invalid agent-browser tab list/);
    snapshots.length = 0;
    directory.setPages('ready', current);
    assert.equal(directory.rows[0], row, 'updates the canonical row in place');
    assert.deepEqual(snapshots, [['t5']], 'publishes the fresh list immediately');
    if (staleResult === 'list') finishList(tabList(stale));
    else failList(new Error('old list timed out'));
    await tick();
    assert.equal(directory.connection('ready'), connection, 'stale failures retain the healthy connection');
    assert.equal(closed, 0);
    assert.equal(row.status, 'ready');
    assert.equal(row.error, '');
    connectSlow({execCall:async () => tabList([]), close:async () => {}});
    await pending;
    assert.deepEqual(directory.rows[0].pages, current);
    assert.ok(snapshots.every(pages => pages.length === 1 && pages[0] === 't5'),
      'the slow device cannot republish the closed tab');
    await directory.close();
    const published = snapshots.length;
    directory.setPages('ready', stale);
    assert.equal(snapshots.length, published, 'disposed directories do not publish updates');
  });
}
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
