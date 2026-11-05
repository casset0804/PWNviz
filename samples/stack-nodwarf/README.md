# stack-nodwarf

Teaching sample built **without DWARF debug info** (`-g0`): the ELF keeps its
symbol table, so GDB can still unwind frames and name functions, but no variable
locations, types or `sizeof` exist.

Use it to verify that PWNviz degrades honestly: variable blocks are absent, the
stack map shows only real memory (saved RBP / return address / unknown bytes),
and nothing invents variable names or sizes.

Build it with `scripts/build_samples.sh stack-nodwarf`.
