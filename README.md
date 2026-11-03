# PWNviz

**面向 CTF PWN 初学者的真实进程内存可视化调试教学平台。**

PWNviz 不是 CPU 模拟器，也不是 pwndbg 终端输出的 HTML 包装器。它启动真实 Linux
ELF 进程，用真实 GDB（MI3）执行指令，采集真实寄存器/栈帧/内存/反汇编，再把结果
渲染成可视化工作台。

> **真实性原则**：UI 占位可以存在，但任何寄存器值、地址、字节、指令都必须来自
> 真实 GDB 会话。Phase 0 的调试面板明确标注 “no live session”，不展示任何伪造数据。

---

## 当前状态：Phase 3（实时调试工作台）

已完成：

- monorepo 骨架：`frontend/`、`backend/`、`samples/`、`scripts/`、`docs/`；
- FastAPI 后端：`/health`、`/api/v1/capabilities`、`/api/v1/samples`；
- 真实环境探测：`gdb --version`、GDB 内嵌 Python、`--interpreter=mi3` 支持、
  架构判定（x86-64 门控）、pwndbg 安装检测 + 按需真实加载验证；
- 公开配置 `GDB_PATH` / `PWNDBG_INIT` / `API_HOST` / `API_PORT` /
  `ALLOWED_SAMPLE_DIR`，GDB 缺失时后端仍可启动并返回 `unavailable`；
- 内置样例 `samples/stack-basic/demo.c` 与编译脚本；
- **Phase 1 调试链路**：
  - 每会话一个持久 GDB/MI3 子进程（`GdbProcess` + `MIController`）；
  - MI token 关联命令响应，`*stopped`/`*running`/退出事件独立分发；
  - `DebugSession` 状态机 + 单会话命令串行化；
  - `launch/run/continue/interrupt/step/next/stepi/nexti/finish` 动作；
  - 真实快照：寄存器、GDB unwinder 栈帧、RIP 附近反汇编、RSP 窗口内存、
    字节级 diff；
  - `POST/GET/DELETE /api/v1/sessions...` 与
    `WS /api/v1/sessions/{id}/stream`（`session.state` + `snapshot`）；
- **Phase 2 前端可视化**：
  - Zustand 单一 debug store：session / state / 当前 snapshot / history /
    selected address / UI preferences；
  - 深色 IDE 工作台：Debug Toolbar、Disassembly、Stack Memory Canvas、
    Registers、Memory Inspector / Diff / Explanation / Debug Log；
  - 栈画布按 8-byte 行展示地址、byte cells、little-endian qword、ASCII，
    高地址在上、低地址在下，RSP/RBP 由真实寄存器地址定位；
  - `diff.changed_bytes` 高亮 + 150–300ms 动画开关；寄存器显示 before/after；
  - 点击 byte cell 检查地址/字节/qword/ASCII；点击 RSP/RBP 滚动到对应行；
  - 点击汇编行仅选择，不创建断点；
  - 真实 WebSocket 推送驱动更新，断线重连，REST 动作与 WS 事件去重；
- **Phase 3 实时工作台**：
  - Toolbar：Run、Continue、Pause、Step Instruction、Next Instruction、Step Into、
    Step Over、Finish、Restart；
  - 状态栏：Initializing / Running / Stopped / Exited / Error；
  - 统一 WS 事件壳：`session.state` / `snapshot` / `debugger.output` /
    `debugger.error` / `breakpoints.updated` / `session.terminated`；
  - 处理断线重连、后端重启、session 不存在、重复事件和 stale snapshot
    （较小 snapshot_id 不覆盖新快照）；
  - Debug Log 显示真实 GDB/MI 命令/控制台输出，不参与核心解析；
  - Instruction Explanation 规则：push / pop / mov / sub rsp / add rsp / call /
    ret / leave / nop，结合 before/after 寄存器与内存差异；未知指令只显示
    “已执行，请观察状态变化”；
  - 不把 RBP 讲成固定栈底，也不把 RSP–RBP 空间硬编码为局部变量；
