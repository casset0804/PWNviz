# 开发阶段与验收计划

每一阶段结束时项目必须仍可启动。当前仓库状态：**Phase 0 已实现**，
Phase 1 尚未开始（无任何 mock 调试数据）。

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

验收标准（Phase 0）：

- [x] 未装 GDB 的机器上，`/health` 仍 200，`/capabilities` 返回结构化错误而非 500
  （集成测试中把 `PWNVIZ_GDB_BINARY` 指向不存在的程序验证）；
- [x] 前端能显示 GDB 版本、MI3 支持、pwndbg 状态；
- [x] 缺少 GDB / pwndbg 时警告可读，不回退为假数据；
- [x] 后端与前端可分别启动（`scripts/dev_backend.sh` / `npm run dev`）；
- [x] pytest 在真实 WSL 环境中通过（31 passed）；
- [x] `scripts/check_environment.sh` 本机 0 failure / 0 warning。

## Phase 1：真实 GDB 单步闭环（最高优先级）

目标：点击 Step Instruction → 真实 GDB 执行一条机器指令 → 采集真实快照 →
前端看到新 RIP/RSP 和栈内存变化。

### 1.1 会话与进程

- `GdbProcess`：`gdb --quiet --nx --interpreter=mi3` 持久子进程；
- `PwndbgLoader`：按配置 `source <dir>/gdbinit.py`，失败只 warning；
- `DebugSession`：状态机 + 单命令队列（`asyncio.Lock`）；
- `SessionManager`：创建/查询/终止，进程与临时目录清理；
- 启动超时、退出检测（`=thread-group-exited`）。

### 1.2 MI 适配层

- 单 reader 消费 pygdbmi 输出；
- 命令响应（`^done/^error/^running`）与异步记录（`*stopped` 等）分离；
- 明确“等待 stopped”的同步原语，超时返回错误；
- 记录原始输出到 `debugger.output` 事件（辅助面板）。

### 1.3 采集器

- `-data-list-register-values x` → 16 个 GPR + EFLAGS；
- `-stack-list-frames` → frames；
- `-data-read-memory-bytes` → RSP 窗口（分块、unreadable 容错）；
- `-data-disassemble` → RIP 附近指令（含机器码）；
- `Snapshot` + 与前一张的寄存器/字节 diff。

### 1.4 API / WebSocket

- `POST /api/v1/sessions`（`sample_id`, `stop_at`, `load_pwndbg`）；
- `POST /api/v1/sessions/{id}/launch`；
- `POST /api/v1/sessions/{id}/actions`（白名单：`step_instruction`,
  `next_instruction`, `continue`, `interrupt`, `finish`）；
- `GET /api/v1/sessions/{id}/snapshots`；
- `WS /api/v1/sessions/{id}/stream`；
- 快速连点：后端串行，前端禁用按钮直到收到新快照。

### 1.5 验收标准

- [ ] 每一步都由真实 GDB 执行，日志可核对 MI 命令；
- [ ] 单步前后 RIP 变化且等于实际指令长度推进；
- [ ] `push rbp` 的 RSP 减 8 且该地址写入旧 RBP 值（用快照核对）；
- [ ] GDB 子进程在整个会话中只启动一次（PID 不变）；
- [ ] 连续 50 次快速 Step 不发生 MI 响应错配；
- [ ] 目标退出、崩溃、断点命中都有明确状态；
- [ ] 关闭 session 后 GDB 与 inferior 均不残留（`ps` 验证）。

## Phase 2：图形化栈视图

- 地址行 + 8 byte cells + little-endian qword + ASCII；
- RSP/RBP/RIP 标记，高地址在上、低地址在下，文字说明方向；
- changed bytes 高亮（同时保留文字/图标）；
- 点击 byte cell 显示地址与解释；
- 地址全程字符串，不经过 Number。

## Phase 3：调试工作台联动

- 寄存器面板真实值 + before/after；
- 反汇编面板高亮当前 RIP；
- 工具栏动作真实可用；
- WebSocket 实时推送、断线重连；
- session 状态机与错误提示。

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
