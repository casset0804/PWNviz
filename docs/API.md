# API 参考（V1.1）

Base URL：`http://127.0.0.1:8000`（WSL 内 uvicorn）。
前端开发服务器 `http://127.0.0.1:5173` 通过 Vite proxy 转发 `/api` 与 `/health`。

所有响应均为 JSON。错误统一为：

```json
{
  "error": {
    "code": "invalid_session_state",
    "message": "Session is RUNNING; this action requires STOPPED.",
    "params": { "state": "RUNNING", "required": "STOPPED" },
    "detail": { "available": ["stack-basic"] }
  }
}
```

`params` 是 V1.1 新增的可选结构化参数，供前端本地化（见
[docs/I18N.md §5](I18N.md)）；`message` 保持英文原文以便日志与旧客户端使用，
GDB 自身返回的文本永远原样保留。

| HTTP | `code` | 场景 |
|---|---|---|
| 400 | （Starlette）`Invalid host header` | `Host` 不在 `PWNVIZ_ALLOWED_HOSTS` 白名单 |
| 403 | `cross_site_blocked` | 浏览器跨站请求（`Sec-Fetch-Site: cross-site`） |
| 403 | `non_local_client` | 非 loopback 客户端；除非 `PWNVIZ_ALLOW_REMOTE=1` |
| 404 | `sample_not_found` | 样例不存在 |
| 404 | `session_not_found` | 会话不存在或已删除 |
| 409 | `invalid_session_state` | 动作与当前状态不符（如未 launch 就 step） |
| 409 | `sample_not_built` | 样例 ELF 尚未编译 |
| 409 | `session_closed` | 会话终止/关闭时操作仍在进行 |
| 422 | `invalid_request` | 请求参数校验失败 |
| 429 | `too_many_sessions` | 超过 `PWNVIZ_SESSION_MAX_ACTIVE` |
| 502 | `debugger_error` | GDB/MI 命令失败 |
| 504 | `debugger_timeout` | 等待 GDB stopped / 快照超时 |
| 503 | `debugger_unavailable` | GDB 不可用（预留） |
| 503 | `capability_probe_failed` | 探测无有效结果 |

地址与 64-bit 值一律十六进制字符串（Phase 1 快照协议），绝不使用 JS Number。

本机安全护栏：`API_HOST` 非 loopback 时 `python -m app` 默认拒绝启动；CORS 不启用
credentials；跨站浏览器请求在到达路由前被拒绝；`Host` 头受白名单约束。

---

## GET `/health`

廉价健康检查，不启动 GDB。用于前端连接状态。

实测响应（2026-11-03）：

```json
{
  "status": "ok",
  "service": "pwnviz-backend",
  "version": "0.1.0",
  "timestamp": "2026-11-03T01:27:23Z",
  "uptime_seconds": 4.698,
  "gdb_binary": "gdb",
  "samples_dir": "/mnt/f/Pwnvis/samples"
}
```

---

## GET `/api/v1/capabilities`

真实探测宿主调试能力：

1. `gdb --version` 并解析版本；
2. `gdb -batch -ex "python ..."` 获取内嵌 Python 版本；
3. `gdb --batch --interpreter=mi3 -ex "python print(marker)"` 验证 MI3；
4. 扫描 pwndbg 安装位置（配置 / 环境变量 / `~/.gdbinit` / 常见目录）；
5. 扫描样例目录（不执行任何程序）。

实测响应（quick 模式，`verify_pwndbg` 未开启）：