- React + TypeScript + Vite + Tailwind + Zustand 深色 IDE 工作台；
- 本机安全护栏：非 loopback 绑定默认拒绝、HTTP/WS 非 loopback 客户端中间件、
  `Host` 白名单、跨站浏览器请求拒绝、CORS 收紧、子进程组超时清理；
- 生命周期清理：DELETE/取消/退出/reader 失败均回收 GDB，WebSocket 队列有界；
- 单元测试与真实环境集成测试（pytest 111 passed，含真实 GDB 会话与 MI 控制器测试）；
- CDP E2E：`scripts/ui_smoke.mjs` 真实跑通
  main → StepI → Step Into add_numbers → RSP 变化 → Finish → Continue 退出 →
  Restart，页面不刷新；前端单测 24 passed；
- 环境检查脚本在本机 0 failure / 0 warning。

![Phase 3 工作台（真实 GDB 会话）](docs/assets/workbench-phase2.png)

> 截图来自真实 GDB 会话：RSP、RBP、RIP 与栈字节均来自后端 Snapshot；
> 状态栏与断点来自 WebSocket 事件；高亮的 `0a` 是 StepI 后 diff 检测到的真实
> 栈字节变化。

尚未实现（后续阶段）：

- 断点增删 API、源码视图、DWARF 变量/类型语义（Phase 4）；
- 快照历史时间轴回放；
- 更完整的指令解释规则（当前只覆盖有限常用指令）。

阶段计划与验收标准见 [docs/PHASES.md](docs/PHASES.md)。

---

## 快速开始（Windows + WSL2）

本项目调试器必须运行在 Linux 上，因此后端在 WSL2/Ubuntu 中运行，前端开发服务器
在 Windows 上运行，Vite 通过代理访问 WSL 中的后端。

### 0. 前置条件

| 组件 | 版本要求 | 本机实测 |
|---|---|---|
| WSL2 Ubuntu | 22.04 / 24.04 | Ubuntu 22.04.5 LTS |
| GDB | 12.1+ | 12.1（Ubuntu 12.1-0ubuntu1~22.04.2） |
| GCC | 任意现代版本 | 11.4.0 |
| Python | 3.10+ | 3.10.12 |
| Node.js（Windows） | 20+ | v24.19.0 |
| pwndbg | 可选 | `/home/casset/pwndbg`，已验证可加载 |

### 1. 安装后端依赖（WSL）

```bash
wsl -d Ubuntu-22.04 -- bash /mnt/f/Pwnvis/scripts/wsl_bootstrap.sh
```

### 2. 检查真实环境（WSL）

```bash
wsl -d Ubuntu-22.04 -- bash /mnt/f/Pwnvis/scripts/check_environment.sh
```

该脚本只做真实检测，不安装任何东西；缺失 GDB 时会给出可操作的错误。
`[PASS]/[WARN]/[FAIL]` 均来自实际执行的命令。

### 3. 编译教学样例（WSL）

```bash
wsl -d Ubuntu-22.04 -- bash /mnt/f/Pwnvis/scripts/build_samples.sh
```

### 4. 启动后端（WSL，前台运行）

```bash
wsl -d Ubuntu-22.04 -- bash /mnt/f/Pwnvis/scripts/dev_backend.sh
```

也可以直接：

```bash
cd backend
~/.venvs/pwnviz/bin/python -m app
```

`python -m app` 会读取 `.env` 中的 `API_HOST` / `API_PORT`
（默认 `127.0.0.1:8000`）。启动后访问 `/docs` 查看 OpenAPI。

### 5. 启动前端（Windows PowerShell）

```powershell
cd F:\Pwnvis\frontend
npm install
npm run dev
```

打开 <http://127.0.0.1:5173>。选择目标后点击 **Run** 创建真实会话并停在 `main`；
点击 **StepI/NextI/Next/Finish**，栈画布、寄存器、反汇编与 diff 会随真实 GDB
快照更新。底部 **Environment** 标签仍展示真实主机探测结果。

### 6. 运行测试

```bash
wsl -d Ubuntu-22.04 -- bash -lc 'cd /mnt/f/Pwnvis/backend && ~/.venvs/pwnviz/bin/python -m pytest -v'
```

