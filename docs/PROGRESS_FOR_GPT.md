# PWNviz 项目进度与下一阶段决策材料

> 生成日期：2026-11-05  
> 读者：GPT / 后续架构评审者  
> 目的：基于 `PWNviz_Vibe_Coding_Prompts (1).md` 与 `PWNviz_开发文档.md`，对照当前仓库，判断已经完成什么、还缺什么、下一步优先做什么。  
> 核心原则：**真实 GDB 单步后，前端展示真实栈内存变化，优先级永远最高。**
>
> 仓库：<https://github.com/casset0804/PWNviz>（当前为 public，可直接由 GPT/浏览器读取）。

---

## 1. 一句话现状

PWNviz 已经是一个能真实启动 Linux ELF、通过持久 GDB/MI3 单步、采集真实寄存器/栈帧/内存/反汇编、通过 WebSocket 推送到 React 工作台、并在栈画布中显示真实 diff 的可运行 MVP；还加入了 DWARF 变量语义、空闲会话回收和多轮系统/安全加固。

**当前不是** mock UI，也不是 CPU 模拟器。

---

## 1.3 V1.3 增量：StackMap 视觉打磨与归属可靠性（2026-11-06）

V1.3 不改调试链路、不加 mock；它解决 V1.2 遗留的三个教学可读性问题
（缩放、小字节块裁切、变量归属证据），并为 UI 建立 Playwright 视觉回归基线。

- **缩放系统**：`buildStackMap(snapshot, pxPerByte)` 参数化；
  `实际比例`（10px/byte 固定）/ `适配当前帧` / `适配整栈` 三模式 +
  百分比（相对实际比例）+ 重置，选择持久化。标尺/块/箭头/RSP-RBP Marker
  共用 `addressTop()` 单一坐标函数（`model.pxPerByte`），任何缩放下
  地址映射零偏移；缩放范围钳制 [1, 120] px/byte；
- **小变量块**：块高永远严格等于真实地址空间；`<26px` 微型块内部不放文字，
  变量名以引线芯片画在帧标签列（纯函数 `layoutGutterAnnotations` 防重叠）；
  悬停弹出完整信息卡（`BlockHoverCard`）；点击打开底部 Inspector；
  `VariableBlock` 布局阈值按实测高度分级（<52px 单行、≥64px 才画指针徽章行），
  char/short/int/long/指针无裁切（DOM 断言 scrollHeight/Width）；
- **变量归属三态**：`annotateVariableFrames()` 用 GDB `frame_level` 与真实
  地址范围交叉验证 → `verified` / `conflict`（⚠，不强归）/ `unresolved`（?）；
  叶函数红区（RSP 下方 ≤128 字节、帧基址之下、且不在其他帧内）判为一致，
  避免 GCC12 -O0 叶函数（无 `sub rsp`）的局部变量被误报冲突；
  窗口内但不在已证帧内的变量按真实地址独立绘制（此前被静默丢弃）；
  模型新增 `variableAssignments[]` / `unframedBlocks` / `unverifiedCount`；
- **栈帧标题板**：固定 88px 高度、位于帧标签列、不占地址轴；当前帧 cyan /
  已验证调用者次级蓝 / 无法验证 amber warning（`data-state` 属性）；
- **演示布局（1920×1080）**：三栏 `0.62fr / 3.1fr / 0.8fr`（栈图约 2/3）、
  底部教学区 `clamp(150px,14vh,176px)`；演示面字号全面 ≥12px；
- **课堂投屏模式**：`projectionMode` 入 store（`pwnviz.projection` 持久化），
  HeaderBar 开关；隐藏 StatusBar/会话 ID/开发模式入口，教学区收成单行；
- **视觉回归**：`@playwright/test` + `frontend/e2e/presentation.visual.spec.ts`，
  7 个场景全部驱动真实 GDB 会话（launch 断在 main，MI 单步到检查点）：
  main 调用 / push rbp 之后 / 局部变量初始化（要求 `sum==x+y`，防止把
  未初始化垃圾字节当“已初始化”）/ 返回之前 / 无 DWARF / 无帧指针 / 投屏；
  断言 DOM 与快照一致（Marker 地址、箭头坐标空间、块无裁切、帧无重叠、
  无横向溢出、字体 ≥11px）；截图存 `docs/assets/presentation/`；
  运行：`scripts/run_visual_tests.sh`（自动起 WSL 后端 + Vite）；