```json
{
  "generated_at": "2026-11-03T01:27:28Z",
  "service_version": "0.1.0",
  "platform": {
    "system": "Linux",
    "release": "6.6.87.2-microsoft-standard-WSL2",
    "machine": "x86_64",
    "architecture": "x86-64",
    "is_x86_64": true,
    "hostname": "localhost"
  },
  "python": {
    "backend_version": "3.10.12",
    "gdb_embedded_version": "3.10.12"
  },
  "gdb": {
    "available": true,
    "path": "/usr/bin/gdb",
    "version": "12.1",
    "minimum_version": "12.1.0",
    "supported": true,
    "supports_mi3": true,
    "python": { "available": true, "version": "3.10.12", "error": null },
    "error": null,
    "duration_ms": 40
  },
  "pwndbg": {
    "status": "detected",
    "path": "/home/casset/pwndbg",
    "gdbinit": "/home/casset/pwndbg/gdbinit.py",
    "verified": false,
    "version": null,
    "detail": "pwndbg installation found on disk; not loaded by this probe. Use ?verify_pwndbg=true to prove it loads.",
    "enabled": true
  },
  "samples": { "directory": "/mnt/f/Pwnvis/samples", "count": 1 },
  "ready": true,
  "warnings": []
}
```

### Query：`?verify_pwndbg=true`

实际启动一个一次性 GDB 加载 pwndbg，成功后返回：

```json
{
  "pwndbg": {
    "status": "verified",
    "path": "/home/casset/pwndbg",
    "gdbinit": "/home/casset/pwndbg/gdbinit.py",
    "verified": true,
    "version": "2026.07.29",
    "detail": "pwndbg loaded successfully in a verification GDB process.",
    "enabled": true
  }
}
```

失败时 `status` 为 `load_failed`，`detail` 含失败原因，`warnings` 追加提示，
`ready` 仍可为 `true`（原生 GDB 不受影响）。

### `pwndbg.status` 取值

| 值 | 含义 |
|---|---|
| `not_found` | 未发现安装 |
| `detected` | 磁盘上发现，但本次未加载 |
| `verified` | 已真实加载并输出标记 |
| `load_failed` | 发现但加载失败 / 超时 |

### 缓存

- 默认缓存 30 秒（`PWNVIZ_CAPABILITIES_CACHE_SECONDS`）；
- 一旦 pwndbg 验证成功，后续 quick 请求也直接返回已验证结果；
- **失败验证不缓存**：`load_failed` 不写入缓存，验证按钮可立即重试
  （`tests/integration/test_api.py::test_failed_pwndbg_verification_stays_retryable`）。

### 配置来源

| 环境变量 | 影响字段 |
|---|---|
| `GDB_PATH` | `gdb.*` 探测使用的可执行文件 |
| `PWNDBG_INIT` | `pwndbg.path` / `pwndbg.gdbinit` 的优先候选 |
| `ALLOWED_SAMPLE_DIR` | `samples.directory` 与样例扫描根目录 |
| `API_HOST` / `API_PORT` | 后端监听地址（`python -m app`） |
| `PWNVIZ_ALLOW_REMOTE` | 允许非 loopback 绑定与客户端（默认拒绝） |
| `PWNVIZ_ALLOWED_HOSTS` | `Host` 头白名单（默认 `127.0.0.1,localhost,testserver`） |

### GDB 缺失时

进程照常启动，`/health` 仍为 200；`/capabilities` 返回 200 但降级：

```json
{
  "ready": false,
  "gdb": {
    "available": false,
    "version": null,
    "supports_mi3": false,
    "python": { "available": false, "version": null, "error": "..." },
    "error": "GDB binary '/nonexistent/pwnviz-gdb' not found or not executable: ... or set GDB_PATH."
  },
  "warnings": ["GDB binary '/nonexistent/pwnviz-gdb' not found or not executable: ..."]
}
```

### 探测内部异常

若探测代码抛出未预期异常，接口返回 503，而不是裸 500：

```json
{
  "error": {
    "code": "capability_probe_failed",
    "message": "Capability probe failed unexpectedly.",
    "detail": { "error": "RuntimeError: ..." }
  }
}
```

---

## GET `/api/v1/samples`

