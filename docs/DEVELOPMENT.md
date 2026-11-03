# 开发环境与实测记录

本文记录本机**真实执行过**的命令与结果。如果某项没有记录，就说明没有运行。

## 1. 本机环境（实测）

| 项 | 结果 |
|---|---|
| 宿主 | Windows + WSL2 |
| 发行版 | Ubuntu 22.04.5 LTS |
| 内核 | 6.6.87.2-microsoft-standard-WSL2 |
| 架构 | x86_64 |
| GDB | GNU gdb (Ubuntu 12.1-0ubuntu1~22.04.2) 12.1 |
| GDB 内嵌 Python | 3.10.12 |
| GDB/MI3 | 接受 `--interpreter=mi3`（标记验证） |
| pwndbg | `/home/casset/pwndbg`，git `1bf0652`（2026-09-12），加载实测 1s，版本 2026.07.29 |
| GCC | 11.4.0 |
| binutils | 2.38 |
| Node（Windows） | v24.19.0，npm 11.17.0 |
| Node（WSL） | 未安装；前端在 Windows 上运行 |
| 后端 Python | 3.10.12（venv 在 `~/.venvs/pwnviz`，ext4） |

`/proc/sys/kernel/yama/ptrace_scope` = `1`（GDB 以 fork 方式调试自己的子进程，不受影响）。

## 2. 环境探测脚本

```bash
wsl -d Ubuntu-22.04 -- bash /mnt/f/Pwnvis/scripts/probe_env.sh
```

关键输出：

```text
pygdbmi: MISSING ...        # 当时尚未创建 venv
found: /home/casset/pwndbg
~/.gdbinit: source /home/casset/pwndbg/gdbinit.py
```

随后：

```bash
wsl -d Ubuntu-22.04 -- bash /mnt/f/Pwnvis/scripts/probe_pwndbg.sh
```

```text
gdbinit: /home/casset/pwndbg/gdbinit.py
1bf06529a870192d9083f5ba9aa341ba99581889 2026-09-12
pwndbg: loaded 199 pwndbg commands...
PWNDBG_LOADED /home/casset/pwndbg/pwndbg/__init__.py
-- exit=0 elapsed=1s --
```

## 3. GDB 12.1 的 MI3 探测坑（已修正）

最初的探测命令：

```bash
gdb --batch --nx --quiet --interpreter=mi3 -ex "-gdb-version"
```

实际输出：

```text
=thread-group-added,id="i1"
&"Undefined command: \"-gdb-version\".  Try \"help\".\n"
```

结论：`-ex` 传入的是 **CLI** 命令，不是 MI 命令；且 GDB 12.1 即使
`--interpreter=mi9` 也返回退出码 0，只打印 `Interpreter 'mi9' unrecognized`。
因此探测逻辑改为：

```bash
gdb --batch --nx --quiet --interpreter=mi3 -ex "python print('PWNVIZ_MI3_OK')"
```

并同时检查标记存在、输出中没有 `unrecognized`。Python 探测结果：

- 真实 gdb：`~"PWNVIZ_MI3_OK\n"`；
- 非法 interpreter：只有 `unrecognized`，没有标记。

后端 `app/debugger/environment.py::_probe_mi3` 与
`scripts/check_environment.sh` 使用同一判定。

## 4. 后端虚拟环境

首次尝试把 venv 放在 `/mnt/f/Pwnvis/backend/.venv`，pip 在 DrvFs（NTFS）
上写入成千上万小文件，数分钟无法完成。改为：

```text
~/.venvs/pwnviz          # WSL ext4，默认位置
PWNVIZ_VENV=/other/path  # 可覆盖
```

PyPI 直连较慢，本次安装使用了镜像（仅本次会话）：

```bash
PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple \
  ~/.venvs/pwnviz/bin/python -m pip install fastapi 'uvicorn[standard]' \
  pydantic pygdbmi python-dotenv pytest pytest-asyncio httpx
```

实际安装版本（2026-11-03）：

```text
fastapi 0.162.0, starlette 1.7.0, pydantic 2.14.2, uvicorn 0.54.0,
pygdbmi 0.11.0.0, python-dotenv 1.2.4, pytest 9.2.0,
pytest-asyncio 1.4.1.post1, httpx 0.28.1
```

`scripts/wsl_bootstrap.sh` 默认仍使用官方 PyPI；网络慢时先 `export PIP_INDEX_URL=...`
再执行脚本即可。

## 5. 测试（真实执行）