- **新样例**：`samples/stack-nodwarf`（`-g0`）、`samples/stack-nofp`
  （`-fomit-frame-pointer`），`scripts/build_samples.sh` 支持按样例覆盖编译参数；
- **验证**：frontend 66 unit passed / 7 files；typecheck（app+e2e 双 tsconfig）
  通过；build 通过；Playwright 7/7 passed（21.6s）。

仍未解决：断点增删 UI、快照时间轴、调用者帧 DWARF 变量树、隔离/多用户。

---

## 1.4 V1.4 增量：以栈为中心的 UI 重设计（2026-11-06）

V1.4 重排演示模式的空间结构：栈内存从横向大矩形变成居中的纵向内存柱，
并去除重复讲解与常驻底部面板。不改后端、不改真实地址/大小/间隔。

- **PresentationWorkbench**：`minmax(340px,26fr) / minmax(620px,56fr) /
  minmax(260px,18fr)` 三栏；源码面板 ≥340px 保证地址/字节/助记符/操作数
  可读；<1280px 寄存器自动折叠；
- **列组几何**：标尺 160（左对齐地址）+ Diff Gutter 12 + 内存柱 320
  （上限 360）+ RSP/RBP 标记区 88 = 580px，工作区内居中，两侧留白；
  内存块/帧/带区全部限制在柱内（Playwright 断言无出柱）；
- **StackFrameCard**：纵向段 + 顶部小型函数名标签（当前帧青/调用者次级/
  未验证琥珀，点击定位）；微变量芯片叠柱左缘；
- **RSP/RBP**：右置标记区，短箭头指向真实地址行，点击定位；
  RSP===RBP 标签错开而锚点不动；默认无跨柱横线（developer/点击临时显示）；
- **讲解去重**：删除 StepTeachingPanel，CurrentInstruction 为唯一讲解
  （一句实测结果）；Inspector Drawer 承接内存 diff/选中块/字节/QWORD/
  ASCII/指针目标/before-after，选中即浮出、可关闭；
- **帧内偏移**：`frameOffset` 字段（如 rbp-0x14）显示在变量块与 Inspector；
- **配色**：变量统一绿色系、返回地址柔红、saved RBP 蓝、未知深灰、
  当前帧青；大面积纯色、无网格/纹理/多重描边；
- **验证**：单测 78 passed；typecheck/build 通过；Playwright 四套件
  **25/25**（新增 `stackmap-v14.spec.ts` 六场景），截图 `docs/assets/v1.4/`；
- 仍未解决：hover 卡片在极窄容器下可能覆盖柱边缘（已做左侧回退）；
  20/60 字节级 diff 场景仍以单测+实测检查点覆盖（见 1.3.2）。

---

## 1.3.2 V1.3.2 增量：移除全宽内存 diff 横线（2026-11-06）

- `MemoryChangeOverlay`：连续变化字节合并为块左缘 4px 竖标
  （高度=字节数×缩放），删除 `left-[5px] right-0 h-[2px]` 全宽线；
  tooltip/点击携带逐字节 before/after；
- `StackMapCanvas`：删除 `changedOutsideBlocks` 全宽绿线；新增 18px
  Diff Gutter（标尺与帧标签列之间），未归属变化只画 4px 竖标 +
  头部计数徽章，点击进 Inspector 表格（Address|Before|After）；
- 纯函数 `groupMemoryChangesByAddress()` / `layoutChangeGroups()`
  （连续合并、逐字节证据保留、布局不受 diff 影响——单测覆盖）；
- 顺带修复：`stack-map-unframed` 包装层拦截帧内点击（pointer-events）；
- Playwright `stackmap-diff.spec.ts` 5/5：无全宽绿线（样式扫描）、
  标记 ≤6px、不与寄存器芯片相交、gutter DOM=快照奇偶校验、
  Inspector 表格；截图 `docs/assets/stackmap-v1.3.2/`；
- 注：单步 in-window diff 天然 ≤ 帧内写入（约 8–16 字节/步），
  "20/60 字节"场景由单测的分组纯函数覆盖，E2E 使用实测检查点。

---

## 1.3.1 V1.3.1 增量：StackMap 视觉清晰度与指针路由修复（2026-11-06）

V1.3.1 只修复图形化栈视图的混乱、细线过多和指针箭头重叠问题；
不改调试链路、不改内存数据模型、不加 mock。