扫描 `samples/*/demo.c`，读取 `README.md` 的首个标题与首段作为标题/描述，
并报告二进制是否存在（不执行）。

> V1.2 增加第二个真实教学样例 `pointer-basic`（`p = &a`、`q = &b`、`NULL`），
> 用于验证栈帧图中的指针连线；旧的 `stack-basic` 仍是默认主样例。

实测响应：

```json
{
  "samples_dir": "/mnt/f/Pwnvis/samples",
  "count": 1,
  "samples": [
    {
      "id": "stack-basic",
      "title": "stack-basic",
      "description": "First teaching sample: a tiny function call whose stack frame is easy to follow.",
      "directory": "/mnt/f/Pwnvis/samples/stack-basic",
      "source_file": "/mnt/f/Pwnvis/samples/stack-basic/demo.c",
      "binary_file": "/mnt/f/Pwnvis/samples/stack-basic/demo",
      "binary_exists": true,
      "binary_size": 17464,
      "binary_built_at": "2026-11-03T01:26:47Z",
      "build_command": [
        "gcc", "-g", "-O0", "-fno-omit-frame-pointer", "-fno-inline",
        "-fno-pie", "-no-pie",
        "-o", "/mnt/f/Pwnvis/samples/stack-basic/demo",
        "/mnt/f/Pwnvis/samples/stack-basic/demo.c"
      ]
    }
  ]
}
```

## GET `/api/v1/samples/{sample_id}`

返回单个 `SampleInfo`。`sample_id` 必须匹配 `^[a-z0-9][a-z0-9._-]{0,63}$`，
不存在时返回 404 `sample_not_found`。

## GET `/api/v1/samples/{sample_id}/source`

V1.2 新增：返回某个教学样例的**真实源文件文本**，用于演示模式的
“源码 / 汇编”切换。路径不来自客户端，而是由样例注册表解析，并再次校验必须位于
`ALLOWED_SAMPLE_DIR` 内；只读、限长（512 KiB），不会执行任何内容。

```json
{
  "sample_id": "stack-basic",
  "source_file": "/mnt/f/Pwnvis/samples/stack-basic/demo.c",
  "language": "c",
  "content": "#include <stdio.h>\n...",
  "line_count": 15,
  "truncated": false
}
```

不存在或越界返回 404 `sample_not_found`；文件存在但读取失败返回
500 `sample_source_unavailable`。前端在接口不可用时明确显示“源码不可用”，
不会伪造源码。

---

## 会话生命周期

```text
CREATED ──launch──> INITIALIZING ──load/break/run──> RUNNING
                                                        │
                                              *stopped  ▼
                                                    STOPPED ──step/continue/...──> RUNNING
                                                        │
                                      inferior exit     ▼
                                                     EXITED

任意阶段出错 ──> ERROR；DELETE ──> TERMINATED（并从管理器移除）
```

- 每个 session 拥有**一个持久 GDB/MI3 子进程**，不会每次单步重启；
- 同一 session 的高层动作与快照采集使用同一把 `asyncio.Lock` 串行化；
- MI 写命令另有短锁，命令使用递增 token，响应按 token 归属，异步 notify
  独立排队；命令超时不会关闭 reader；
- 只有收到 `*stopped` 后才采集快照；进程 running 时拒绝读取快照；
- 目标退出/失败时 GDB 仍由 `DELETE` 或后端 shutdown 回收。
- 目标（inferior）退出后控制器会**自动关闭 GDB**：`gdb_pid` 变为 `null`，
  会话与快照历史仍保留，DELETE 仍可安全调用。

## POST `/api/v1/sessions`

创建会话（尚不启动 GDB）。请求：

```json
{
  "sample_id": "stack-basic",
  "stop_at": "main",
  "load_pwndbg": false
}
```