```bash
wsl -d Ubuntu-22.04 -- bash -c \
  "cd /mnt/f/Pwnvis/backend && ~/.venvs/pwnviz/bin/python -m pytest -q"
```

结果：

```text
31 passed in 7.37s
```

Phase 0 复核（环境变量与架构字段）后再次执行：

```text
50 passed in 10.24s
```

其中集成测试真实执行 `gdb --version`、MI3 探测、pwndbg 加载验证与样例扫描；
失败路径测试使用一个只打印固定文本的假 `gdb` 脚本验证超时/失败分支，
**不用于冒充真实调试成功**。

开发过程中发现并修复的两个真实失败：

1. `supports_mi3` 为 `false`：探测命令用错（见第 3 节）；
2. 单测断言 `build_command[-3]` 期望二进制路径，实际 `-3` 是 `-o`（应为 `-2`）。

## 6. 样例编译（真实执行）

```bash
wsl -d Ubuntu-22.04 -- bash /mnt/f/Pwnvis/scripts/build_samples.sh
```

```text
== building stack-basic ==
gcc -g -O0 -fno-omit-frame-pointer -fno-inline -fno-pie -no-pie \
  -o /mnt/f/Pwnvis/samples/stack-basic/demo \
  /mnt/f/Pwnvis/samples/stack-basic/demo.c
ELF 64-bit LSB executable, x86-64, ..., with debug_info, not stripped
```

产物大小 17,464 bytes（`binary_built_at` = `2026-11-03T01:26:47Z`）。

## 7. 环境检查（真实执行）

```bash
wsl -d Ubuntu-22.04 -- bash /mnt/f/Pwnvis/scripts/check_environment.sh
```

```text
[PASS] Linux 6.6.87.2-microsoft-standard-WSL2 (x86_64)
[PASS] x86-64 target architecture
[PASS] GDB 12.1 (/usr/bin/gdb)
[PASS] GDB 12.1 meets the 12.1 minimum
[PASS] GDB embedded Python 3.10.12
[PASS] GDB/MI3 interpreter accepted
[PASS] pwndbg loads from /home/casset/pwndbg
[PASS] gcc 11.4.0
[PASS] GNU objdump (GNU Binutils for Ubuntu) 2.38
[PASS] venv /home/casset/.venvs/pwnviz
[PASS] backend packages import (fastapi, uvicorn, pydantic, pygdbmi, pytest)
[PASS] samples/stack-basic/demo built
[INFO] node is not installed in WSL; run the Vite dev server from Windows (npm run dev)
== summary: 0 failure(s), 0 warning(s) ==
```

## 8. 后端启动与 API（真实执行）

```bash
cd /mnt/f/Pwnvis/backend
PWNVIZ_RELOAD=0 ~/.venvs/pwnviz/bin/python -m app
```

`python -m app` 读取 `API_HOST` / `API_PORT`（环境变量或仓库根 `.env`），
默认监听 `127.0.0.1:8000`。

`GET /health`：

```json
{"status":"ok","service":"pwnviz-backend","version":"0.1.0",
 "timestamp":"2026-11-03T01:27:23Z","uptime_seconds":4.698,
 "gdb_binary":"gdb","samples_dir":"/mnt/f/Pwnvis/samples"}
```

`GET /api/v1/capabilities`：`ready=true`，GDB 12.1，MI3 true，
pwndbg `detected`，warnings 为空。

`GET /api/v1/capabilities?verify_pwndbg=true`：真实加载 pwndbg 后
`status=verified`、`version=2026.07.29`。

`GET /api/v1/samples`：`count=1`，`stack-basic`，二进制 17,464 bytes。

完整响应示例见 [API.md](API.md)。

## 9. 前端构建与运行（真实执行）

```powershell
cd F:\Pwnvis\frontend
npm install
npm run build
```

```text
vite v8.3.5 building client environment for production...
✓ 34 modules transformed.
dist/index.html                   0.53 kB
dist/assets/index-*.css          21.79 kB
dist/assets/index-*.js          245.20 kB
✓ built in 346ms
```

`npm run dev` 启动 5173 端口：

- `GET http://127.0.0.1:5173/` → 200，返回 Vite 注入后的 index.html；
- `GET http://127.0.0.1:5173/api/v1/capabilities` → 200（Vite proxy 转发到
  WSL 的 8000 端口），`ready=true`、`gdb=12.1`、`pwndbg=verified`。

界面用 headless Edge 截图验证（页面确实渲染并请求了真实 API）：

```powershell
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" `
  --headless=new --disable-gpu --window-size=1680,1050 `
  --virtual-time-budget=10000 --screenshot="$env:TEMP\pwnviz_ui.png" `
  http://127.0.0.1:5173/