- **指针路由**：修复 V1.3 的通道重叠 bug（laneIndex 在过滤前分配 +
  `Math.max` 控制点钳制使 laneIndex≥4 塌缩）。现在：过滤 NULL/窗外/不可读
  之后按 Y 序分配连续正交通道；宽度随可见数动态计算（18px/通道、上限 12）；
  正交折线 + 圆角；同块出口/同目标入口 6px 错开（钳制在块真实范围）；
  marker id 由 link.id 派生；hover 突出当前线、其余淡化。
  Presentation 默认只画选中块相关指针，"全部指针" 开关持久化显示全部；
- **自适应标尺**：presentation 主刻度 ≥56px 间距、无次刻度；
  developer 更密；随缩放调整；地址对齐不变；
- **纯色色带**：删除三个 repeating-linear-gradient，unknown/unreadable/
  below-rsp/above-frames 改纯色（unreadable 保留左侧红标）；
- **RSP/RBP**：presentation = 芯片 + 短箭头 stub，点击临时全辅助线（5s），
  developer 保留全横线；叶函数 RSP==RBP 时芯片自动错开（测试发现的真 bug）；
- **逐字节变化标记**：按 diff.changed_bytes 真实地址定位，不再整块绿色覆盖；
  变量显示 changed count；Inspector 列出选中块 before/after；
- **边框清理**：删除 overlaps/归属 outline 与 unknown/band 虚线框；
- **新样例**：`stack-deep`（多级调用）、`stack-pointers`（10 指针：3 同目标 +
  NULL + 2 窗外）、`stack-manyvars`（12 混合局部）；
- **验证**：frontend 72 unit passed；typecheck/build 通过；
  Playwright 双套件 14/14（教学 7 + 清晰度 7），截图
  `docs/assets/presentation/` 与 `docs/assets/stackmap-v1.3.1/`；
- 仍未解决：极端嵌套跨度（>12 条）可能出现线条交叉（不重叠）；
  no-DWARF 下 GDB 序言分析仍报告参数变量（真实数据，块数与快照一致）。

---

## 1.2 V1.2 增量：图形化栈帧工作台（2026-11-05）

V1.2 没有更换调试链路，也没有加入任何 mock 数据；它重做了前端信息架构，并把
“真实栈帧边界”和“真实指针关系”作为一等视觉对象。

- **双模式**：默认 Presentation（源码/汇编 + StackMapCanvas + 核心寄存器 +
  单步讲解），可切 Developer（原 Disassembly/StackMemory/RegisterPanel/BottomDock）；
  两种模式共用同一个 Zustand store；
- **StackMapCanvas**：高地址在上、低地址在下，地址/大小来自真实 Snapshot；
  帧边界用 RBP 链 + GDB unwinder 调用者 PC + 内存 qword 交叉验证；
  无帧指针/入口帧/无 DWARF 都有显式降级；
- **真实变量大小**：后端新增 `variables[].size_bytes`（GDB `sizeof`），
  前端按真实字节数绘制块，不再靠类型字符串猜大小；
- **指针连线**：仅当指针值与目标 DWARF 地址完全相等时绘制；NULL/未解析/
  窗口外/不可读分别展示，悬停高亮，点击展开有界目标字节；
- **变化动画**：直接消费 `diff.changed_bytes`，460ms 绿色 overlay，
  `prefers-reduced-motion` 与动画开关可关闭；不延迟真实状态；
- **中文教学语**：`push rbp` / `mov rbp,rsp` / `sub rsp,N` 等在实测一致后
  追加简短中文解释；
- **后端小增量**：样例源码只读接口 `GET /api/v1/samples/{id}/source`；
  `size_bytes`；launch 时显式 `set backtrace past-main on`（否则 GDB 默认
  只展开到 main，调用者帧缺失）；
- **真实样例**：新增 `samples/pointer-basic`（`p=&a`、`q=&b`、NULL）；
- **验证**：backend 141 passed；frontend 53 passed / 7 files；build 通过；
  `scripts/ui_smoke.mjs` 在 1920×1080 + 真实 GDB 下 `ok: true`
  （演示模式栈帧/源码/变化高亮 → 开发模式完整字节表与全流程）。

仍未解决：调用者帧变量树（第 0 帧以外的 DWARF 变量未采集，图中保留真实原始
内存并明确标注）；断点增删、快照时间轴、隔离/多用户。详细 UI 文档见
[UI_V12.md](UI_V12.md)。

---

## 1.1 V1.1 增量：性能与中英双语（2026-11-05）