`sample_id` 只允许 `^[a-z0-9][a-z0-9._-]{0,63}$`，`stop_at` 只允许符号名
`^[A-Za-z_][A-Za-z0-9_.]{0,127}$`（不会拼接为任意 GDB 命令）。
`load_pwndbg` 省略时使用 `PWNVIZ_LOAD_PWNDBG`。

响应 `201`（真实结构示例）：

```json
{
  "session_id": "sess_...",
  "sample_id": "stack-basic",
  "state": "CREATED",
  "created_at": "2026-11-03T02:00:00Z",
  "updated_at": "2026-11-03T02:00:00Z",
  "snapshot_count": 0,
  "gdb_pid": null,
  "inferior_pid": null,
  "last_error": null,
  "stop_reason": null
}
```

样例未编译返回 `409 sample_not_built`，`detail.build_command` 给出编译命令。

## GET `/api/v1/sessions/{session_id}`

返回同一个 `SessionInfo`。launch 后包含真实 `gdb_pid` / `inferior_pid`；
DELETE 后返回 404。

## POST `/api/v1/sessions/{session_id}/launch`

真实执行：

```text
gdb --quiet --nx --interpreter=mi3
-gdb-set confirm off / pagination off / width 0 / height 0 / mi-async on
[-interpreter-exec console "source <PWNDBG_INIT>"]   # 可选，失败仅 warning
-file-exec-and-symbols "<sample binary>"
-break-insert main
-exec-run
```

等待 `*stopped,reason="breakpoint-hit"` → 采集第一份快照。响应：

```json
{
  "session_id": "sess_...",
  "state": "STOPPED",
  "snapshot": { "...": "见下方 Snapshot" },
  "message": null
}
```

只有 `CREATED` 状态可 launch，否则 `409 invalid_session_state`。
GDB 启动/命令失败 → `502 debugger_error`，会话进入 `ERROR` 并回收进程。

## POST `/api/v1/sessions/{session_id}/actions`

请求：`{"action": "step_instruction"}`，可选 `{"mode": "fast"|"full"}`。
动作白名单：

| action | GDB/MI 命令 | 语义 |
|---|---|---|
| `launch` / `run` | 见上 | 仅 `CREATED` 可用 |
| `step_instruction` | `-exec-step-instruction` | 单步一条机器指令 |
| `next_instruction` | `-exec-next-instruction` | 指令级 step over |
| `step` | `-exec-step` | 源码级 step into |
| `next` | `-exec-next` | 源码级 step over |
| `finish` | `-exec-finish` | 运行到当前帧返回（最外层会返回 502） |
| `continue` | `-exec-continue` | 异步运行；返回时通常仍为 `RUNNING` |
| `interrupt` | `-exec-interrupt` | 仅 `RUNNING` 可用；停止事件随后到达 |

- `stepi/nexti/step/next/finish`：动作在 HTTP 响应前等待对应 `*stopped` 与快照，
  成功响应包含新 `snapshot`；
- `continue/interrupt`：返回命令被 GDB 接受后的状态，后续 `session.state` 与
  `snapshot` 通过 WebSocket 推送；REST 轮询 `GET /sessions/{id}` 也可观察；
- 非 `STOPPED`（step 类）或非 `RUNNING`（interrupt）返回 `409`；
- 快速连点：第二个请求会因状态变为 `RUNNING` 被拒绝，不会并发写 GDB。
- `mode` 省略时使用 `PWNVIZ_SNAPSHOT_MODE`（默认 `fast`）；`launch` 始终为
  `full`。

## POST `/api/v1/sessions/{session_id}/refresh`

不执行任何指令，只对当前停止点重新采集（帧、反汇编、DWARF 变量）。请求可选：

```json
{ "mode": "full" }
```

响应与动作响应相同（`state` + `snapshot`），新快照的
`variables_state="full"`、`frames_state="fresh"`。这是变量面板「刷新变量」
按钮的接口；仅 `STOPPED` 状态可用，否则 `409 invalid_session_state`。

## GET `/api/v1/sessions/{session_id}/performance`

