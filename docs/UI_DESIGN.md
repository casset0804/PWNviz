# UI 设计规范（V1.3）

> 本文档描述 StackMap 演示界面在 V1.3 的实际实现。所有数值与类名都来自当前
> 代码（`frontend/src/components/StackMap/*`、`lib/stackMap.ts`），不包含
> 未实现的计划。调试数据永远来自真实 GDB 快照，任何界面元素都不允许伪造
> 地址、帧边界或变量归属。

---

## 1. 设计原则

1. **地址即布局**：垂直方向上，1 真实字节 = `model.pxPerByte` 像素；
   块顶边严格位于 `addressTop(block.end)`，间隙就是真实的未知字节区域。
2. **单一坐标函数**：`addressTop(model, address) = (windowEnd - address) × pxPerByte`
   是唯一的 Y 坐标来源。内存块、地址标尺、PointerArrow、RSP/RBP Marker、
   变化高亮全部使用它，缩放不产生地址映射偏移。
3. **标题不占地址轴**：帧名、外部变量芯片、图例都住在帧标签列
   （`STACK_MAP_FRAME_LABEL_WIDTH = 184px`）或地址标尺列
   （`STACK_MAP_RULER_WIDTH = 164px`），不进入内存区域。
4. **证据可视化**：凡是没有被内存证据支持的信息（帧边界、变量归属）
   一律显式标注，而不是静默省略或强行归属。
5. **投屏可读**：演示面正文字号 ≥12px，无 8–10px 大面积小字号。

---

## 2. 画布布局（1920×1080 演示模式，V1.4 起为栈中心设计）

> **V1.4 变更**：三栏 26/56/18；栈图内部为居中列组
> （地址标尺 160 | Diff Gutter 12 | 内存柱 320（≤360）| RSP/RBP 标记区 88），
> 内存柱宽度固定、两侧留白；帧为柱内纵向段 + 小型函数名标签；
> 底部教学面板移除，改为 Inspector Drawer（选中内存块时浮出）；
> 唯一讲解 = 顶部 CurrentInstruction。以下 V1.3 描述保留作历史参考，
> 与 V1.4 冲突处以本段为准。

```text
┌────────────────────────────────────────────────────────────────────┐
│ HeaderBar（样例选择 / 连接 / 课堂投屏开关 / 模式切换 / 语言）        │
│ ExecutionBar（运行 / 单步 / 至返回 / 重置 / 终止）                   │
│ [投屏模式隐藏 StatusBar]                                            │
├──────────────┬──────────────────────────────────────┬──────────────┤
│ 源码/汇编     │ 栈帧图 StackMapCanvas（约 2/3 宽）     │ 核心寄存器    │
│ 0.62fr       │ 3.1fr                                │ 0.8fr        │
├──────────────┴──────────────────────────────────────┴──────────────┤
│ StepTeachingPanel（普通: clamp(150px,14vh,176px)；投屏: 单行 64px） │
└────────────────────────────────────────────────────────────────────┘
```

栈图内部横向分为五列：地址标尺 164px → **Diff Gutter 18px**（未归属
变化标记，V1.3.2）→ 帧标签列 184px → 内存块区
（自适应）→ 指针路由区（宽度随可见指针数动态计算：每条正交通道 18px，
上限 12 条；无指针时 12px）。

---

## 3. 缩放系统

| 模式 | testId | pxPerByte 来源 | 说明 |
|---|---|---|---|
| 实际比例 | `zoom-actual` | 固定 `STACK_MAP_PX_PER_BYTE = 10` | 教学基线（100%） |
| 适配当前帧 | `zoom-fit-frame` | `fitFramePxPerByte(viewport, 当前帧字节数)` | 当前帧充满可视区 |
| 适配整栈 | `zoom-fit-stack` | `fitStackPxPerByte(viewport, 窗口字节数)` | 整窗一屏显示 |

- 百分比徽章 `stack-map-zoom-percent` 显示相对实际比例的缩放
  （`zoomPercent`），重置按钮 `stack-map-zoom-reset` 一键回 `actual`；
- pxPerByte 钳制在 `[STACK_MAP_MIN_PX_PER_BYTE=1, STACK_MAP_MAX_PX_PER_BYTE=120]`；
- 缩放只改像素比例，永不改地址、字节数或帧边界；
- 选择持久化在 `localStorage["pwnviz.stackZoom"]`。

---

## 4. 栈帧标题板（StackFrameCard）