V1.1 没有更换技术栈、没有删除真实 GDB 链路、没有引入 mock 数据。它做了两件事：
让单步快一个数量级以上，并让整个工作台支持中英双语（默认简体中文）。

### 性能：真实 100 步（GDB 12.1，`samples/stack-basic/demo`）

| 指标 | V1.0（HEAD 4813c99） | V1.1 | 变化 |
|---|---|---|---|
| 单步 p50 | 2630.51 ms | **45.84 ms** | 57.4× |
| 单步 mean | 2582.91 ms | 61.84 ms | 41.8× |
| MI 命令/步 p50 | 26 | **4** | 6.5× |
| MI 命令/步 mean | 25.52 | 5.44 | 4.7× |
| 栈读取命令/步 | 9.00 | 1.12 | 8× |
| 变量命令/步 | 12.52 | 2.08 | 6× |
| launch 快照 | 3535.9 ms / 34 MI | 350.9 ms / 24 MI | 10.1× |
| 前端 commits/快照 | 2.22 | 1.04 | 2.1× |
| StackMemoryView p50 | 5.3 ms | 0.3 ms | 17.7× |

归因（同样 settle=0.1s 时）：2630.51 → 406.59 ms 来自命令数减少；再把 pygdbmi 的
批次收敛窗口从 0.1s 调到 0.01s 后到 45.84 ms。完整表格、复现命令和已知成本见
[PERFORMANCE.md](PERFORMANCE.md)。

### 架构变化（全部向后兼容）

- Fast / Full 两级快照：默认 Fast，launch 与 `POST /refresh` 为 Full；
- 栈窗口一条批量读取，失败自动分块回退，不可读字节仍为 `null`；
- 变量对象跨快照缓存，用 `-var-update` 增量刷新；帧变化才删除重建；
- 反汇编窗口缓存（含每条指令真实字节与抓取快照号）；
- 帧刷新仅在 `call`/`ret`/`finish`/`continue` 等证据下发生，不用 RBP 判断；
- `Snapshot.perf` 随每张快照发送；`GET /sessions/{id}/performance` 提供 p50/p95；
- 新增可选字段：`mode`、`frames_state`、`variables_state`、
  `frames_version`、`variables_version`、`perf`；旧客户端可忽略。

### 国际化

- `i18next` + `react-i18next`，默认 `zh-CN`，`localStorage["pwnviz.locale"]`；
- 7 个命名空间 × 2 语言，键集合由测试强制一致；
- 全 UI（含空状态、tooltip、aria-label、错误、解释）已翻译；
- 技术标识符（寄存器/指令/变量/符号/地址/字节/GDB 原文）保持原样；
- 后端错误改为稳定 `code` + `params`，前端本地化，GDB 原文不丢失；
- 详见 [I18N.md](I18N.md)。

### 测试

```text
Backend: 135 passed（含真实 GDB 集成）
Frontend: 38 passed / 6 files
Build: tsc --noEmit + vite build 成功（403.36 kB / 121.61 kB gzip）
E2E: node scripts/ui_smoke.mjs -> ok: true
     默认 zh-CN、切 en-US、刷新后保持
Frontend perf: 100 次真实单步，DOM 行复用 100%，选中地址保持
```

新增覆盖：单条指令真实寄存器变化与**精确到地址的 byte diff**、512 字节批量读取、
批量失败分块回退、Fast 不重建变量树、Full 刷新局部变量、变量缓存更新/销毁、
反汇编缓存失效重建、中英切换与持久化、连续更新无大面积重渲染。

### 仍未解决

- 帧变化步仍较慢（约 19 条命令 / 200 ms），这是变量重建的真实成本；
- payload 增大约 7%（携带 `perf`），选择诚实上报而非隐藏测量；
- 安全隔离（容器/多用户）、源码视图、断点增删仍未做；
- 只支持 Linux x86-64 + GDB 12.1+。

---

## 2. 已验证的核心闭环

真实 E2E 最近一次结果（`scripts/ui_smoke.mjs`，真实 GDB + Edge CDP，V1.1）：

