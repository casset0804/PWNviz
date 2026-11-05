# stack-pointers

Ten real pointer variables in one frame: three pointers to the same target,
distinct in-frame targets, one NULL and two outside the stack window (a global
and a string literal). Use it to verify the orthogonal pointer lanes, the
selection-focused default and the "show all pointers" toggle.

Build with `scripts/build_samples.sh stack-pointers`.
