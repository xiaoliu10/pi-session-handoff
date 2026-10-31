import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sessionHandoff from '../index.mjs';

/**
 * 侧车/子代理会话（parentSession header 或 PI_DESKTOP_SIDECAR=1）回归：
 * 1. session_start 不得把 session_handoff 激活给侧车模型（此前无条件激活，
 *    侧车模型调用后在 send 分支撞「尚未持久化」无限重试——2026-10-30 用户实测）
 * 2. 侧车调用工具必须 fail-fast 并给出明确原因（sidecar-not-allowed），
 *    而不是误导性的「尚未持久化」
 */

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-sidecar-'));
const registryDir = path.join(tempRoot, 'registry');
const cleanup = () => { try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* watcher may hold */ } };

function fakePi() {
  const handlers = {};
  let registered;
  let activeTools = [];
  return {
    handlers,
    registered: () => registered,
    activeTools: () => activeTools,
    on: (event, cb) => { handlers[event] = cb; },
    registerTool: t => { registered = t; },
    getActiveTools: () => activeTools,
    setActiveTools: t => { activeTools = t; },
    getSessionName: () => '',
  };
}

const baseCtx = overrides => ({
  mode: 'rpc',
  cwd: os.tmpdir(),
  sessionManager: {
    getHeader: () => ({}),
    getSessionFile: () => path.join(os.tmpdir(), 'nonexistent-probe.jsonl'),
    getSessionId: () => 'probe-id',
  },
  ...overrides,
});

test('主会话：session_start 激活 session_handoff', async () => {
  const pi = fakePi();
  sessionHandoff(pi, { env: {}, registryDir });
  assert.equal(pi.registered().name, 'session_handoff');
  await pi.handlers.session_start({}, baseCtx());
  assert.ok(pi.activeTools().includes('session_handoff'), 'tool should be activated for main sessions');
});

test('侧车（parentSession header）：不激活工具，调用 fail-fast 为 sidecar-not-allowed', async () => {
  const pi = fakePi();
  sessionHandoff(pi, { env: {}, registryDir });
  const ctx = baseCtx({ sessionManager: { getHeader: () => ({ parentSession: '/some/parent.jsonl' }), getSessionFile: () => path.join(os.tmpdir(), 'sc.jsonl'), getSessionId: () => 'sc' } });
  await pi.handlers.session_start({}, ctx);
  assert.ok(!pi.activeTools().includes('session_handoff'), 'tool must NOT be advertised to sidecars');
  // 即使被显式调用（工具列表未刷新/模型硬调），也要给出明确错误而不是「尚未持久化」
  const result = await pi.registered().execute('id', { action: 'send', sessionKey: 'x', message: 'hi' }, undefined, undefined, ctx);
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /子代理（sidecar）/);
  assert.equal(result.details.error, 'sidecar-not-allowed');
});

test('侧车（PI_DESKTOP_SIDECAR=1）：同样不激活、fail-fast', async () => {
  const pi = fakePi();
  sessionHandoff(pi, { env: { PI_DESKTOP_SIDECAR: '1' }, registryDir });
  await pi.handlers.session_start({}, baseCtx());
  assert.ok(!pi.activeTools().includes('session_handoff'));
  const result = await pi.registered().execute('id', { action: 'list' }, undefined, undefined, baseCtx());
  assert.equal(result.details.error, 'sidecar-not-allowed');
});