```json
{
  "before": {
    "snapshot": "snap #1",
    "rip": "0x0000000000401160",
    "rsp": "0x00007fffffffe210",
    "rbp": "0x00007fffffffe220",
    "rows": 64,
    "markers": 2
  },
  "after": {
    "snapshot": "snap #2",
    "rip": "0x0000000000401167",
    "changedCells": 1,
    "changedRows": 1,
    "virtualized": "false",
    "stackRows": 64
  },
  "breakpoints": "bp 1 @ 0x0000000000401160",
  "debugLogHasGdb": true,
  "variablesHaveProvenance": true,
  "language": {
    "defaultLocale": "zh-CN",
    "switched": "en-US",
    "storedLocale": "en-US",
    "persistedAfterReload": true
  },
  "stepPerf": { "ms": 36.314, "mi": 3, "mode": "fast" },
  "renderPerf": { "stackCommits": 12 },
  "layoutCollapse": {
    "stackWidthBefore": 1128,
    "stackWidthAfter": 1399
  },
  "fullFlow": {
    "callAddress": "0x0000000000401178",
    "rspAtCall": "0x00007fffffffe210",
    "rspInside": "0x00007fffffffe200",
    "rspAfterFinish": "0x00007fffffffe210",
    "ripInside": "0x0000000000401144",
    "exited": "EXITED",
    "restarted": true
  },
  "terminated": true
}
```

对应链路：

```text
main 停止
→ StepI：RIP 0x401160 → 0x401167，真实栈 byte diff = 1
→ Step Into add_numbers：RSP e210 → e200
→ Finish：RSP e200 → e210，RIP 回到 main
→ Continue：目标 Exited
→ Restart：新会话回 main，页面不刷新
```

这条链路是当前项目的验收基线。

---

## 3. 对照 Prompt Pack 的阶段完成度

### Phase 0：项目骨架与环境探测 — 已完成

- monorepo：`frontend/`、`backend/`、`samples/`、`docs/`、`scripts/`；
- React + TypeScript + Vite + Tailwind + Zustand；
- FastAPI + Uvicorn + Pydantic v2；
- `/health`、`/api/v1/capabilities`、`/api/v1/samples`；
- 真实 GDB 版本、GDB 内嵌 Python、MI3 支持、pwndbg 检测/可选加载验证、x86-64 门控；
- `.env.example`、环境检查脚本、README、启动脚本；
- GDB 缺失时后端仍可启动并明确显示 unavailable。

### Phase 1：真实 GDB/MI 后端 — 已完成核心

- 每 session 一个持久 GDB/MI3 子进程，不逐步重启 GDB；
- `GdbProcess` + `MIController`：单 reader、令牌 future、异步 stop/exit 事件；
- `DebugSession` 状态机 + `asyncio.Lock`；
- launch / continue / interrupt / stepi / nexti / step / next / finish；
- 真实 Snapshot：寄存器、GDB unwinder frames、RIP 附近反汇编、RSP 窗口 raw memory、byte diff；
- RSP 窗口：RSP-0x80 .. RSP+0x180，按 8-byte 对齐、分块读取、不可读区域显式表示；
- REST + WebSocket；
- 真实 GDB 集成测试、子进程清理测试。

### Phase 2：图形化栈内存画布 — 已完成

- IDE 式深色工作台：Disassembly / Stack Memory / Registers / Bottom Dock；
- 地址、8 个 byte cell、qword、ASCII、HIGH/LOW address、stack grows downward；
- RSP/RBP 行级 marker、changed byte 高亮、unknown/unreadable 表示；
- 点击 byte cell 查看地址/byte/qword/ASCII/diff；
- RSP/RBP 点击滚动定位；
- 1280×720 适配、面板折叠、Stack 优先宽度；
- RSP 自动居中、reduced-motion 支持。

### Phase 3：工作台联动与教学解释 — 已完成核心

- Toolbar：Run、Continue、Pause、StepI、NextI、Step Into、Step Over、Finish、Restart、Terminate；
- Status Bar：Idle/Initializing/Running/Stopped/Exited/Error；
- WebSocket：session.state / snapshot / debugger.output / debugger.error / breakpoints.updated / session.terminated；
- 断线重连、重复事件去重、stale snapshot、后端重启、未知 session；
- Debug Log 展示真实 GDB/MI 输出；
- Explanation 有限规则：push / pop / mov / sub rsp / add rsp / call / ret / leave / nop；
- call/ret 只有在实测栈顶值匹配时才称为返回地址；
- 不把 RBP 当固定 frame pointer；
- 快照缺口时拒绝把多步差异归因于单条指令。

### Phase 4：DWARF 与变量语义 — 已完成核心，仍有边界

已完成：

