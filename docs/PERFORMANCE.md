# PWNviz V1.1 性能：基线、优化与实测数据

本文记录 **PWNviz V1.1** 的性能工作：如何测量、优化了什么、优化前后的真实数字，
以及仍然存在的成本。所有数字都来自仓库内的可复现脚本，不是估算。

> 原则：不以减少真实数据换性能。Fast Snapshot 仍然从真实 GDB 读取寄存器、栈内存和
> 当前指令；变量值通过 `-var-update` 保持为当前值；任何不可读区域依旧是 `null`。

---

## 1. 测量方法

### 1.1 单调时钟

- 后端所有耗时使用 `time.perf_counter()`（单调时钟），见
  `backend/app/analysis/perf.py`。墙钟时间（`time.time()`）从不参与测量，NTP 调整
  不会产生负值。
- 每条 GDB/MI 命令的往返耗时都在 `MIController.execute` 的 `finally` 中记录，
  **超时和失败的命令同样计入**——隐藏慢请求会让报告失真。
- 前端渲染耗时来自 React `<Profiler>` 的 `actualDuration`（毫秒），由
  `frontend/src/lib/renderPerf.ts` 收集。

### 1.2 后端脚本

```bash
# 100 次真实 step_instruction（真实 GDB + 真实 ELF）
wsl -d Ubuntu-22.04 -- ~/.venvs/pwnviz/bin/python \
  /mnt/f/Pwnvis/scripts/benchmark_stepping.py \
  --label optimized --steps 100 --warmup 3 --reset-every 25 \
  --out /mnt/f/Pwnvis/docs/benchmarks/optimized.json
```

固定协议（基线运行与优化运行完全一致）：

| 参数 | 值 | 说明 |
|---|---|---|
| `--steps` | 100 | 参与统计的 step_instruction 次数 |
| `--warmup` | 3 | 丢弃的前几步 |
| `--reset-every` | 25 | 每 25 步重建会话，避免走 libc；重启成本不计入单步 |
| `--mode` | fast | 优化版默认模式；基线版本忽略该环境变量 |
| `--settle` | 默认 | 覆盖 pygdbmi 的批次收敛窗口，用于隔离变量 |

脚本统计 p50 / p95 / max / mean、每次快照的 MI 命令数（按命令名分组）、栈读取命令数、
变量命令数、payload 字节数以及各采集阶段耗时。

`docs/benchmarks/` 下的报告：

```text
baseline.json                 优化前（HEAD 4813c99，干净 worktree）
optimized.json                优化后，默认 MI settle
optimized-settle-0.1.json     优化后，但把 settle 调回基线值（隔离变量）
```

### 1.3 前端脚本

```bash
# 需要真实后端 + Vite dev server + 带 --remote-debugging-port 的 Chromium/Edge
node scripts/perf_frontend.mjs
```

`scripts/perf_frontend.mjs` 在页面内调用真实的 Zustand action（`stepInstruction` /
`restartSession`），因此每一步都是**真实 GDB 单步**，同时读取
`window.__PWNVIZ_RENDER_PERF__`（React Profiler 数据）并检查 DOM 行节点是否复用、
选中的字节是否保持。

基线前端对比使用同一脚本：在 `HEAD` 的干净 worktree 中只加入 Profiler 包装和
`__PWNVIZ_STORE__` 暴露（纯测量代码，无任何渲染优化），Vite 跑在 5174 端口。

---

## 2. 优化前后总览

同一台机器、同一 GDB 12.1、同一 ELF（`samples/stack-basic/demo`，`-O0 -g`）。

| 指标 | 优化前 | 优化后 | 变化 |
|---|---|---|---|
| 单步耗时 p50 | **2630.51 ms** | **45.84 ms** | **57.4×** |
| 单步耗时 p95 | 2635.09 ms | 210.74 ms | 12.5× |
| 单步耗时 mean | 2582.91 ms | 61.84 ms | 41.8× |
| 单步 MI 命令数 p50 | 26 | **4** | 6.5× |
| 单步 MI 命令数 mean | 25.52 | 5.44 | 4.7× |
| 单步 MI 命令数 max | 26 | 19（帧变化步） | — |
| 栈内存读取命令/步 | 9.00 | **1.12** | 8× |
| 变量命令/步 | 12.52 | **2.08** | 6× |
| launch 快照 | 34 MI / 3535.9 ms | 24 MI / **350.9 ms** | 10.1× |
| payload/步 | 17188 B | 18410 B | +7.1%（见 §6） |
| 前端 commits/快照 | 2.22 | **1.04** | 2.1× |
| StackMemoryView 渲染 p50 | 5.3 ms | **0.3 ms** | 17.7× |
| StackMemoryView 渲染 mean | 8.44 ms | 2.33 ms | 3.6× |
| 连续更新时内存行 DOM 复用 | 100% | 100% | 保持 |