- 固定高度 `FRAME_PLATE_HEIGHT = 88px`，`sticky top-0`，位于帧标签列；
  不占用内存块高度，小栈帧（高度 < 88px）也完整展示标题板；
- 内容：`#level` 徽章 + 当前帧/调用者 + 验证状态 + 函数名
  （`line-clamp-2`，完整名在 `title` 与悬停卡中）+ 文件:行 + 变量计数；
- 状态配色与 `data-state`：

| 状态 | 边框/底色 | 语义 |
|---|---|---|
| `current` | cyan 高亮 | 第 0 帧（当前停止帧） |
| `verified` | 次级蓝 `#3c6f96` | 已被内存证据交叉验证的调用者帧 |
| `warning` | amber | 入口/无法验证的帧（边界未证明，绝不伪造） |

---

## 5. 内存块层级（MemoryBlock / VariableBlock）

| 高度（真实字节 × pxPerByte） | 内容 |
|---|---|
| `< 26px`（微型） | 块内不放文字，仅右侧小方块标记；名称走外部芯片 |
| `26–52px` | 单行：名称 + 归属徽章 + 值 + 起始地址 |
| `52–64px` | 双行：加类型/地址/字节大小元数据行 |
| `≥ 64px` | 指针徽章行（指向目标 + 展开按钮） |

- 块边色按语义：变量 cyan / 参数 amber / 指针 sky / 字符串 emerald /
  聚合 violet / 保存的 RBP sky / 返回地址 rose / 未知虚线 / 不可读红虚线；
- `conflict` 归属的块加 amber 外描边，`pin`（无大小证据）用虚线边框；
- 变化字节（V1.3.2）：仅左缘 4px 竖向合并标记（`MemoryChangeOverlay`，
  连续字节合并为一条，宽度 4px = 变化字节数 × pxPerByte），无横跨线、
  无发光、不覆盖块；tooltip 与点击（Inspector 表格）携带
  `before → after` 证据。

### 外部名称芯片（微型块）

- `layoutGutterAnnotations()`（纯函数，单测覆盖）把微型变量芯片放进帧标签列；
- 芯片纵向防重叠堆叠（18px 高 + 3px 间距），引线连接芯片与块的真实中心；
- 芯片可点击（等价于点击内存块）并触发同一悬停卡。

### 悬停信息卡（BlockHoverCard）

- 悬停任意块出现，`pointer-events-none`；
- 内容：名称、种类、类型、真实值、地址范围 `start – end`、字节大小
  （含 `≈ ABI` 标记）、指针目标、归属证据行、
  “点击内存块，在下方详情面板查看真实字节”提示。

---

## 6. 变量归属三态（OwnershipBadge）

| 状态 | 徽章 | 判定 |
|---|---|---|
| `verified` | 无徽章 | GDB `frame_level` 与地址范围一致；或叶函数红区一致 |
| `conflict` | ⚠（amber） | 声明的帧可见但地址证据矛盾；不进入任何帧变量列表 |
| `unresolved` | ?（灰） | 声明的帧不在窗口 / 无 frame_level / 地址无帧可归 |

- 红区规则：地址在帧基址之下、`RSP-128B` 之上、且不与其他已证帧重叠时，
  判为一致（GCC12 `-O0` 叶函数不发 `sub rsp`，局部变量位于 RSP 之下）；
- 头部徽章 `stack-map-unverified-variables` 汇总 `conflict + unresolved` 数量；
- 模型字段：`variableAssignments[]`（claimed/geometric/reason）、
  `unframedBlocks`、`unverifiedCount`。

---

## 7. RSP/RBP Marker 与指针箭头

- Marker 芯片在标尺列，横线贯穿帧标签列与内存区，Y = `addressTop(reg)`；
  `data-address` 必须等于快照寄存器值（Playwright 断言）；
- 寄存器不在窗口内时不渲染 Marker（例如无帧指针样例中 RBP 被用作通用
  寄存器）——这是诚实降级，不是缺失；
- PointerArrow：仅当指针值与目标地址完全相等（resolved 实线）或目标在窗口内
  （unresolved 虚线）时绘制；起止圆点与块的几何中心由同一坐标函数计算。

---

## 8. 课堂投屏模式

- 开关：HeaderBar `projection-toggle`（`aria-pressed`），持久化
  `localStorage["pwnviz.projection"]`；