- GDB/MI variable objects：`-stack-list-variables`、`-var-create`、`-var-info-path-expression`、`-var-list-children`、`-data-evaluate-expression &(...)`；
- local / 参数 / 类型 / 值 / 地址 / `location_kind`；
- `memory / register / optimized_out / unavailable / unknown`；
- array / struct / union / pointer / char array string；
- 每个节点 `source="dwarf"`、`confidence="debug-info"`；
- pointer target 单层、最多 64B、最多 16 个目标的有界读取；
- invalid/unreadable 明确展示；
- 无 debug info 时变量为空并 warning，raw stack/registers 保持完整；
- 真实测试矩阵：`-g -O0`、无 debug、`-O2`、`-O2 -fomit-frame-pointer`、optimized out、无效指针。

未完成：

- 多 frame 变量树；
- C++ 容器、复杂嵌套指针链；
- 完整 DWARF 类型系统/函数参数调用栈；
- source line 与变量作用域的高亮联动；
- 可选 GDB Python adapter（当前不需要，未引入）。

### Phase 5：安全隔离 — 未开始

明确未做：

- Docker/容器执行；
- 非 root、只读根文件系统、禁网、CPU/内存/PID 限额；
- ptrace/seccomp 最小权限；
- 任意 ELF 上传；
- 多用户账号/权限。

当前仍是**本机可信样例、单用户**模型。

### UI 视觉打磨 — 已完成

- 石墨色低饱和视觉、等宽数据字体、语义色 + 文字标签；
- 左右面板折叠为 34px rail、Bottom Dock 折叠；
- 1280×720；
- RSP 橙色 / RBP 蓝色 / current RIP 青色 / diff 绿色 / unreadable 灰红；
- 无 marketing dashboard 卡片/玻璃拟态/大面积渐变；
- reduce-motion 下关闭动画和 smooth scroll。

### Code Review — 已做四轮

最近一轮（提交 `d4cacaf`）修复：

1. launch 初始 snapshot 未就绪时不再静默成功；
2. MI reader 失败/异常退出时立即唤醒 pending command；
3. launch/step/continue/interrupt 取消路径统一清理 GDB；
4. DWARF 变量名/样本路径控制字符拒绝，防止 MI 行注入；
5. idle session reaper（默认 30 分钟无 WS 活动回收）。

---

## 4. 当前架构

```text
React / TypeScript / Zustand
   │ REST + WebSocket
FastAPI / asyncio
   │ SessionManager / DebugSession / SnapshotCollector
   │ pygdbmi + GDB/MI3
持久 GDB 子进程
   └── Linux ELF / inferior
```

关键目录：

```text
backend/app/
├── debugger/       GdbProcess (settle 可配置), MIController (+perf 计数), pwndbg loader
├── sessions/       DebugSession (fast/full + refresh + perf), SessionManager, idle reaper
├── collector/      registers, frames (刷新策略), memory (批量+回退),
│                   disassembly (窗口缓存), variables (varobj 缓存), snapshot (fast/full)
├── analysis/       byte/register diff, perf.py (单调时钟 Profiler)
├── api/            sessions (+refresh/+performance), websocket (+ws_send_ms),
│                   capabilities, samples
└── schemas/        Snapshot (+perf/缓存状态) / Session / VariableNode

frontend/src/
├── app/            Workbench
├── components/     Toolbar (+LanguageSwitch), StatusBar (+perf), Disassembly,
│                   StackMemory (memo/虚拟化), Registers, BottomDock,
│                   MemoryInspector, VariablesPanel (+刷新按钮), Explanation, Log
├── i18n/           i18next 初始化 + locales/{zh-CN,en-US}/ 7 个命名空间
├── stores/         single debug store, WS reconnect/dedupe
├── lib/            BigInt address, snapshot derivations, explanations (可注入翻译),
│                   virtualWindow, renderPerf
└── services/       REST + WS client (code+params 错误)

samples/stack-basic/demo.c
scripts/ui_smoke.mjs, benchmark_stepping.py, perf_frontend.mjs
scripts/run_backend_tests.sh
docs/ARCHITECTURE.md, API.md, DEVELOPMENT.md, SECURITY.md, PHASES.md,
docs/PERFORMANCE.md, docs/I18N.md, docs/benchmarks/*.json
```

---

## 5. 真实测试状态

最近一次实际执行（V1.1）：