### 2.1 归因：命令数量 vs 单命令延迟

V1.1 做了两类互不相同的优化，必须分开看：

1. **减少 GDB/MI 查询数量**（批量化、缓存、增量更新）；
2. **降低每条 MI 命令的固定延迟**：pygdbmi 的
   `time_to_check_for_additional_output_sec` 默认为 0.1 s，它会给**每条命令**追加
   约 100–200 ms 的等待，是基线 2.6 s/步的主因。

为隔离变量，第三次运行保留优化后的采集逻辑，但把 settle 调回 0.1 s：

| 运行 | settle | 单步 p50 | MI/步 p50 |
|---|---|---|---|
| baseline | 0.1 s（硬编码） | 2630.51 ms | 26 |
| optimized-settle-0.1 | 0.1 s | **406.59 ms** | 4 |
| optimized | 0.01 s | **45.84 ms** | 4 |

- 仅减少命令数：2630.51 → 406.59 ms（**6.5×**）；
- 再把 settle 从 0.1 s 降到 0.01 s：406.59 → 45.84 ms（**8.9×**）。

settle 的安全性：它只决定「收到一条记录后再等多久看有没有同批输出」。PWNviz 的 MI
控制器按 token 关联命令响应、把 `*running`/`*stopped` 放进独立事件队列，所以同批
记录被拆到下一次读取不会丢事件，也不会错配命令。该值可通过
`PWNVIZ_MI_SETTLE_SECONDS` 调整（默认 `0.01`）。

---

## 3. 优化内容

### 3.1 栈内存：一次批量读取 + 失败回退

`backend/app/collector/memory.py`

- 默认窗口仍是 RSP-0x80 .. RSP+0x180（0x200 = 512 字节）；
- 正常情况下用**一条** `-data-read-memory-bytes` 读取整个窗口
  （`PWNVIZ_MEMORY_BATCH_MAX_BYTES`，默认 0x400）；
- 窗口大于上限时按上限自动分段；
- 批量命令失败 → 自动降级为 0x40 分块读取（`PWNVIZ_MEMORY_CHUNK_SIZE`）；
- 批量成功但只返回部分字节（跨不可读页）→ 只对缺失区间做分块抢救；
- 返回字节按真实地址写入；未返回的字节保持 `None`，并在
  `stack.unreadable_ranges` 中显式列出，**绝不写成 0**；
- `perf.memory_batch_reads / memory_chunk_reads / memory_degraded` 记录实际路径。

实测：9 条读取 → 1.12 条/步（帧变化或窗口移动才会重新读）。

### 3.2 Fast Snapshot / Full Snapshot

`backend/app/collector/snapshot.py`、`backend/app/sessions/session.py`

| 模式 | 触发 | 内容 |
|---|---|---|
| `fast`（默认） | 每次单步 / continue | 寄存器、栈内存 + diff、当前指令（来自反汇编缓存）、缓存帧（标注 `cached`）、`-var-update` 增量变量 |
| `full` | launch、显式刷新 | 强制 unwind 栈帧、重新取反汇编窗口、完整变量收集/增量更新 |

- launch 的初始快照固定为 `full`，因此第一屏就有真实局部变量；
- 单步默认 `fast`，可通过 `POST /actions {mode}` 或
  `PWNVIZ_SNAPSHOT_MODE` 覆盖；
- 帧发生变化时（见 3.4）Fast 也会重建该帧的变量对象——这是唯一能得到正确变量的
  路径，且只在进出函数时发生；
- 两种模式都执行完全相同的失败处理：任何阶段失败只产生 warning 和诚实的空值。

### 3.3 变量对象缓存与 `-var-update`

`backend/app/collector/variables.py`

优化前每张快照：`-stack-list-variables` + 每个变量
`-var-create` / `-var-info-path-expression` / `-data-evaluate-expression` /
`-var-list-children` / `-var-delete`，约 12.5 条命令/步。

现在：