返回最近一次与最近 20 次快照的性能数据及 p50/p95 聚合：

```json
{
  "session_id": "sess_...",
  "last": { "snapshot_id": 12, "mode": "fast", "total_ms": 46.2,
            "registers_ms": 9.1, "frames_ms": 0.0, "disassembly_ms": 0.1,
            "memory_ms": 9.4, "variables_ms": 5.2, "diff_ms": 0.2,
            "serialize_ms": 1.8, "broadcast_ms": 0.1, "ws_send_ms": 0.4,
            "mi_command_count": 4, "mi_time_ms": 35.8,
            "stack_read_commands": 1, "variable_commands": 1,
            "memory_batch_reads": 1, "memory_chunk_reads": 0,
            "payload_bytes": 18410, "disassembly_source": "cache",
            "frames_state": "cached", "variables_state": "updated" },
  "samples": 12,
  "aggregate": {
    "total_ms": { "count": 12, "min": 42.1, "p50": 46.2, "p95": 61.0,
                  "max": 61.0, "mean": 47.5 },
    "mi_command_count": { "count": 12, "p50": 4, "p95": 6, "max": 6, "mean": 4.2 }
  },
  "recent": [ { "snapshot_id": 12, "...": "..." } ]
}
```

历史长度由 `PWNVIZ_PERF_HISTORY_SIZE`（默认 120）限制。
`ws_send_ms` 只在这里出现（WebSocket 发送发生在快照发布之后）。

## GET `/api/v1/sessions/{session_id}/snapshots`

```json
{
  "session_id": "sess_...",
  "count": 2,
  "snapshots": [ { "...": "Snapshot[]，最旧在前" } ]
}
```

每个 session 最多保留 `PWNVIZ_SESSION_MAX_SNAPSHOTS`（默认 200）条；
`snapshot_id` 单调递增。

## DELETE `/api/v1/sessions/{session_id}`

`204 No Content`。发送 `-gdb-exit`，等待 GDB 退出，必要时 kill 整个进程组，
然后从管理器移除；GDB 与 inferior 进程都应消失。DELETE 请求本身被取消时，
后端仍会在受保护的管理器 task 中完成清理。

## WS `/api/v1/sessions/{session_id}/stream`

- 只接受已存在 session；未知 id 以 `4404` 关闭；
- 浏览器 `Origin` 不在 `PWNVIZ_ALLOWED_ORIGINS` 时以 `4403` 关闭；
- 默认还要求客户端为 loopback；非 loopback 以 `4403` 关闭（除非
  `PWNVIZ_ALLOW_REMOTE=1`）；
- 连接后先推当前 `session.state`，若有历史再推最近一条 `snapshot`；
  若已创建初始断点，再推 `breakpoints.updated`；
- 之后实时推送状态/快照/GDB 输出/断点/终止事件；
- 客户端必须忽略 `snapshot_id` 小于当前快照的旧消息；重复消息应幂等处理；
- DELETE 时推送 `session.terminated` 后关闭；
- 每订阅队列上限 256 条；慢客户端满队列时丢弃最旧事件，保留最新状态。

事件结构：`{"type": "...", "session_id": "...", "payload": {...}}`。

```json
{"type":"session.state","session_id":"sess_...","payload":{
  "state":"STOPPED","stop_reason":"breakpoint-hit","last_error":null,
  "updated_at":"2026-11-03T02:03:56Z"}}
```

```json
{"type":"snapshot","session_id":"sess_...","payload":{ "...": "完整 Snapshot" }}
```

```json
{"type":"debugger.output","session_id":"sess_...","payload":{
  "stream":"mi|console|log|output|target",
  "text":"Breakpoint 1, main () at demo.c:10",
  "seq":42}}
```

`seq` 单调递增；客户端可用它丢弃重连后重复的旧日志。

