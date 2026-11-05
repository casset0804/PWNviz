# pointer-basic

指针关系的真实教学样例：`int *p = &a;`、`int *q = &b;` 与 `int *n = NULL;`。

PWNviz 只有在**指针值完全等于**目标变量的 DWARF 地址时才绘制连线；样例中的
`p → a`、`q → b` 都可以被真实快照验证，`n` 显示为 NULL，不会连线。

编译方式与其他样例一致：

```bash
gcc -g -O0 -fno-omit-frame-pointer -fno-inline -fno-pie -no-pie \
    -o samples/pointer-basic/demo samples/pointer-basic/demo.c
```

在 PWNviz 中选择 `pointer-basic`，运行后逐步执行到 `int *p = &a;` 之后，
栈帧图中即可看到指针块与目标变量块之间的连线。
