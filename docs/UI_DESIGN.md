# UI 设计规范（V1.4）

> 本文档描述 **V1.4 当前正式**的演示模式 UI。所有数值与类名都来自当前代码
> （`frontend/src/components/StackMap/*`、`Presentation/*`、`lib/stackMap.ts`）。
> 调试数据永远来自真实 GDB 快照；任何界面元素都不允许伪造地址、帧边界、
> 变量归属或内存内容。V1.3 及更早的布局说明见文末历史附录。

---

## 1. 设计原则

1. **栈中心**：居中的纵向内存柱是整个产品最大的视觉区域；它的高度由真实
   内存布局决定，宽度固定，不随容器拉伸。
2. **地址即布局**：垂直方向 1 真实字节 = `model.pxPerByte` 像素；块顶边
   严格位于 `addressTop(block.end)`；间隙就是真实的未知字节区域。
3. **单一坐标函数**：`addressTop(model, address) = (windowEnd - address) × pxPerByte`
   是唯一 Y 坐标来源（内存块、标尺、指针箭头、RSP/RBP 箭头、变化标记），
   任何缩放下地址映射零偏移。
4. **证据可视化**：帧边界、变量归属没有内存证据支持时显式标注
   （verified / conflict / unresolved），绝不静默省略或强行归属。
5. **中文优先、大字号、少颜色**：大面积纯色；无网格背景、无重复纹理、
   无多重描边、无装饰性细线；箭头不满屏。

---

## 2. 页面布局（1920×1080）

```text
HeaderBar（样例 / 连接 / 课堂投屏 / 模式切换 / 语言）
ExecutionBar（运行 / 单步 / 至返回 / 重置 / 终止）
StatusBar（投屏模式隐藏）
CurrentInstruction ← 唯一执行解释表面（指令 / 地址 / 函数 / 一句实测结果）
├─ 26%  源码/汇编     地址、字节、助记符、操作数完整可读（≥340px，不缩字体）
├─ 56%  StackMap 工作区  页面最大视觉区域（内部为居中内存柱，见 §3）
└─ 18%  核心寄存器     RIP/RSP/RBP/RAX，其余折叠（<1280px 整列折叠）
Inspector Drawer：选中内存块/变化区时从右侧浮出（不占常驻空间，可关闭）
```

三栏 Grid：`minmax(340px,26fr) / minmax(620px,56fr) / minmax(260px,18fr)`。
页面本体不滚动；滚动只发生在栈图内部。

---

## 3. 栈图内部：居中列组（宽度固定 580px）

```text
┌────────────┬──────┬────────────────────────────┬──────────┐
│ 地址标尺    │ Diff │        内存柱 (Spine)       │ RSP/RBP  │
│   160px    │ 12px │         320px (≤360)        │  88px    │
└────────────┴──────┴────────────────────────────┴──────────┘
   groupLeft = max(8, (contentWidth − 580) / 2)，两侧为干净留白
```

- **内存柱宽度固定**（`STACK_MAP_SPINE_WIDTH = 320`，上限
  `STACK_MAP_SPINE_MAX_WIDTH = 360`）：真实字节几何只映射到高度，
  宽度不随容器拉伸；内存块、帧、带区全部限制在柱内（E2E 断言出柱 ≤2px）；
- **地址标尺**（160px）：左对齐等宽 12.5px；稀疏主刻度与内存行共享
  `addressTop()`；presentation 无次刻度，developer 更密且随缩放自适应；
- **Diff Gutter**（12px）：未归属内存变化只画 4px 竖标（连续地址合并），
  头部显示计数；点击打开 Inspector 的 Address|Before|After 表格；
  任何标记不允许延伸到内存柱主体；
- **指针箭头**：路由到列组右侧留白（lane 数随可用宽度自适应，上限 12），
  每条箭头独占正交通道；Presentation 默认只画选中块相关指针，"全部指针"
  开关显示全部真实关系。

---

## 4. 栈帧与内存块

- 每个真实栈帧是内存柱的一段**纵向区域**（顶部一条状态色细线为界）；
- **函数名小型标签**叠在段顶（`stack-frame-chip`）：`#level + 函数名
  (16px) + 文件:行`；当前帧青色 / 已验证调用者次级蓝 / 未验证琥珀；
  点击定位该帧；标签为覆盖层，不占字节坐标空间；
- 内存块全柱宽平铺：变量绿色系（`border-l-emerald-400`）、返回地址柔红、
  saved RBP 蓝、未知/不可读中性深灰、below-RSP/above-frames 中性带；
- 块内展示：变量名(15-16px)、类型、当前值(16-18px)、地址、字节大小、
  帧内偏移（`rbp-0x14`）；布局预算按实测高度分级（<64px 单行、
  ≥96px 才有指针徽章行），更小的块靠 hover 卡与 Inspector；