```json
{"type":"breakpoints.updated","session_id":"sess_...","payload":{
  "breakpoints":[{"number":"1","address":"0x0000000000401160",
    "function":"main","file":".../demo.c","line":10,"enabled":true}]}}
```

`session.terminated`：`{"type":"session.terminated","payload":{"state":"TERMINATED"}}`。

## Snapshot 结构（真实字段）

```json
{
  "session_id": "sess_...",
  "snapshot_id": 2,
  "timestamp": "2026-11-03T02:03:59Z",
  "state": "STOPPED",
  "stop_reason": "end-stepping-range",
  "architecture": "x86-64",
  "endianness": "little",
  "pointer_bits": 64,
  "registers": {
    "rip": "0x0000000000401167",
    "rsp": "0x00007fffffffe270",
    "rbp": "0x00007fffffffe280",
    "rax": "0x0000000000401154",
    "eflags": "0x0000000000000202"
  },
  "frames": [
    {
      "level": 0,
      "address": "0x0000000000401167",
      "function": "main",
      "file": "/.../samples/stack-basic/demo.c",
      "line": 11
    },
    {
      "level": 1,
      "address": "0x00007ffff7c29d90",
      "function": "__libc_start_call_main",
      "file": "../sysdeps/nptl/libc_start_call_main.h",
      "line": 58
    }
  ],
  "instruction": {
    "address": "0x0000000000401167",
    "bytes": "c745f814000000",
    "mnemonic": "movl",
    "operands": "$0x14,-0x8(%rbp)",
    "text": "movl   $0x14,-0x8(%rbp)",
    "function": "main"
  },
  "disassembly": [
    {"address": "0x0000000000401160", "text": "movl   $0xa,-0xc(%rbp)",
     "is_current": false, "function": "main"},
    {"address": "0x0000000000401167", "text": "movl   $0x14,-0x8(%rbp)",
     "is_current": true, "function": "main"}
  ],
  "stack": {
    "range_start": "0x00007fffffffe1f0",
    "range_end": "0x00007fffffffe3f0",
    "word_size": 8,
    "rows": [
      {
        "address": "0x00007fffffffe270",
        "bytes": ["00","10","00","00","0a","00","00","00"],
        "readable": true,
        "qword_le": "0x0000000a00000010",
        "ascii": "........",
        "annotations": ["RSP"],
        "changed_byte_offsets": [4]
      }
    ],
    "unreadable_ranges": []
  },
  "diff": {
    "previous_snapshot_id": 1,
    "changed_registers": ["rip"],
    "changed_bytes": [
      {"address":"0x00007fffffffe274","before":"00","after":"0a"}
    ],
    "window_changed": false
  },
  "variables": [
    {
      "name": "local_int",
      "type": "int",
      "value": "42",
      "address": "0x00007fffffffe234",
      "size_bytes": 4,
      "location_kind": "memory",
      "source": "dwarf",
      "confidence": "debug-info",
      "kind": "scalar",
      "is_argument": false,
      "frame_level": 0,
      "children": [],
      "string_value": null,
      "pointer_target": null,
      "target_readable": null,
      "target_bytes": null,
      "target_string": null,
      "target_source": null
    }
  ],
  "variables_available": true,
  "warnings": [],
  "mode": "fast",
  "frames_state": "cached",
  "frames_stale": true,
  "frames_version": 1,
  "variables_state": "updated",
  "variables_stale": false,
  "variables_version": 2,
  "perf": {
    "snapshot_id": 2,
    "mode": "fast",
    "total_ms": 46.2,
    "registers_ms": 9.1,
    "frames_ms": 0.0,
    "disassembly_ms": 0.1,
    "memory_ms": 9.4,
    "variables_ms": 5.2,
    "diff_ms": 0.2,
    "serialize_ms": 1.8,
    "broadcast_ms": 0.1,
    "ws_send_ms": null,
    "mi_command_count": 4,
    "mi_time_ms": 35.8,
    "mi_by_command": { "-exec-step-instruction": 1,
      "-data-list-register-values": 1, "-data-read-memory-bytes": 1,
      "-var-update": 1 },
    "stack_read_commands": 1,
    "memory_batch_reads": 1,
    "memory_chunk_reads": 0,
    "memory_degraded": false,
    "variable_commands": 1,
    "disassembly_source": "cache",
    "disassembly_version": 1,
    "payload_bytes": 18410
  }
}
```

