# API 参考（Phase 0）

Base URL：`http://127.0.0.1:8000`（WSL 内 uvicorn）。
前端开发服务器 `http://127.0.0.1:5173` 通过 Vite proxy 转发 `/api` 与 `/health`。

所有响应均为 JSON。错误统一为：

```json
{
  "error": {
    "code": "sample_not_found",
    "message": "Unknown sample 'x'.",
    "detail": { "available": ["stack-basic"] }
  }
}
```

| HTTP | `code` | 场景 |
|---|---|---|
| 404 | `sample_not_found` | 样例不存在 |
| 422 | `invalid_request` | 请求参数校验失败 |
| 503 | `debugger_unavailable` | GDB 不可用（Phase 1 使用） |
| 503 | `capability_probe_failed` | 探测无有效结果 |

地址与 64-bit 值一律十六进制字符串（Phase 1 快照协议），绝不使用 JS Number。

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
- 验证失败不会被缓存，便于重试。

### 配置来源

| 环境变量 | 影响字段 |
|---|---|
| `GDB_PATH` | `gdb.*` 探测使用的可执行文件 |
| `PWNDBG_INIT` | `pwndbg.path` / `pwndbg.gdbinit` 的优先候选 |
| `ALLOWED_SAMPLE_DIR` | `samples.directory` 与样例扫描根目录 |
| `API_HOST` / `API_PORT` | 后端监听地址（`python -m app`） |

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

---

## Phase 1 计划端点（尚未实现）

| Method | Endpoint | 用途 |
|---|---|---|
| POST | `/api/v1/sessions` | 创建会话（sample_id / stop_at / load_pwndbg） |
| GET | `/api/v1/sessions/{id}` | 会话状态 |
| POST | `/api/v1/sessions/{id}/launch` | 启动 GDB 并停在断点 |
| POST | `/api/v1/sessions/{id}/actions` | 白名单动作：step/next/continue/interrupt/finish |
| GET | `/api/v1/sessions/{id}/snapshots` | 快照历史（最近 200 条） |
| DELETE | `/api/v1/sessions/{id}` | 终止并清理 |
| WS | `/api/v1/sessions/{id}/stream` | 实时事件流 |

WebSocket 事件结构：`{"type": "...", "session_id": "...", "payload": {...}}`，
事件类型见 [ARCHITECTURE.md](ARCHITECTURE.md#4-前后端协议)。