- 变量对象**持久保留**（`VariableCache`），不再每步创建/删除；
- 同一帧内使用一条 `-var-update --all-values *` 刷新值，复合类型再
  `-var-list-children --all-values` 刷新子值，指针目标按预算重读；
- 帧实例变化时才 `-var-delete` 旧对象并重建（见 3.4）；
- 变量名集合变化、`-var-update` 报 `in_scope=false` / `type_changed=true`、
  缓存超预算（`PWNVIZ_VARIABLE_CACHE_MAX_OBJECTS`，默认 192）时重建；
- 会话结束时删除全部变量对象（`SnapshotCollector.close`）；
- 每个节点仍保留 `source="dwarf"`、`confidence="debug-info"`；
- 指针值变化时旧目标字节会被清空并重读；预算不足时不重读的字节标记
  `target_source="cache"`，不会伪装成刚读取。

状态字段（快照上）：

| `variables_state` | 含义 |
|---|---|
| `full` | 本快照重建/完整读取 |
| `updated` | 复用对象 + `-var-update` 增量刷新，值为当前值 |
| `cached` | 增量刷新失败，展示上次测量值并标记为缓存 |
| `deferred` | Fast 快照且没有可用缓存（点击刷新按钮） |
| `unavailable` | GDB 没有该帧的 DWARF 变量 |

### 3.4 帧刷新策略

`backend/app/collector/frames.py`

只有存在**明确证据**时才重新 unwind：

- 动作是 `finish` / `continue` / `launch` / `step` / `next`；
- 刚执行的指令是 `call` / `callq` / `ret` / `retq`（唯一会压栈/弹栈的指令类）；
- stop reason 是 `breakpoint-hit` / `function-finished` 等；
- 距上次刷新达到 `PWNVIZ_FRAME_REFRESH_INTERVAL`（默认 12）张快照的安全上限，
  防止未察觉的漂移长期存在。

**不使用 RBP 判断帧变化。** 未刷新时快照标记 `frames_state="cached"`、
`frames_stale=true`、`frames_version=<上次读取的快照号>`，UI 可如实展示。

帧身份用于变量缓存失效：`(level, function, file, 帧数, 调用者返回地址)`。
`FrameModel.address` 对第 0 帧是当前 PC，每条指令都会变，因此**不参与**身份判断。

### 3.5 反汇编窗口缓存

`backend/app/collector/disassembly.py`

- 取窗口时一次性完成：`-data-disassemble` + 一条窗口内存读取，后者给出**每条指令
  的真实字节**（不再每条指令单独读一次内存）；
- 缓存保存指令地址、文本、函数、字节和**抓取时的快照号**（`disassembly_version`）；
- RIP 仍在窗口内且位于已知指令边界 → 0 条命令，`disassembly_source="cache"`；
- RIP 离开窗口或跳到非指令边界 → 重新抓取，`disassembly_source="gdb"`；
- 缓存外/未观测的地址绝不当作真实指令返回。

实测：100 步里只有 12 次重新抓取（call/ret/窗口移动），其余 88 步为 0 命令。

### 3.6 PerfStats

- 每张快照携带 `perf` 字段（`SnapshotPerf`）：总耗时、各阶段耗时、MI 命令总数与
  按命令名计数、栈读取/批读取/分块读取、变量命令数、payload 字节、序列化耗时、
  CSV 来源（gdb/cache）、帧与变量状态。
- `GET /api/v1/sessions/{id}/performance` 返回最近一次 + 最近 20 次 + p50/p95 聚合。
- WebSocket 端点在 `send_json` 之后记录真实发送耗时（`ws_send_ms`），写入会话的
  perf 历史。
- 开销：每条 MI 命令两次 `perf_counter()` + 两个小字典更新；每张快照一次依赖固定
  的统计汇总。没有文件 I/O，没有无界集合。

---

## 4. 性能数据：细节

### 4.1 优化前后 MI 命令构成（100 步合计）

| 命令 | 优化前 | 优化后 |
|---|---|---|
| `-exec-step-instruction` | 100 | 100 |
| `-data-list-register-values` | 100 | 100 |
| `-data-read-memory-bytes` | 900 | **112** |
| `-data-disassemble` | 100 | **12** |
| `-stack-list-frames` | 100 | **12** |
| `-stack-list-variables` | 100 | **12** |
| `-var-create` | 288 | **24** |
| `-var-info-path-expression` | 288 | **24** |
| `-data-evaluate-expression` | 288 | **24** |
| `-var-delete` | 288 | **36** |
| `-var-update` | 0 | 88 |
| `-var-list-children` | （含在变量命令） | 0（样例为标量） |
| **合计/步（平均）** | **25.52** | **5.44** |