> V1.1 新增字段（`mode`、`frames_*`、`variables_*`、`perf`）均可选，旧客户端
> 可忽略。`current_value` 语义：
> `variables_state=updated` 表示用 `-var-update` 增量刷新过，值是当前值；
> `cached` 表示刷新失败、展示上次测量值且 `variables_stale=true`；
> `deferred` 表示 Fast 快照没有可用变量缓存（用 `/refresh` 触发完整读取）。

> `variables_available=false` 表示没有 DWARF 变量信息；此时 raw stack 和
> registers 仍然完整。`source=dwarf` / `confidence=debug-info` 表示类型、值和
> 地址来自 GDB variable objects；`target_source=gdb-memory` 表示 pointer target
> 字节来自单次、最多 64 字节的 GDB 内存读取。`kind` 是从 GDB type 语法派生的
> 展示分类，不是从 raw qword 猜测的变量。

> V1.2 新增 `variables[].size_bytes`：由 GDB `sizeof(<path>)` 实测的字节数，
> 供图形化栈帧图按真实大小绘制内存块；未测量时为 `null`，前端不会用类型字符串
> 猜造大小，只有原始类型才回退到 ABI 推断并标注 `≈ ABI`。

> V1.2 起 session 启动时显式执行 `set backtrace past-main on`。GDB 在 `--nx`
> 且未加载用户 init 时默认停在 `main`，调用者帧会缺失；开启后 `frames` 会包含
> `__libc_start_call_main` 等真实调用者，供栈帧图与 unwinder 交叉验证。该设置
> 只改变展开深度，不伪造任何帧。

> 示例来自本机真实会话，`rows`/`disassembly` 为简洁只保留相关行。
> 完整快照包含 `rsp-0x80 .. rsp+0x180` 的 64 行（上限受配置约束）。

### 不可读内存表示

GDB 对不可读区域返回 `^error`（例如跨未映射页）。V1.1 默认用**一条**
`-data-read-memory-bytes` 读取整个窗口（≤ `PWNVIZ_MEMORY_BATCH_MAX_BYTES`）；
批量失败或只返回部分字节时自动降级为 64 字节分块并只抢救缺失区间，仍显式表示：

- `rows[].bytes[i]` 为 `null`，而不是 `"00"` 或伪值；
- 含未知字节的行 `readable=false`，`qword_le`/`ascii` 为 `null`；
- `stack.unreadable_ranges` 列出不可读地址区间；
- `snapshot.warnings` 说明缺失字节数量。

单个不可读块不会让整个 session 或快照失败。

### 地址与数值约定

- 所有地址、寄存器值、qword 均为 `0x` + 16 位十六进制字符串；
- 原始字节为 2 位小写 hex；不可读为 `null`；
- 前端绝不把这些值转成 JavaScript Number。

## 错误与恢复

- GDB 命令超时：`504 debugger_timeout`，会话进入 `ERROR`，控制器/进程被清理；
- MI reader 永久失败：`session.state=ERROR`，控制器关闭，GDB/inferior 被回收；
- GDB 返回 `^error`（如 `finish` 位于最外层）：`502 debugger_error`，
  目标仍 stopped 时 session 保持 `STOPPED`，可继续操作；
- 快照采集部分失败：session 仍 `STOPPED`，快照带 `warnings`/不可读区间；
- 目标退出：`session.state=EXITED`，不再采集快照；DELETE 仍负责回收 GDB。
