# stack-nofp

Teaching sample compiled with `-fomit-frame-pointer`: the callee never executes
`push rbp` / `mov rbp, rsp`, so the frame-pointer chain is unusable.

Use it to verify PWNviz's evidence rules: the current frame is drawn from RSP up
to the provable return-address slot, caller frames are only drawn when memory
corroborates the unwinder, and unprovable extents stay marked as unverified
instead of being invented.

Build it with `scripts/build_samples.sh stack-nofp`.
