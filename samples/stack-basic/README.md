# stack-basic

First teaching sample: a tiny function call whose stack frame is easy to follow.

`demo.c` calls `add_numbers(a, b)` and prints the result. Compiled with
`-O0 -fno-omit-frame-pointer -fno-inline -no-pie`, so the initial `push rbp` /
`mov rbp, rsp` / `sub rsp, ...` prologue and the `call`/`ret` pair are visible as
plain instructions in the disassembly panel.

Build it with:

```bash
scripts/build_samples.sh
```

The compiled binary is written to `samples/stack-basic/demo` and is intentionally
not committed. Use it to watch RIP advance, RSP move, and the return address land
on the stack — every value comes from a real GDB session, never from fixtures.