虚拟环境默认安装在 WSL ext4 的 `~/.venvs/pwnviz`（避免 `/mnt/f` 上的 NTFS
I/O 拖慢 pip），可用 `PWNVIZ_VENV` 覆盖。

集成测试会真实启动 `gdb --version`、`gdb --batch --interpreter=mi3`，并在
pwndbg 可用时真实加载它；`tests/integration/test_gdb_mi_smoke.py` 还会真实加载
样例、命中 `main`、单步一条指令、读取寄存器/内存并确认 inferior 进程退出。
`test_session_lifecycle.py` 通过 REST 跑完整会话（launch → 快照 → stepi → diff
→ finish → 终止清理），`test_websocket_stream.py` 验证实时推送。
不会用 mock 冒充调试成功。

前端 UI 的真实验收（需要后端 + Vite 已启动，Edge 开启 CDP）：

```powershell
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" `
  --headless=new --disable-gpu --remote-debugging-port=9223 `
  --user-data-dir="$env:TEMP\pwnviz-edge" about:blank
```

```bash
node scripts/ui_smoke.mjs
```

前端纯函数单测（地址 BigInt / marker / unreadable / diff）：

```bash
cd frontend
npm test
```

该脚本真实点击 Run / StepI，检查栈画布行数、RSP/RBP marker、changed cell、
Memory Inspector 选择、汇编选择、Diff 标签与 Terminate，并输出截图到
`docs/assets/workbench-phase2.png`。

### 7. 配置（`.env`）

复制 `.env.example` 为 `.env`（该文件被 git 忽略）。公开配置项：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `GDB_PATH` | `gdb` | GDB 可执行文件名或绝对路径；不存在时后端照常启动 |
| `PWNDBG_INIT` | 空 | `gdbinit.py` 文件或其所在目录；空则自动检测 |
| `API_HOST` | `127.0.0.1` | 后端绑定地址；非 loopback 默认拒绝启动 |
| `API_PORT` | `8000` | 后端绑定端口（非法值回退 8000） |
| `ALLOWED_SAMPLE_DIR` | `<repo>/samples` | 只允许发现该目录之下的样例 |
| `PWNVIZ_ALLOW_REMOTE` | `0` | 显式允许非 loopback 绑定与客户端（无认证，不推荐） |
| `PWNVIZ_ALLOWED_HOSTS` | `127.0.0.1,localhost,testserver` | `Host` 头白名单 |
| `PWNVIZ_GDB_ARGS` | `--quiet --nx --interpreter=mi3` | 持久 GDB 启动参数（自动移除 `--batch`） |
| `PWNVIZ_GDB_STOP_TIMEOUT_SECONDS` | `15` | 等待 `*stopped` 的预算 |

可选调优项（`PWNVIZ_*`：pwndbg 开关、命令超时、缓存 TTL、CORS、栈窗口、
快照上限）见 [.env.example](.env.example)。旧的 `PWNVIZ_GDB_BINARY` /
`PWNVIZ_PWNDBG_PATH` / `PWNVIZ_SAMPLES_DIR` / `PWNVIZ_HOST` / `PWNVIZ_PORT`
仍作为兼容别名。

安全模型与审计结论见 [docs/SECURITY.md](docs/SECURITY.md) 与
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#14-安全--架构-review-记录2026-11-03)。

---

## 目录结构

```text
Pwnvis/
├── frontend/                 # React + TS + Vite + Tailwind + Zustand
│   └── src/
│       ├── app/              # Workbench 布局
│       ├── components/       # Toolbar / StackMemoryView / RegisterPanel / ...
│       ├── hooks/            # useCapabilities / useSamples
│       ├── services/         # 类型化 API 客户端
│       ├── stores/           # Zustand 单一 debug 状态（snapshot/session/UI）
│       └── types/            # 与后端 schema 对齐的 TS 类型
├── backend/                  # FastAPI
│   ├── app/
│   │   ├── api/              # health / capabilities / samples / sessions / websocket
│   │   ├── core/             # config / errors / logging / proc / security
│   │   ├── debugger/         # environment 探测 + gdb_process / mi_controller / pwndbg_loader
│   │   ├── sessions/         # state / session / manager
│   │   ├── collector/        # registers / frames / memory / disassembly / snapshot
│   │   ├── analysis/         # byte-level diff
│   │   ├── samples/          # 样例发现
│   │   └── schemas/          # Pydantic v2 模型（capabilities / samples / session / snapshot）
│   └── tests/                # unit + 真实 GDB 集成测试
├── samples/                  # 教学 C 样例与 README
├── scripts/                  # bootstrap / 环境检查 / 编译 / 启动
├── docs/                     # ARCHITECTURE / API / DEVELOPMENT / PHASES / SECURITY
├── .env.example
└── README.md
```

