# 开发阶段与验收计划

每一阶段结束时项目必须仍可启动。当前仓库状态：**Phase 0/1 已完成，Phase 2
核心前端可视化已完成并通过真实 GDB UI E2E**；断点/源码/DWARF 留到 Phase 3/4。

## Phase 0：环境探测与骨架

目标：前端、后端、样例、脚本可独立运行，并把本机真实调试能力暴露给 UI。

| # | 工作项 | 状态 | 证据 |
|---|---|---|---|
| 0.1 | monorepo 目录、`.gitignore`、`.env.example` | 完成 | 仓库根目录 |
| 0.2 | FastAPI + `/health` | 完成 | `backend/app/api/routes_health.py` |
| 0.3 | `/api/v1/capabilities` 真实探测 GDB 版本 / Python / MI3 | 完成 | `backend/app/debugger/environment.py` |
| 0.4 | pwndbg 检测与按需真实加载验证 | 完成 | `verify_pwndbg()` + 集成测试 |
| 0.5 | 样例发现 `/api/v1/samples` | 完成 | `backend/app/samples/registry.py` |
| 0.6 | 教学样例 `stack-basic` + 编译脚本 | 完成 | `samples/stack-basic/`、`scripts/build_samples.sh` |
| 0.7 | React/Vite/TS/Tailwind/Zustand 工作台骨架 | 完成 | `frontend/` |
| 0.8 | 环境面板展示真实探测结果 | 完成 | `EnvironmentPanel.tsx` |
| 0.9 | 单元 + 真实环境集成测试 | 完成 | `backend/tests/` |
| 0.10 | README / docs / 环境检查脚本 | 完成 | `README.md`、`scripts/check_environment.sh` |
| 0.11 | 公开配置 `GDB_PATH`/`PWNDBG_INIT`/`API_HOST`/`API_PORT`/`ALLOWED_SAMPLE_DIR` | 完成 | `core/config.py`、`.env.example` |
| 0.12 | 架构判定与 x86-64 门控（`platform.architecture`/`is_x86_64`） | 完成 | `debugger/environment.py` |
| 0.13 | 本机安全护栏：绑定拒绝、Host 白名单、跨站拒绝、CORS 收紧、进程组清理 | 完成 | `core/security.py`、`main.py`、`core/proc.py` |
| 0.14 | 真实 GDB/MI3 冒烟测试（load/break/run/stepi/memory/cleanup） | 完成 | `tests/integration/test_gdb_mi_smoke.py` |

验收标准（Phase 0）：

- [x] 未装 GDB 的机器上，`/health` 仍 200，`/capabilities` 返回结构化错误而非 500
  （集成测试中把 `GDB_PATH` 指向不存在的程序验证）；
- [x] 前端能显示 GDB 版本、MI3 支持、pwndbg 状态；
- [x] 缺少 GDB / pwndbg 时警告可读，不回退为假数据；
- [x] 后端与前端可分别启动（`scripts/dev_backend.sh` / `npm run dev`）；
- [x] pytest 在真实 WSL 环境中通过（当前 110 passed，含真实 MI3 冒烟与会话测试）；
- [x] `scripts/check_environment.sh` 本机 0 failure / 0 warning；
- [x] 非 loopback 绑定默认拒绝，跨站浏览器请求与非法 Host 被拒绝；
- [x] 探测超时不会留下孙进程（进程组 kill 测试通过）。

## Phase 1：真实 GDB 单步闭环（后端已完成）

目标：Step Instruction → 真实 GDB 执行一条机器指令 → 采集真实快照 →
前端看到新 RIP/RSP 和栈内存变化。后端链路与 Phase 2 前端均已通过真实测试。

### 1.1 会话与进程（完成）

- `GdbProcess`：`gdb --quiet --nx --interpreter=mi3` 持久子进程，独立进程组；
- `PwndbgLoader`：按配置/检测到的 `source <dir>/gdbinit.py`，失败只 warning；
- `DebugSession`：状态机 + `asyncio.Lock` 串行化；
- `SessionManager`：创建/查询/终止、数量上限、shutdown 清理；
- 启动失败、命令超时、目标退出（`=thread-group-exited`）均落到明确状态。

### 1.2 MI 适配层（完成）

- 单 reader 消费 pygdbmi 输出；
- 命令响应（`^done/^error/^running`）按 token 关联 future；
- 异步记录（`*stopped` 等）进队列，由 session 状态机消费；
- 命令超时只放弃该 future，reader 继续；
- stop/exit 纪元使动作不会错过命令响应同批到达的停止事件。

### 1.3 采集器（完成）

