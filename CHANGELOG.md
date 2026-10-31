# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
## [0.1.3] - 2026-10-31

### English

#### Fixed

- **Branched/forked/edited sessions can hand off again** (regression fix): sidecar detection wrongly used the session header's `parentSession` field. But `parentSession` is pi's own branch/fork marker (written by `createBranchedSession` for edit-resend, compaction branches and forks), while Desktop sidecar sessions are created with a `sidecar_` filename prefix and **no** `parentSession` at all. Every branch session therefore lost its peer and any `session_handoff` call failed with a misleading "当前会话尚未持久化" and retried forever (live report 2026-10-31 from a long-lived branched session in the pi-virtual-employee project). Detection now uses the `sidecar_` filename prefix, which is the only marker Desktop actually sets; the generic no-peer error also now says what is really wrong.

### 中文

#### 修复

- **分支/编辑重发/fork 会话恢复可交接**（回退上一版误伤修复）：侧车识别此前用 header 的 `parentSession` 字段，但那是 **pi 自己的分支/fork 标记**（`createBranchedSession` 为编辑重发、compact 分支、fork 写入），而 Desktop 侧车会话以 `sidecar_` 文件名前缀创建、**根本不写** `parentSession`。结果所有分支会话都被误判成侧车：不建 peer，调用 `session_handoff` 只能看到误导性的「当前会话尚未持久化」然后无限重试（2026-10-31 用户实测，pi-virtual-employee 项目一个长期在用的分支会话）。现在改用 `sidecar_` 文件名前缀（Desktop 唯一真实设置的标记），分支/重发会话恢复可用；通用 no-peer 报错也改成了说真话。


## [0.1.0] - 2026-10-29

### English

#### Added

- **Session handoff between local pi sessions**: the `session_handoff` tool delivers a self-contained task to another session running on the same machine — GUI to GUI, TUI to TUI, or across the two. The recipient keeps its own project, model, permissions and memory scope.
- **Busy targets queue instead of being interrupted**: a handoff sent to a session that is mid-turn waits behind the current turn rather than hijacking it.
- **Idempotent delivery**: a stable `idempotencyKey` is checked on the **receiving** side against a content fingerprint, so a retry after a timeout cannot deliver twice. The same key with different content is rejected rather than silently accepted.
- **Candidate disambiguation**: `action: "list"` returns candidates; duplicate session names return the list instead of guessing which one was meant.
- **Probe safety**: liveness checks use a dedicated route that answers without consuming a queued handoff, and an instance id so a closed session cannot impersonate a usable target.
- **Desktop bridge**: when running inside the desktop app, a target that is currently disconnected can still be reached — the main process reconnects it before delivering.

### 中文

#### 新增

- **本地 pi 会话之间的交接**：`session_handoff` 工具把一个自包含任务投递给本机另一个会话——GUI 到 GUI、TUI 到 TUI，以及两者之间互通。接收方保持自己的项目、模型、权限与记忆范围。
- **目标忙碌时排队而非打断**：投递给正在运行中的会话时，消息排在当前回合之后，不会抢占。
- **幂等投递**：`idempotencyKey` 在**接收方**按内容指纹校验，超时后重试不会二次投递；同一个键配不同内容会被拒绝，而不是静默接受。
- **候选消歧**：`action: "list"` 返回候选会话；重名时返回列表而不是猜测要发给谁。
- **探活安全**：存活性探测走专用路由，应答不消耗排队中的交接；描述符携带实例 ID，已关闭的会话不能伪装成可用目标。
- **Desktop 桥**：在桌面应用内运行时，目标会话即使当前未连接也能触达——主进程会先重连再投递。