```text
Backend:
135 passed, 1 warning in 29.65s

Frontend:
Test Files 6 passed (6)
Tests 38 passed (38)

Build:
tsc --noEmit && vite build: success
dist/assets/index-*.js 403.36 kB (121.61 kB gzip)

E2E:
node scripts/ui_smoke.mjs -> ok: true
  默认 zh-CN → 切 en-US → 刷新后保持

Backend benchmark (100 real steps):
  baseline p50 2630.51 ms / 26 MI
  optimized p50  45.84 ms /  4 MI

Frontend render benchmark (100 real steps):
  commits/snapshot 1.04, StackMemoryView p50 0.3 ms,
  DOM 行复用 100%，选中地址保持
```
测试特点：

- 真实 GDB 集成测试未删除、未改成 mock；
- 真实测试覆盖 launch / step / diff / finish / continue / exit / cleanup；
- 变量矩阵测试真实 gcc + gdb；
- 真实 WebSocket 测试；
- 真实 UI E2E 覆盖 Run、StepI、Step Into、RSP、Finish、Continue、Restart、Variables、Debug Log、布局折叠、中英切换与持久化；
- V1.1 新增：精确到地址的 byte diff、批量读取/回退、fast/full 契约、
  变量缓存更新/销毁、反汇编缓存失效、单步性能门限（MI < 26）。

已知测试缺口：

- 没有 CI；
- ~~没有精确断言"某个栈地址的 before/after byte"~~ 已由
  `tests/integration/test_fast_snapshot.py` 覆盖；
- ~~没有 50 次连续 Step 压力测试~~ 已由 100 步 benchmark 覆盖（非断言型）；
- 没有慢 WS 客户端/丢事件注入测试；
- 没有真实后端 SIGKILL 清理测试；
- 没有像素级视觉回归；
- 没有 arm64/其他 GDB 版本的性能矩阵。

---

## 6. 对照开发文档 V1 / V2 功能表

### V1

| 功能 | 状态 |
|---|---|
| DWARF 局部变量名称/类型/值/位置 | 核心已完成 |
| 源码视图与汇编联动 | 未做（只有反汇编 + 变量） |
| 断点增删 | 未做（只有 launch 初始断点） |
| 内存区域手动查看/地址跳转 | 部分：栈窗口/指针目标，无任意地址查看 |
| 快照历史时间轴 | 有历史 API/数据，无 UI 时间轴 |
| 教学解释卡片 | 有限规则已完成 |
| struct/array/string/pointer 语义 | 已完成核心 |
| 运行参数配置 | 未做 |

### V2 / PWN 专项

- 栈溢出可视化：未做；
- Canary 追踪：未做；
- 函数调用/返回返回地址标注：只在 Explanation 中做“实测确认”的有限展示；
- Heap chunk / malloc-free 生命周期：未做；
- fastbin/tcache：未做；
- ROP chain：未做；
- 课程任务/实验：未做。

---

## 7. 安全与部署边界

当前设计：

- 默认绑定 `127.0.0.1`；
- 非 loopback 绑定默认拒绝，需显式 `PWNVIZ_ALLOW_REMOTE=1`；
- `LocalOnlyMiddleware` 拒绝非 loopback HTTP/WS client；
- Host 白名单、CORS、跨站请求拒绝；
- session ID 随机；
- 每个 session 独立 GDB、独立 WS 队列；
- 空闲 session reaper；
- MI 控制字符拒绝；
- 正常路径 GDB/inferior 清理；
- 无任意命令 API。

仍未解决：

- 无用户认证/权限；
- 知道 session ID 的本机进程可控制对应 session；
- `PWNVIZ_ALLOW_REMOTE=1` 时无认证；
- 本机反向代理会让 remote 请求呈现为 loopback；
- 后端 SIGKILL 无 PDEATHSIG/supervisor；
- WS 无 heartbeat；
- 不支持不可信 ELF/容器隔离；
- 只支持 Linux x86-64，后端依赖 WSL/Linux 的 GDB。

**不要把当前版本直接作为公网在线靶场。**

---

## 8. 下一阶段方向选项（供 GPT 决策）

### 选项 A：核心闭环加固（建议优先）

工作：

- 精确栈地址 before/after byte 的 API + DOM 断言；
- 50 次连续 Step + 慢 WS/重连测试；
- GitHub Actions/CI（Ubuntu 22.04 + GDB + Chromium）；
- 真实 SIGKILL 场景的 supervisor/PDEATHSIG 设计。

收益：把“真实 GDB 单步 → 真实栈变化”变成不可回归的质量门。  
成本：低-中。  
风险：低，直接保护最高优先级。

### 选项 B：V1 调试器完整度

工作：