```

截图保存在 [assets/workbench-phase0.png](assets/workbench-phase0.png)：
可见 GDB 12.1、pwndbg 2026.07.29 verified、样例已编译、
调试面板明确显示 `no live session`。

## 10. 日常开发命令

```bash
# 后端（WSL）
wsl -d Ubuntu-22.04 -- bash /mnt/f/Pwnvis/scripts/dev_backend.sh

# 测试（WSL）
wsl -d Ubuntu-22.04 -- bash -c \
  "cd /mnt/f/Pwnvis/backend && ~/.venvs/pwnviz/bin/python -m pytest -q"

# 前端（Windows）
cd F:\Pwnvis\frontend; npm run dev
```

## 11. 已知注意事项

- **不要在 WSL 的 `/mnt/f` 上创建 venv**，NTFS 小文件 I/O 极慢；
- **PowerShell 5.1 的 `Set-Content` 默认不是 UTF-8**，批量改源码时务必显式编码，
  否则中文/`—`/`…` 字符会写成 GBK 导致前端编译失败（本次已遇到并修复）；
- pwndbg 在 `--nx` 下不会自动加载，Phase 1 必须显式
  `source <dir>/gdbinit.py`，并把失败降级为 warning；
- GDB 12.1 的 `-ex` 是 CLI 命令，MI 命令必须在 MI prompt 下发送；
- 后端只监听 `127.0.0.1`，仅用于本机可信样例。

## 12. Phase 1 计划（已完成，实测见第 15 节）

目标：真实单步闭环。实际实现：

```text
backend/app/debugger/gdb_process.py     持久 GDB MI3 子进程（独立进程组）
backend/app/debugger/mi_controller.py   单 reader + token future + 事件队列
backend/app/debugger/pwndbg_loader.py   可选 pwndbg 加载
backend/app/sessions/{manager,session,state}.py
backend/app/collector/{registers,frames,memory,disassembly,snapshot}.py
backend/app/analysis/diff.py
backend/app/api/{routes_sessions,websocket}.py
backend/app/schemas/{session,snapshot}.py
backend/tests/integration/test_session_lifecycle.py  # 真实 GDB 会话验收
```

验收结果：StepI 前后 `gdb` PID 不变；RIP 增量等于快照记录的指令长度；
会话、finish、continue、interrupt、超时恢复、DELETE 清理均通过真实测试。
`push rbp` 专用断言与 50 次压力测试仍待补，详见 [PHASES.md](PHASES.md)。

## 13. Phase 0 复核（环境变量、架构与缺失 GDB 验收）

本轮按总控要求补齐 `GDB_PATH` / `PWNDBG_INIT` / `API_HOST` / `API_PORT` /
`ALLOWED_SAMPLE_DIR`，并在 capabilities 中显式给出 `platform.architecture` 与
`platform.is_x86_64`。以下均为实际执行结果。

### 13.1 单元与集成测试

```text
50 passed in 10.24s
```

新增覆盖：配置别名与优先级、非法 `API_PORT` 回退、`pwndbg_init` 文件/目录、
架构分类、样例根目录符号链接逃逸、探测异常返回 503。

### 13.2 正常环境

```text
GET /health            -> 200, gdb_binary=gdb
GET /capabilities      -> ready=True, architecture=x86-64, is_x86_64=True,
                          gdb 12.1 / MI3 true / python 3.10.12,
                          pwndbg=detected (quick), warnings=0
