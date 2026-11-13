import test from 'node:test';
import assert from 'node:assert/strict';
import {cuaCall, resultData} from './cua.js';

const encode = data => ({content: JSON.stringify(data), attrs: {exit_code: '0'}});

test('command parsing preserves MCP data, forwards clean options and rejects command injection', async () => {
  const raw = {structuredContent: {value: 7}, content: [{type: 'text', text: '{"ignored":true}'}]};
  const commands = [];
  const connection = {execCall: async (command, options) => {
    commands.push({command, options});
    assert.equal(options.stdin, JSON.stringify({text: '$(not-a-command) " quoted'}));
    assert.equal(options.waitMS, 1000);
    assert.equal(Object.hasOwn(options, 'imagePreview'), false);
    return encode(raw);
  }};
  assert.deepEqual(await cuaCall(connection, 'type_text', {text: '$(not-a-command) " quoted'}, {waitMS: 1000}), raw);
  assert.equal(commands[0].command, 'cua type_text --input - --json');
  assert.deepEqual(resultData({content: [{type: 'text', text: '{"windows":[]}'}]}), {windows: []});
  await assert.rejects(cuaCall(connection, 'click;echo'), /Invalid CUA command/);
  await assert.rejects(cuaCall({execCall: async () => encode({isError: true,
    structuredContent: {code: 'permission_denied'}, content: [{type: 'text', text: 'Permission denied'}]})}, 'check_permissions'),
  error => error.code === 'permission_denied' && error.message === 'Permission denied');
});

test('explicitly truncated command output reports bounded metadata and is never retried', async () => {
  const image = 'PRIVATE_SCREENSHOT_BASE64_'.repeat(400);
  const content = JSON.stringify({content: [{type: 'image', data: image, mimeType: 'image/png'}]});
  for (const truncated of [true, 1, 'true', '1']) {
    let executions = 0;
    const connection = {execCall: async () => {
      executions++;
      return {content, attrs: {exit_code: '0', truncated}};
    }};
    await assert.rejects(cuaCall(connection, 'check_permissions'), error => {
      assert.equal(error.code, 'output_truncated');
      assert.match(error.message, /cua check_permissions/);
      assert.match(error.message, new RegExp(`stdout ${new TextEncoder().encode(content).byteLength} bytes, exit 0`));
      assert.match(error.message, /reported truncated/);
      assert.equal(error.message.includes('PRIVATE_SCREENSHOT'), false);
      assert.equal(error.message.includes('image/png'), false);
      assert.ok(error.message.length < 400);
      return true;
    });
    assert.equal(executions, 1);
  }
});

test('invalid JSON at the old 8 MiB boundary identifies a possible limit without exposing image data', async () => {
  const prefix = '{"content":[{"type":"image","data":"';
  const content = prefix + 'A'.repeat(8 * 1024 * 1024 - prefix.length);
  let executions = 0;
  await assert.rejects(cuaCall({execCall: async () => {
    executions++;
    return {content, attrs: {exit_code: '0'}};
  }}, 'check_permissions'), error => {
    assert.equal(error.code, 'invalid_response');
    assert.match(error.message, /stdout 8388608 bytes, exit 0/);
    assert.match(error.message, /exactly 8 MiB.*may have hit an older Pod output limit/);
    assert.equal(error.message.includes('AAAAAAAA'), false);
    assert.equal(error.message.includes(prefix), false);
    assert.ok(error.message.length < 400);
    return true;
  });
  assert.equal(executions, 1);
});

test('other invalid responses disclose only UTF-8 size and status and never replay a mutation', async () => {
  const content = '不是JSON: private screen text';
  let executions = 0;
  await assert.rejects(cuaCall({execCall: async () => {
    executions++;
    return {content, attrs: {exit_code: '0', truncated: 'false'}};
  }}, 'type_text', {text: 'may already have been typed'}), error => {
    assert.equal(error.code, 'invalid_response');
    assert.match(error.message, /cua type_text/);
    assert.match(error.message, new RegExp(`stdout ${new TextEncoder().encode(content).byteLength} bytes, exit 0`));
    assert.match(error.message, /may be incomplete or truncated/);
    assert.equal(error.message.includes('8 MiB'), false);
    assert.equal(error.message.includes('private screen text'), false);
    assert.equal(error.message.includes('may already have been typed'), false);
    return true;
  });
  assert.equal(executions, 1);
});

test('ordinary command failures prefer useful bounded stderr without copying embedded image output', async () => {
  const image = 'PRIVATE_SCREENSHOT_BASE64'.repeat(500);
  const response = {isError: true, structuredContent: {code: 'permission_denied'},
    content: [{type: 'text', text: 'Less useful fallback'}, {type: 'image', data: image}]};
  let executions = 0;
  await assert.rejects(cuaCall({execCall: async () => {
    executions++;
    return {content: JSON.stringify(response), attrs: {exit_code: '1',
      stderr: '[error] Screen access denied\n' + JSON.stringify({type: 'image', data: image})}};
  }}, 'click'), error => {
    assert.equal(error.code, 'permission_denied');
    assert.match(error.message, /\[error\] Screen access denied/);
    assert.equal(error.message.includes('Less useful fallback'), false);
    assert.equal(error.message.includes('PRIVATE_SCREENSHOT'), false);
    assert.ok(error.message.length < 700);
    return true;
  });
  assert.equal(executions, 1);
  const large = 'Permission denied. '.repeat(3000);
  await assert.rejects(cuaCall({execCall: async () => ({content: JSON.stringify(response),
    attrs: {exit_code: '1', stderr: large}})}, 'check_permissions'), error => {
    assert.match(error.message, /Permission denied/);
    assert.match(error.message, /diagnostic shortened/);
    assert.ok(error.message.length < 700);
    return true;
  });
});

test('invalid JSON failures retain useful stderr and stable status instead of echoing stdout', async () => {
  let executions = 0;
  await assert.rejects(cuaCall({execCall: async () => {
    executions++;
    return {content: 'PRIVATE RAW OUTPUT', attrs: {exit_code: '127', stderr: 'cua-driver is unavailable'}};
  }}, 'press_key', {key: 'return'}), error => {
    assert.equal(error.code, 'invalid_response');
    assert.match(error.message, /cua press_key/);
    assert.match(error.message, /exit 127/);
    assert.match(error.message, /cua-driver is unavailable/);
    assert.equal(error.message.includes('PRIVATE RAW OUTPUT'), false);
    return true;
  });
  assert.equal(executions, 1);
  await assert.rejects(cuaCall({execCall: async () => ({content: '{"content":{}}', attrs: {exit_code: '0'}})}, 'check_permissions'),
    error => error.code === 'invalid_response');
});
