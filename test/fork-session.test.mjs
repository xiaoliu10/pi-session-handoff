import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sessionHandoff from '../index.mjs';

/**
 * 侧车 vs 分支会话识别回归（2026-10-31 用户实测 VE 分支会话反复报「尚未持久化」）：
 * - Desktop 侧车：文件名 sidecar_ 前缀，header 无 parentSession（backend.ts:197）
 * - 分支/编辑重发/fork：header 有 parentSession（session-manager createBranchedSession/fork）
 * 历史 bug：用 header.parentSession 判侧车 → 分支会话被误判 → 不建 peer → 误导性报错。
 */

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-fork-'));
const registryDir = path.join(tempRoot, 'registry');

function fakePi() {
  const handlers = {};
  let registered;
  const activeTools = [];
  return {
    handlers,
    registered: () => registered,
    activeTools: () => activeTools,
    on: (event, cb) => { handlers[event] = cb; },
    registerTool: t => { registered = t; },
    getActiveTools: () => activeTools,
    setActiveTools: t => { activeTools.length = 0; activeTools.push(...t); },
    getSessionName: () => '',
  };
}

const ctxFor = (opts = {}) => ({
  mode: 'rpc',
  cwd: opts.cwd ?? tempRoot,
  sessionManager: {
    getHeader: () => opts.header ?? {},
    getSessionFile: () => opts.file ?? path.join(tempRoot, 'nonexistent.jsonl'),
    getSessionId: () => 'probe',
  },
});

test('分支/编辑重发会话（header.parentSession 存在）必须建 peer 并注册', async () => {
  const pi = fakePi();
  sessionHandoff(pi, { env: {}, registryDir });
  const ctx = ctxFor({
    header: { parentSession: '/some/parent-session.jsonl' },
    file: path.join(tempRoot, 'forked-session.jsonl'),
  });
  await pi.handlers.session_start({}, ctx);
  assert.ok(pi.activeTools().includes('session_handoff'), '分支会话必须激活工具');
  // 触发 start()：分支会话应当建起 peer（registry 出现 descriptor）
  await pi.handlers.before_agent_start({ prompt: 'hello' }, ctx);
  await new Promise(r => setTimeout(r, 400));
  const dir = fs.existsSync(path.join(registryDir, 'descriptors')) ? fs.readdirSync(path.join(registryDir, 'descriptors')) : [];
  assert.ok(dir.some(n => n.startsWith('descriptor-')), `分支会话必须注册 descriptor，实际：${JSON.stringify(dir)}`);
});

test('侧车会话（sidecar_ 前缀）不建 peer、不激活工具', async () => {
  const pi = fakePi();
  sessionHandoff(pi, { env: {}, registryDir: path.join(tempRoot, 'reg2') });
  const ctx = ctxFor({ file: path.join(tempRoot, 'sidecar_123.jsonl') });
  await pi.handlers.session_start({}, ctx);
  assert.ok(!pi.activeTools().includes('session_handoff'), '侧车不得激活工具');
  await pi.handlers.before_agent_start({ prompt: 'hi' }, ctx);
  await new Promise(r => setTimeout(r, 300));
  const reg = path.join(tempRoot, 'reg2');
  const dir = fs.existsSync(path.join(reg, 'descriptors')) ? fs.readdirSync(path.join(reg, 'descriptors')) : [];
  assert.ok(!dir.some(n => n.startsWith('descriptor-')), '侧车不得注册 descriptor');
});

test.after(() => { try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* server holds dir */ } });