- 变化字节：仅左缘 4px 合并竖标（连续地址合并、逐字节 before/after 保留），
  无横跨线、无发光。

---

## 5. RSP / RBP 右侧定位

- 橙色 RSP、蓝色 RBP 芯片位于内存柱**右侧** 88px 标记区；
- 短箭头（14px 桥 + 菱形锚点）精确指向当前地址行；**默认不画跨柱横线**；
- developer 模式（或点击芯片）显示贯穿内存柱的临时辅助线（5 秒自动消失），
  辅助线只在柱宽范围内；
- RSP === RBP（叶函数）时芯片垂直错开，箭头锚点仍指向同一真实地址；
- 点击芯片定位对应地址（`data-address` 恒等于快照寄存器值，E2E 断言）。

---

## 6. Inspector Drawer（唯一细节表面）

选中内存块或变化区时从右侧浮出（400px，可关闭），承载原底部面板全部能力：

1. 本步内存变化列表（点击任一条定位）；
2. 选中块详情：名称/类型/大小/地址/帧内偏移/当前值；
3. 原始字节（32）+ QWORD + ASCII；
4. 指针目标（字节 + 字符串）；
5. Address | Before | After 表格（选中块的变化或所在变化区间）。

**不含执行解释**：CurrentInstruction 是唯一的本步讲解表面
（E2E 断言其数量恒为 1，抽屉内不出现"本步讲解"）。
DeveloperWorkbench 保留完整 BottomDock，不受影响。

---

## 7. 课堂投屏模式

- HeaderBar 开关（持久化 `pwnviz.projection`）；
- 隐藏 StatusBar、会话 ID、开发模式入口；保留 CurrentInstruction 与栈图；
- 字体：地址 12-12.5px、变量名 15-16px、值 16-18px、栈帧名 16px、
  寄存器 15-18px；全页面可见文字 ≥11px（E2E 断言）。

---

## 8. 视觉回归

四套 Playwright 套件驱动真实 GDB（禁 mock），1920×1080 zh-CN：

| 套件 | 覆盖 | 截图目录 |
|---|---|---|
| `presentation.visual.spec.ts` | 7 个教学检查点 + 投屏 | `docs/assets/presentation/` |
| `stackmap-clarity.spec.ts` | 帧链/指针/大量变量/无 DWARF/无帧指针 | `docs/assets/stackmap-v1.3.1/` |
| `stackmap-diff.spec.ts` | diff 纯净度（无全宽绿线、≤6px 标记、gutter 奇偶校验） | `docs/assets/stackmap-v1.3.2/` |
| `stackmap-v14.spec.ts` | V1.4 六场景布局验收 + 唯一讲解 + BottomDock | `docs/assets/v1.4/` |

所有涉及源码面板的场景先执行 `waitForSourceReady()`：验证
`GET /api/v1/samples/{id}/source` 正常（内容非空、行数 >0）、loading
消失、真实源码行渲染、文件名非空 —— 截图永不捕获 loading 状态。
运行：`scripts/run_visual_tests.sh`（WSL 后端 + Vite + Playwright）。

---

## 9. 相关文档

- 架构与数据流：[ARCHITECTURE.md](ARCHITECTURE.md)
- 开发环境与测试：[DEVELOPMENT.md](DEVELOPMENT.md)

---

## 附录 A：历史设计（V1.3 — V1.3.2，已被 V1.4 取代）

以下描述仅作历史参考；与正文冲突处以正文为准。

- **V1.3 布局**：三栏 0.62/3.1/0.8；地址标尺 164px 右对齐；帧标签列 184px
  内含 88px 固定标题板（sticky）；内容容器 min-width 740px；底部常驻
  StepTeachingPanel（clamp(150px,14vh,176px)，三文章）。
- **V1.3.1**：指针正交通道路由（过滤后分配 lane、动态宽度 18px/通道、
  出口/入口错开、marker id 由 link.id 派生、hover 淡化）、自适应标尺、
  纯色色带、RSP/RBP 芯片在标尺列（左）、微型块外部引线芯片在帧标签列。
- **V1.3.2**：diff 纯净度——块内变化合并为左缘 4px 竖标、未归属变化进
  18px Diff Gutter（当时位于标尺与帧标签列之间）、Inspector 表格化。
- V1.4 变更：栈图从横向大矩形改为居中窄柱；帧标签列/标题板删除
  （改为柱上芯片）；RSP/RBP 移到柱右侧；底部面板删除（改 Drawer）；
  地址标尺改左对齐并收窄到 160px；Diff Gutter 收窄到 12px 并紧贴柱左缘。
