import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sessionHandoff from '../index.mjs';

/**
 * queued 投递可靠性回归（2026-11-01 用户实测 VE 会话两条交接静默消失）。
 *
 * 根因：`queued` 只是收件方插件的内存队列副本——不进 Desktop 会话队列 UI（
 * run.view.queue 是 backend 的，另一套），不落盘，会话关闭时 queue.splice(0)
 * 全丢，只留一条用户在 UI 上看不到的 custom 审计条目。
 *
 * 三条不变量（破坏任一条这个文件都必须红）：
 *  1. 排队项必须**立即落盘**（session-handoff-queued custom entry），
 *     不能等到会话关闭才留痕——第二条消息就是关会话时彻底蒸发的。
 *  2. 会话重启（session_start）必须**恢复**未完成的排队项并继续投递，
 *     而不是当作从没发生过。
 *  3. 同一 idempotencyKey 不得重复投递（此前根本没实现去重表）。
 */

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-queued-'));

function fakePi() {
  const handlers = {};
  const entries = [];
  const tools = {};
  const notes = [];
  const activeTools = [];
  return {
    handlers,
    entries,
    tools,
    notes,
    activeTools: () => activeTools,
    on: (event, cb) => { (handlers[event] ??= []).push(cb); },
    registerTool: t => { tools[t.name] = t; },
    getActiveTools: () => activeTools,
    setActiveTools: t => { activeTools.length = 0; activeTools.push(...t); },
    getSessionName: () => '',
    appendEntry: (customType, data) => { entries.push({ customType, data }); },
    sendUserMessage: (text, opts) => { entries.push({ customType: '__sent', data: { text, opts } }); },
  };
}

const ctxFor = (opts = {}) => ({
  mode: 'rpc',
  cwd: opts.cwd ?? tempRoot,
  isIdle: opts.isIdle ?? (() => true),
  ui: { notify: opts.notify ?? (() => {}) },
  sessionManager: {
    getHeader: () => ({}),
    getSessionFile: () => opts.file ?? path.join(tempRoot, 'target.jsonl'),
    getSessionId: () => 'probe-id',
  },
});

/** 触发所有注册在某事件上的 handler（新实现可能注册多个）。 */
const fire = async (pi, event, ...args) => {
  for (const cb of pi.handlers[event] ?? []) await cb(...args);
};

/** 让 receive() 暴露出来：通过 transport.startPeer 的 receive 回调拿到。 */
function captureReceive(pi, registryDir) {
  const captured = {};
  return {
    captured,
    transport: {
      async startPeer({ receive }) {
        captured.receive = receive;
        return { update: async () => {}, close: async () => {} };
      },
      async discoverPeers() { return []; },
    },
  };
}

const sentTexts = pi => pi.entries.filter(e => e.customType === '__sent').map(e => e.data.text);

test('排队项必须立即落盘（不能只在会话关闭时留审计）', async () => {
  const pi = fakePi();
  const { captured, transport } = captureReceive(pi);
  sessionHandoff(pi, { env: {}, registryDir: path.join(tempRoot, 'r1'), transport });
  const cwd = fs.mkdtempSync(path.join(tempRoot, 'proj-'));
  const ctx = ctxFor({ cwd, isIdle: () => false }); // 目标忙
  await fire(pi, 'session_start', {}, ctx);

  const outcome = await captured.receive({ message: '任务A', source: { cwd: '/src' }, idempotencyKey: 'k-a' });
  assert.equal(outcome.disposition, 'queued');

  const queuedEntries = pi.entries.filter(e => e.customType === 'session-handoff-queued');
  assert.equal(queuedEntries.length, 1, '排队时必须立刻写一条 session-handoff-queued');
  assert.equal(queuedEntries[0].data.idempotencyKey, 'k-a');
  assert.equal(queuedEntries[0].data.message, '任务A');
});

test('会话重启后必须恢复未完成的排队项并继续投递', async () => {
  const cwd = fs.mkdtempSync(path.join(tempRoot, 'proj2-'));
  const file = path.join(cwd, 'target.jsonl');
  fs.writeFileSync(file, '');

  // 第一次生命周期：忙 → 排队 → 落盘
  {
    const pi = fakePi();
    const { captured, transport } = captureReceive(pi);
    sessionHandoff(pi, { env: {}, registryDir: path.join(tempRoot, 'r2'), transport });
    await fire(pi, 'session_start', {}, ctxFor({ cwd, file, isIdle: () => false }));
    await captured.receive({ message: '待恢复任务', source: { cwd: '/src' }, idempotencyKey: 'k-resume' });
    const rec = pi.entries.find(e => e.customType === 'session-handoff-queued');
    assert.ok(rec, '前置条件：排队必须已落盘');
  }

  // 第二次生命周期：空闲启动 → 必须恢复并投递
  const pi2 = fakePi();
  const { transport: t2 } = captureReceive(pi2);
  // 模拟 pi 从会话文件回放 custom entry
  pi2.handlers.session_start = [];
  sessionHandoff(pi2, {
    env: {},
    registryDir: path.join(tempRoot, 'r2'),
    transport: t2,
    readEntries: () => [{ customType: 'session-handoff-queued', data: { message: '待恢复任务', source: { cwd: '/src' }, idempotencyKey: 'k-resume' } }],
  });
  await fire(pi2, 'session_start', {}, ctxFor({ cwd, file, isIdle: () => true }));
  await new Promise(r => setTimeout(r, 50));

  const sent = sentTexts(pi2);
  assert.equal(sent.length, 1, `重启后必须把排队项投出去，实际发送：${JSON.stringify(sent)}`);
  assert.match(sent[0], /待恢复任务/);
});

test('同一 idempotencyKey 不得重复投递', async () => {
  const pi = fakePi();
  const { captured, transport } = captureReceive(pi);
  sessionHandoff(pi, { env: {}, registryDir: path.join(tempRoot, 'r3'), transport });
  const cwd = fs.mkdtempSync(path.join(tempRoot, 'proj3-'));
  await fire(pi, 'session_start', {}, ctxFor({ cwd, isIdle: () => false }));

  const first = await captured.receive({ message: '唯一任务', source: { cwd: '/s' }, idempotencyKey: 'dup-key' });
  assert.equal(first.disposition, 'queued');
  const second = await captured.receive({ message: '唯一任务', source: { cwd: '/s' }, idempotencyKey: 'dup-key' });
  assert.equal(second.disposition, 'duplicate', '同 key 第二次必须报告 duplicate，而不是再排一条');
  const queued = pi.entries.filter(e => e.customType === 'session-handoff-queued');
  assert.equal(queued.length, 1, '同 key 只能有一条排队记录');
});

test.after(() => { try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* ignore */ } });
