# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
## [0.1.2] - 2026-10-30

### English

#### Fixed

- **Sidecar/subagent sessions no longer see (or misfire) the handoff tool**: sessions with a `parentSession` header (Desktop 副驾, pi-subagents workers) are excluded from handoff by the single-writer design, but the tool was still advertised to them. A sidecar model could call `session_handoff`, discover targets via the registry, then hit a misleading "当前会话尚未持久化" error and retry endlessly (observed live 2026-10-30 in a VE subagent). Now sidecars never get the tool activated, and an explicit call fails fast with `sidecar-not-allowed` and a clear message.

### 中文

#### 修复

- **侧车/子代理会话不再看到（或误用）交接工具**：带 `parentSession` header 的会话（Desktop 副驾、pi-subagents worker）按单写者设计被排除在交接之外，但工具此前仍被无条件激活。侧车模型调用 `session_handoff` 后能经 registry 发现目标，然后在 send 分支撞上误导性的「当前会话尚未持久化」并无限重试（2026-10-30 VE 子代理实测）。现在侧车不再激活该工具；被显式调用时 fail-fast 返回 `sidecar-not-allowed` 与明确说明。

## [0.1.1] - 2026-10-30

### English

#### Fixed

- **`action: "list"` no longer hangs when nothing answers the Desktop bridge**: list is a read-only query, but it awaited the `desktop-handoff` UI response with no timeout. In a plain TUI/rpc session there is no responder, so the tool call never returned and the model looked frozen. It now falls back after 1.5 s to the locally discovered candidates. `send` (a write) keeps waiting but fails explicitly after 30 s with "Desktop 侧未应答" instead of hanging forever.

### 中文

#### 修复

- **`action: "list"` 在无人应答 Desktop 桥时不再挂起**：list 是只读查询，此前却无限等待 `desktop-handoff` 的 UI 应答。纯 TUI/rpc 会话没有应答方，工具调用永不返回，模型侧表现为「卡住不动」。现在 1.5 秒后降级返回本地已发现的候选。`send`（写操作）仍会等待，但 30 秒后明确报「Desktop 侧未应答」，不再无限期挂起。


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