- 隐藏：StatusBar（perf/会话/流信息）、HeaderBar 会话 ID、
  核心寄存器面板的“开发模式”入口；
- 底部教学区收成单行（验证状态 + 讲解标题 + 上一条指令）；
- 演示面字体阶梯：元数据 12–12.5px / 数值 13–16px / 标题 17–19px /
  寄存器值 18px；全页面无 <11px 可见文字（Playwright 断言 ≥11px）。

---

## 9. 视觉回归基线

- 位置：`frontend/e2e/presentation.visual.spec.ts`；
- 运行：`scripts/run_visual_tests.sh`（自动启动 WSL 后端 + Vite dev server）；
- 场景与产物（1920×1080、zh-CN、presentation 模式、动画关闭）：

| 文件 | 场景 |
|---|---|
| `01-main-calls-add_numbers.png` | main 中 call 指令处 |
| `02-after-push-rbp.png` | 被调函数 push rbp 执行后 |
| `03-locals-initialised.png` | `sum == x + y` 验证后（防止垃圾字节误判） |
| `04-before-return.png` | 停在被调函数 `ret` |
| `05-no-dwarf.png` | `samples/stack-nodwarf`（-g0） |
| `06-no-frame-pointer.png` | `samples/stack-nofp`（无帧指针降级） |
| `07-projection-mode.png` | 课堂投屏模式 |

- 每个场景断言：标题板无裁切、块无裁切（微型块不含内部文字）、
  Marker 地址 == 快照寄存器（窗口内必存在）、箭头锚点落在块的
  真实纵向范围内（V1.3.1 正交几何）、帧卡无重叠、页面无横向溢出、字体 ≥11px；
- 数据全部来自真实 GDB 会话（`POST /api/v1/sessions` → launch → MI 单步），
  禁止 mock 内存数据。

### V1.3.2 追加：diff 纯净度回归（`frontend/e2e/stackmap-diff.spec.ts`）

| 文件 | 场景 |
|---|---|
| `stackmap-v1.3.2/01-single-byte.png` | 1 个变化字节 |
| `stackmap-v1.3.2/02-eight-contiguous.png` | 8 个连续字节 → 一条合并竖标 |
| `stackmap-v1.3.2/03-multi-range-changes.png` | 多段分离变化 |
| `stackmap-v1.3.2/04-gutter-unattributed.png` | 未归属变化只进 Diff Gutter（DOM=快照奇偶校验） |
| `stackmap-v1.3.2/05-inspector-before-after.png` | 点击标记打开 Address\|Before\|After 表格 |

- 断言：栈图内不存在全宽绿色横线（计算样式扫描）、所有 diff 标记宽度
  ≤6px、标记不与 RSP/RBP 芯片相交、1920×1080 无绿色线条噪声；
- 纯函数：`groupMemoryChangesByAddress()`（连续地址合并、逐字节保留
  before/after）+ `layoutChangeGroups()`。

### V1.3.1 追加：清晰度回归（`frontend/e2e/stackmap-clarity.spec.ts`）

| 文件 | 场景 |
|---|---|
| `stackmap-v1.3.1/01-normal-frame.png` | 普通帧（混合尺寸局部变量） |
| `stackmap-v1.3.1/02-multi-level-calls.png` | `stack-deep` 多级调用链 |
| `stackmap-v1.3.1/03-many-pointers.png` | `stack-pointers` 全部指针：每条箭头独占正交通道 |
| `stackmap-v1.3.1/04-many-locals.png` | `stack-manyvars` 大量局部变量 |
| `stackmap-v1.3.1/05-no-dwarf.png` | 无 DWARF（变量块数 == 快照窗口内报告数） |
| `stackmap-v1.3.1/06-no-frame-pointer.png` | 无帧指针 |
| `stackmap-v1.3.1/07-selection-focused-pointers.png` | 默认只画选中块相关指针 |

- 追加断言：所有可见箭头的 `data-lane` / `data-lane-x` 两两互不相同
  （无重叠通道）、NULL/窗外指针不被路由、背景 `background-image: none`
  （纯色，无重复纹理）、Marker 默认无全宽辅助线、点击 Marker 出现临时辅助线。

---

## 10. 相关文档

- 架构与数据流：[ARCHITECTURE.md](ARCHITECTURE.md)
- V1.2 界面说明：[UI_V12.md](UI_V12.md)
- 开发环境与测试：[DEVELOPMENT.md](DEVELOPMENT.md)