- source view（Monaco/只读源码）与源码行联动；
- 断点增删 REST/WS/UI；
- 多 frame 变量树；
- 任意内存地址查看/跳转；
- 快照时间轴UI。

收益：更像完整调试器。  
成本：中。  
风险：容易把时间花在通用 IDE 功能，削弱 PWN 教学差异化。

### 选项 C：PWN 教学差异化

工作：

- 栈溢出覆盖过程（buffer / saved RBP / return address 着色）；
- Canary 位置/变化追踪；
- call/ret 返回地址标注；
- ROP 栈/寄存器传参视图；
- 直接面向 PWN 初学者的实验样例与挑战。

收益：产品定位最独特，直接服务目标用户。  
成本：中-高。  
风险：需要先保证核心稳定和测试基线；否则新语义可能引入误判。

### 选项 D：隔离与远程/多人

工作：

- 任务容器、非 root、禁网、只读 rootfs、资源限制；
- ptrace/seccomp 设计；
- 用户认证、session token、WS 授权；
- 任务上传/清理。

收益：为在线服务/多人使用打开可能。  
成本：高。  
风险：当前单机 MVP 还未需要；提前做会拖慢核心。

---

## 9. 推荐决策

**短期（下一步）选择 A，随后选择 C 的一个最小切片。**

理由：

1. PWNviz 的核心卖点不是“通用 GDB GUI”，而是“让 PWN 初学者看见指令/栈/内存变化”；
2. 核心闭环已经可用，但缺少 CI 和精确字节回归；这是最高杠杆的质量投资；
3. A 完成后，选择 C 的“栈溢出 + Canary 最小教学样例”比先做通用 source/breakpoint 更能形成差异化；
4. B 的 source view/断点可以作为后续 V1 补全；D 在未有公网/多人需求前不应提前做。

建议顺序：

```text
A（核心回归 + CI）
  └─ C1（栈溢出/Canary 可视化最小闭环）
       └─ B（source view / breakpoint / multi-frame）
            └─ D（隔离/远程，仅在需要时）
```

---

## 10. 给 GPT 的关键问题

1. 以“PWN 初学者 10 分钟内能看懂第一条 call/ret 栈变化”为目标，当前 UI 还缺哪一层教学叙事？
2. 下一阶段应优先做通用调试器能力（source/breakpoint），还是 PWN 专项可视化（overflow/Canary/ROP）？
3. 如果要上线给少量远程用户，最低可行的隔离/认证方案是什么？是否应该先只做本机模式？
4. 对当前变量语义的 `source/confidence` 边界是否足够让教学者信任？是否需要加入“heuristic/inferred”显式标签？
5. 是否应把“精确栈字节回归 + 50 step”作为任何新功能合并前的硬门槛？

---

## 11. 如何本地启动

```powershell
# 1. 后端依赖（WSL）
wsl -d Ubuntu-22.04 -- bash /mnt/f/Pwnvis/scripts/wsl_bootstrap.sh
wsl -d Ubuntu-22.04 -- bash /mnt/f/Pwnvis/scripts/check_environment.sh
wsl -d Ubuntu-22.04 -- bash /mnt/f/Pwnvis/scripts/build_samples.sh

# 2. 后端
wsl -d Ubuntu-22.04 -- bash /mnt/f/Pwnvis/scripts/dev_backend.sh

# 3. 前端
cd F:\Pwnvis\frontend
npm install
npm run dev
```

打开 `http://127.0.0.1:5173`，选择 `stack-basic`，点击 Run。

---

## 12. 验证命令

```powershell
# backend
wsl -d Ubuntu-22.04 -- bash -c "cd /mnt/f/Pwnvis/backend && ~/.venvs/pwnviz/bin/python -m pytest -q"

# frontend
cd F:\Pwnvis\frontend
npm test
npm run build

# E2E（先启动后端 + Vite + Edge CDP）
node F:\Pwnvis\scripts\ui_smoke.mjs
```

---

## 13. 结论

- **核心 MVP 已可用**，并且有真实 GDB E2E 证据；
- **Phase 0/1/2/3 已完成核心，Phase 4 变量语义已完成核心，Phase 5 未开始**；
- 当前最值得做的不是继续堆 UI，而是用 CI + 精确字节断言把核心闭环锁死；
- 之后优先做 PWN 教学差异化（栈溢出/Canary），而不是先做通用 IDE 功能；
- 任何新功能都不能挤占“真实单步 → 真实栈变化”的优先级。