---

## 架构要点（已确立）

1. 前端只做交互与渲染，绝不直接执行 GDB；
2. 每个调试会话拥有一个**长期运行**的 GDB/MI3 子进程，
   不会每次单步重启 GDB；
3. 同一会话的所有动作串行化，MI 命令完成记录与 `*running`/`*stopped`
   异步事件分开处理；
4. 地址与 64-bit 值在 JSON 中使用十六进制字符串，前端绝不转成 JS Number；
5. 原始字节是事实；变量名、类型、返回地址只是语义标注，必须有 DWARF/GDB 证据；
6. RBP 仅是寄存器，调用栈以 GDB frame unwinder 为依据；
7. pwndbg 是可选增强层，加载失败自动退化为原生 GDB；
8. MVP 仅面向本机可信教学 ELF，不开放公网任意文件执行。

详见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

---

## MVP 限制（当前明确不做）

- 不做 CPU/指令模拟器；
- 不解析 pwndbg 彩色终端文本作为数据源；
- 不承诺识别无符号 ELF 的局部变量；
- 不实现堆分配器分析、ROP 自动分析、Exploit 生成；
- 不做多用户/账号/排行；
- 未做隔离前不允许公网 ELF 上传执行。

安全边界见 [docs/SECURITY.md](docs/SECURITY.md)。

---

## API（Phase 1）

| Method | Endpoint | 说明 |
|---|---|---|
| GET | `/health` | 后端存活与配置摘要 |
| GET | `/api/v1/capabilities` | 真实探测 GDB / MI3 / Python / pwndbg / 样例 |
| GET | `/api/v1/capabilities?verify_pwndbg=true` | 额外真实加载 pwndbg 验证 |
| GET | `/api/v1/samples` | 教学样例列表与编译状态 |
| GET | `/api/v1/samples/{id}` | 单个样例 |
| POST | `/api/v1/sessions` | 创建会话（`sample_id`、可选 `stop_at`、`load_pwndbg`） |
| GET | `/api/v1/sessions/{id}` | 会话状态、PID、快照数量 |
| POST | `/api/v1/sessions/{id}/launch` | 启动 GDB、加载 ELF、停在 `main` |
| POST | `/api/v1/sessions/{id}/actions` | 白名单动作（continue/interrupt/stepi/nexti/step/next/finish 等） |
| GET | `/api/v1/sessions/{id}/snapshots` | 真实快照历史 |
| DELETE | `/api/v1/sessions/{id}` | 终止会话并清理 GDB/inferior |
| WS | `/api/v1/sessions/{id}/stream` | `session.state` 与 `snapshot` 实时事件 |

快速验证（后端启动后）：

```bash
curl -s -X POST http://127.0.0.1:8000/api/v1/sessions \
  -H 'Content-Type: application/json' \
  -d '{"sample_id":"stack-basic","load_pwndbg":false}'
# 用返回的 session_id：
curl -s -X POST http://127.0.0.1:8000/api/v1/sessions/<id>/launch
curl -s -X POST http://127.0.0.1:8000/api/v1/sessions/<id>/actions \
  -H 'Content-Type: application/json' -d '{"action":"step_instruction"}'
curl -s -X DELETE http://127.0.0.1:8000/api/v1/sessions/<id>
```

示例响应与字段说明见 [docs/API.md](docs/API.md)。

---

## 开发记录与实测环境

见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)，其中记录了本机真实执行过的命令与输出
（包括 GDB、pwndbg 加载结果、pytest 结果），以及 Windows/WSL 分工的注意事项。