```

### 13.3 缺失 GDB（真实启动第二个后端，端口 8001）

```bash
GDB_PATH=/nonexistent/pwnviz-gdb API_PORT=8001 python -m app
```

```text
health.status=ok gdb_binary=/nonexistent/pwnviz-gdb
ready=False gdb.available=False gdb.version=null
warning: GDB binary '/nonexistent/pwnviz-gdb' not found or not executable: ...
```

进程未崩溃，`/health` 仍 200，能力接口 200 且降级。

### 13.4 `.env` 与 API_PORT

创建临时 `.env`（`API_PORT=8002`）后启动：

```text
port 8000 -> ok（旧实例）
port 8002 -> ok, gdb=gdb, samples=/mnt/f/Pwnvis/samples
```

确认 `python -m app` 读取 `.env` 的 `API_PORT`；验证后已删除临时 `.env`。

### 13.5 启动脚本

```bash
API_PORT=8003 PWNVIZ_RELOAD=0 bash scripts/dev_backend.sh
```

```text
dev script port 8003 -> ok, uptime=4.935
```

### 13.6 前端

`npm run build` 通过；页面经 Vite proxy 获取到
`architecture=x86-64 / is_x86_64=true`。截图已更新为
[assets/workbench-phase0.png](assets/workbench-phase0.png)，可见
“X86-64 TARGET”状态、`ARCHITECTURE x86-64` 与 `X86-64 CHECK yes`。

### 13.7 仍未实现

Phase 1 的真实 GDB 会话、快照与 WebSocket 均未开始；三类调试面板仍明确显示
`no live session`，不包含任何伪造的寄存器或内存值。

## 14. 安全 / 架构 Review 记录（2026-11-03）

本轮对 Phase 0 代码做了 12 项审计，结论与修复见下（完整分级见提交说明）。

### 14.1 真实 GDB/MI3 冒烟测试（不 mock）

新增 `backend/tests/integration/test_gdb_mi_smoke.py`，真实执行：

```text
gdb --quiet --nx --interpreter=mi3
-file-exec-and-symbols samples/stack-basic/demo
-break-insert main
-exec-run                    # 真实 inferior 启动并命中 main
-data-evaluate-expression $rip
-exec-step-instruction       # 真实单步一条机器指令
-data-read-memory-bytes $rsp 8
-gdb-exit
```

实测结果：

```text
tests/integration/test_gdb_mi_smoke.py::test_real_mi_break_run_step_memory_and_cleanup PASSED
```

并断言：`*stopped reason=breakpoint-hit`、单步后 RIP 改变、内存返回 16 位 hex、
inferior PID 在 GDB 退出后消失。

关键时序发现：`-exec-run` 的 `write()` 返回记录中**同时**包含 `^running`、
`*running` 和 `*stopped`。因此 Phase 1 不能把“命令返回”当作“进程已停止”，
也不能假设 stopped 一定在后续 read 中到达。测试会先检查初始响应，再轮询。

### 14.2 进程组清理

`run_command` 在 POSIX 下使用 `start_new_session=True`；超时后
`os.killpg(pid, SIGKILL)` 杀死整个进程组，并做 2 秒有界 draining。
新增测试让假 GDB 启动一个后台 `sleep 30` 孙进程，断言超时后该 PID 消失：

```text
tests/unit/test_proc.py::test_timeout_kills_grandchildren PASSED
```

### 14.3 本机安全护栏（实测）

```text
curl http://127.0.0.1:8000/health                                  -> 200
curl -H "Host: evil.example" .../health                           -> 400 Invalid host header
curl -H "Sec-Fetch-Site: cross-site" .../api/v1/samples           -> 403 cross_site_blocked
GET http://127.0.0.1:5173/api/v1/capabilities（Vite proxy）        -> 200, ready=true
```

非 loopback 绑定默认拒绝：

```bash
API_HOST=0.0.0.0 python -m app
error: Refusing to bind PWNviz to '0.0.0.0': this debugger spawns GDB and is
local-only by design. ... set PWNVIZ_ALLOW_REMOTE=1 ...
```

CORS 不再使用 `allow_credentials`，方法/请求头改为白名单。

### 14.4 样例根目录

`demo.c`、`README.md` 和二进制均检查 `resolve()` 后是否位于样例根目录内；
指向根目录外的符号链接不会被读取/登记。新增：

```text
tests/unit/test_samples_registry.py::test_readme_symlink_outside_root_is_not_read PASSED
tests/unit/test_samples_registry.py::test_binary_symlink_outside_root_is_skipped PASSED
```

### 14.5 失败验证可重试

修复了 `?verify_pwndbg=true` 失败结果被写入验证缓存的问题：失败不再缓存，
下一次点击会真实重试。新增：
`test_failed_pwndbg_verification_stays_retryable`。

### 14.6 测试总量

```text
75 passed（Phase 0 审计时）
```

其中真实 GDB 集成测试 2 类（capabilities 探测、MI3 load/break/run/step/memory），
其余为真实文件系统/子进程/ASGI 测试；没有为了通过测试而删除真实集成测试或改成 mock。

## 15. Phase 1 实测记录（真实 GDB 调试链路，2026-11-03）

### 15.1 环境

```text
GNU gdb (Ubuntu 12.1-0ubuntu1~22.04.2) 12.1
gdb embedded Python 3.10.12
pwndbg /home/casset/pwndbg（真实 session 内加载成功，snapshot.warnings 为空）
```

### 15.2 真实执行的 GDB/MI 命令

```text
gdb --quiet --nx --interpreter=mi3
-gdb-set confirm off
-gdb-set pagination off
-gdb-set width 0
-gdb-set height 0
-gdb-set mi-async on
-interpreter-exec console "source /home/casset/pwndbg/gdbinit.py"   # 可选
-file-exec-and-symbols "/mnt/f/Pwnvis/samples/stack-basic/demo"
-break-insert main
-exec-run
-data-list-register-names
-data-list-register-values x 16 7 6 0 ...
-stack-list-frames 0 31
-data-disassemble -s 0x401147 -e 0x4011a7 -- 1
-data-read-memory-bytes 0x00007fffffffe1f0 64
-exec-step-instruction
-gdb-exit
```

### 15.3 真实快照（本机）

第一次停止（main 断点）：

```text
rip = 0x401160
instruction = movl $0xa,-0xc(%rbp)   bytes=c745f40a000000
rsp = 0x7fffffffe270
rbp = 0x7fffffffe280
stop_reason = breakpoint-hit
```

`step_instruction` 后：

```text
rip = 0x401167   （前进 7 = 指令字节数）
instruction = movl $0x14,-0x8(%rbp)  bytes=c745f814000000
snapshot_id = 2
changed_registers = ["rip"]
changed_bytes = [{address: 0x7fffffffe274, before: 00, after: 0a}]
```

该变化对应源码第 10 行 `volatile int a = 10;`，由 GDB 单步真实执行产生，
不是 fixture。

### 15.4 测试结果

```text
99 passed in 48.82s
```

核心真实集成测试：

```text
tests/integration/test_session_lifecycle.py
  test_step_instruction_produces_real_snapshots
  test_action_before_launch_is_rejected
  test_continue_to_exit_and_cleanup
  test_delete_running_session_cleans_up_processes
  test_pwndbg_loading_is_optional_and_does_not_block_native_gdb
  test_session_limit_is_enforced
  test_next_actions_produce_stopped_snapshots
  test_step_into_function_then_finish
  test_launch_failure_sets_error_without_leaking

