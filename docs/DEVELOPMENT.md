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
~/.venvs/pwnviz/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
```

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

## 12. 下一步（Phase 1）

目标：真实单步闭环。计划改动：

```text
backend/app/debugger/gdb_process.py     持久 GDB MI3 子进程
backend/app/debugger/mi_controller.py   单 reader + 命令队列 + 事件分发
backend/app/debugger/pwndbg_loader.py   可选 pwndbg 加载
backend/app/sessions/{manager,session,state}.py
backend/app/collector/{registers,frames,memory,disassembly,snapshot}.py
backend/app/analysis/diff.py
backend/app/api/{routes_sessions,websocket}.py
backend/app/schemas/{session,snapshot}.py
backend/tests/integration/test_step_loop.py   # 真实 GDB 集成测试
frontend/src/services/websocket.ts / stores/sessionStore.ts / 栈视图
```

验收：StepI 前后 `gdb` PID 不变；RIP 前进的实际字节数等于指令长度；
`push rbp` 后 RSP 减 8 且该地址出现旧 RBP；连续快速 Step 不错线；
关闭会话后无残留 GDB/inferior 进程。详见 [PHASES.md](PHASES.md)。