### 4.2 优化后单步各阶段耗时（mean, ms）

| 阶段 | mean |
|---|---|
| registers | 11.39 |
| frames | 1.34 |
| disassembly | 2.92 |
| memory | 11.41 |
| variables | 22.64 |
| diff | 0.33 |

`variables` 的平均值由 12 次帧变化重建拉高（每次约 13 条命令）；普通步接近 0。
`registers` 与 `memory` 各一条命令，已经接近单命令延迟下限（settle 0.01 s）。

### 4.3 前端（100 次真实单步）

| 指标 | 基线前端 | 优化后 |
|---|---|---|
| React commit 次数 | 222（2.22/快照） | **104（1.04/快照）** |
| StackMemoryView 渲染 p50 | 5.3 ms | **0.3 ms** |
| p95 | 25.39 ms | **2.2 ms** |
| mean | 8.44 ms | 2.33 ms |
| 内存行 DOM 复用 | 6383/6383 | 6383/6383 |
| 选中地址在更新后保持 | true | true |
| 通过 UI 实测单步 p50（含浏览器） | 88.35 ms | **73.3 ms** |

前端优化：

1. `ByteCell` / `StackRowView` 使用 `React.memo`，props 全部降为原始值
   （字节签名、marker 偏移、变更签名等），比较函数只比较这些值；
2. 每张快照只做**一次**行模型构建（地址→变更/标记/选中），替代此前每行每 cell
   重复计算；
3. `changedBytesMap` 用 `useMemo` 绑定快照；
4. `StackMemoryView` / `DisassemblyView` / `RegisterPanel` 用 `memo` 包裹，避免
   Workbench 因 `busy`、会话元数据等无关状态重建整个子树；
5. `StackMemoryView` 只订阅 `session !== null` 而不是整个 session 对象；
6. 单步不再额外 `GET /sessions/{id}`（动作响应已包含状态和快照），去掉一次
   HTTP 往返；
7. 栈画布行数 **> 200** 才启用固定行高虚拟滚动
   （`frontend/src/lib/virtualWindow.ts`），默认 64 行仍渲染完整 DOM，
   保留 RSP/RBP 定位、选中与可访问性。

> 为什么不用 TanStack Virtual：行高固定 22px、滚动容器自有，动态测量恰恰是这里
> 不能要的行为（会让行在单步时跳动）。30 行的算术窗口即可，且不增加依赖。

---

## 5. 复现

```powershell
# 后端基线/优化
wsl -d Ubuntu-22.04 -- ~/.venvs/pwnviz/bin/python /mnt/f/Pwnvis/scripts/benchmark_stepping.py --label optimized --out /mnt/f/Pwnvis/docs/benchmarks/optimized.json

# 前端（先启动后端、Vite、带 CDP 的浏览器）
node scripts/perf_frontend.mjs
```

基线数字来自 `git worktree` 中的 `HEAD`（`4813c99`）干净实现，使用同一个
`benchmark_stepping.py`；前端基线来自同一 worktree 中仅添加 Profiler 包装的版本。

---

## 6. 已知成本与限制

- **payload 增大 7.1%**：`perf` 块（含按命令统计）随每张快照发送。它换来可验证的
  性能数据；如需要可关闭（`PWNVIZ_PERF_HISTORY_SIZE=0` 只影响历史，不裁剪单张
  perf 块）。这里选择诚实上报，而不是隐藏测量。
- **帧变化的步更慢**（约 19 条命令 / 200 ms）：这是变量重建的真实成本，只在进出
  函数时发生。可以用刷新按钮之外的方式改成惰性重建，但会牺牲「进入函数后立即看到
  局部变量」的教学价值。
- **`-var-update` 的粒度**：GDB 只报告变化的变量，未变化的沿用缓存值；这是 GDB
  的语义，不是猜测。
- **帧刷新安全上限**（12 张快照）意味着极端情况下最多 11 步使用缓存帧；UI 会标记
  `cached`，且证据不足时不会声称帧未变化。
- **arm64 / 其他架构**仍不支持，性能数据仅针对 Linux x86-64 + GDB 12.1。
- **第一次快照**包含 GDB 加载 ELF 与 DWARF 的成本（数百毫秒到数秒，取决于磁盘），
  不在单步统计内，但确实存在。