tests/integration/test_websocket_stream.py
  test_websocket_streams_state_and_snapshot
  test_websocket_rejects_foreign_origin
  test_websocket_unknown_session_is_closed

tests/integration/test_mi_controller.py
  test_command_timeout_does_not_kill_reader_or_lose_later_commands
  test_interrupt_stops_a_running_inferior

tests/unit/test_memory_unreadable.py
tests/unit/test_diff.py
```

验证点：

- 两次快照之间 `gdb_pid` 不变（同一持久 GDB）；
- StepI 后 RIP 增量等于快照记录的指令字节长度；
- 首次 diff 为空，第二次 diff 的 `previous_snapshot_id` 正确；
- finish 从 `add_numbers` 返回 `main`，frames 以 GDB unwinder 为准；
- DELETE 后 GDB 与 inferior PID 均从 `/proc` 消失；
- 真实 `-exec-interrupt` 能在 `sleep(30)` 的 inferior 上停止；
- 故意让一条命令超时后，reader 仍能执行后续命令并正常关闭；
- WebSocket 连接先收到 state + snapshot，StepI 后收到 RUNNING/STOPPED/snapshot；
- 非法 Origin/未知 session 被拒绝。

### 15.5 过程中发现的真实问题

1. **`-data-read-memory-bytes` 的 count 必须是十进制**：
   `... 0x401160 0x10` 会返回 `Unable to read memory`；使用 `16` 正常。
   采集器统一用十进制长度。
2. **GDB CLI `source "path"` 不剥离双引号**：GDB 12.1 把引号当成文件名的一部分，
   导致 pwndbg 首次加载失败。改为未加引号的绝对路径；含空白/控制字符的路径
   降级为 warning。
3. `-data-list-register-values x` 会返回大量向量寄存器；按名称索引只请求
   18 个需要的寄存器，避免解析开销。
4. `-exec-run` 的响应批次里可能已经包含 `*stopped`；会话通过 stop 纪元判断，
   不能只看命令返回。
5. `break main` 停在 main+12（序言之后），所以本样例的 `push rbp` 已在断点前
   执行，`push rbp` 的 RSP-8 断言尚未单独覆盖。

### 15.6 尚未解决的问题

- 50 次连续快速 Step 压力测试尚未执行（已有单步/并发状态拒绝/超时测试）；
- 前端尚未接入 session/snapshot（Phase 2）；
- 无 session 空闲 TTL；目前依赖 DELETE 或后端 shutdown 清理；
- 无断点增删、源码视图、DWARF 变量（Phase 3/4）；
- 长时间运行的非交互目标依赖 interrupt；已用真实 sleep 程序验证一次。