- `-data-list-register-values x` → 16 GPR + EFLAGS（名称索引，缺失回退 evaluate）；
- `-stack-list-frames` → GDB unwinder frames；
- `-data-read-memory-bytes` → RSP 窗口（64B 分块、unreadable 容错）；
- `-data-disassemble` → RIP 附近指令 + 从内存切片得到当前指令字节；
- `Snapshot` + 与前一张的寄存器/按地址字节 diff。

### 1.4 API / WebSocket（完成）

- `POST /api/v1/sessions`（`sample_id`, `stop_at`, `load_pwndbg`）；
- `GET /api/v1/sessions/{id}`；
- `POST /api/v1/sessions/{id}/launch`；
- `POST /api/v1/sessions/{id}/actions`（白名单：`launch/run`, `continue`,
  `interrupt`, `step_instruction`, `next_instruction`, `step`, `next`, `finish`）；
- `GET /api/v1/sessions/{id}/snapshots`；
- `DELETE /api/v1/sessions/{id}`；
- `WS /api/v1/sessions/{id}/stream`（state/snapshot/error/terminated）；
- 快速连点：第二个动作因状态变为 RUNNING 返回 409，不会并发写 GDB。

### 1.5 验收标准

- [x] 每一步都由真实 GDB 执行（`test_session_lifecycle.py`）；
- [x] 单步前后 RIP 变化（测试只做结构性断言，不写死地址）；
- [x] GDB 子进程在整个会话中只启动一次（同一 `gdb_pid` 跨两次快照）；
- [x] 目标退出、断点命中均有状态（STOPPED / EXITED）；
- [x] 关闭 session 后 GDB 与 inferior 均不残留（`/proc` 轮询）；
- [x] 真实中断可停止运行中的 inferior（`test_mi_controller.py`）；
- [x] 命令超时后 reader 仍可继续执行后续命令（真实 GDB 测试）；
- [ ] `push rbp` 的 RSP-8 专用断言：当前样例在 `main` 断点已越过序言，
      未单独覆盖（Phase 2 可增加入口断点/源码视图后补）；
- [ ] 50 次连续快速 Step 压力测试：目前覆盖单步、finish、continue、
      并发拒绝，尚未做 50 次循环。

## Phase 2：图形化栈视图（已完成）

- [x] 地址行 + 8 byte cells + little-endian qword + ASCII；
- [x] RSP/RBP 标记由 snapshot.registers 的真实地址定位到行/byte offset；
      不在窗口时显示 outside 提示；
- [x] 高地址在上、低地址在下，明确 HIGH ADDRESS / LOW ADDRESS / grows downward；
- [x] changed bytes 高亮 + 文字标签 + 150–300ms 动画开关（220ms）；
- [x] 点击 byte cell 显示地址、byte、qword、ASCII、diff；
- [x] 点击 RSP/RBP 滚动到对应行；
- [x] 地址全程字符串；比较/排序使用 BigInt，不经过 Number；
- [x] unreadable 区域以 `--`/unknown/条纹显示，不用 00 伪装；
- [x] Zustand 单一 snapshot 派生所有视图；
- [x] 真实 UI E2E：Run → StepI → changed cell → Inspector → Disasm 选择 → Diff
      → Terminate；`scripts/ui_smoke.mjs`。
- [x] 第二轮 Review：取消清理、本地客户端中间件、WebSocket 队列上限、
      DELETE 失败时前端保留 session。

## Phase 3：调试工作台联动（部分完成）

- [x] 寄存器面板真实值 + before/after；
- [x] 反汇编面板高亮当前 RIP、点击选择；
- [x] 工具栏动作真实可用（Run/Continue/Pause/StepI/NextI/Next/Finish/Terminate）；
- [x] WebSocket 实时推送、断线重连；
- [x] session 状态机与错误提示；
- [ ] 断点增删、源码视图。

## Phase 4：教学语义增强

- DWARF 局部变量、类型、地址、值；
- 指针目标；
- 指令解释规则（仅基于真实 before/after）；
- 每个语义标签标注来源：GDB / DWARF / analyzer / heuristic。

## Phase 5：PWN 教学扩展

- 栈溢出可视化；
- Canary 追踪；
- 堆 chunk / malloc-free 生命周期；
- ROP 链展示；
- 课程任务与挑战。

## 风险与对策

| 风险 | 对策 |
|---|---|
| pwndbg 在 MI 模式下输出噪声 | 只把 console 流当辅助文本，核心数据走 MI |
| MI 命令与异步事件错配 | 单 reader + 命令队列 + 明确等待 stopped |
| 快速连点 | 后端串行 + 前端按钮禁用 + 请求 ID |
| 内存读取跨越不可读页 | 分块读取，unreadable 标记 |
| 无帧指针二进制 | RBP 只作寄存器；栈帧来自 GDB unwinder |
| 把未知数据当返回地址 | 语义标注必须有证据，否则只显示原始字节 |
