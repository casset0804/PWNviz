import { describe, expect, it } from "vitest";

import { explainStep } from "./explain";
import type { Snapshot, StackRow } from "../types/debug";

function row(address: string, qword: string | null): StackRow {
  if (qword === null) {
    return {
      address,
      bytes: Array.from({ length: 8 }, () => null),
      readable: false,
      qword_le: null,
      ascii: null,
      annotations: [],
      changed_byte_offsets: [],
    };
  }
  const value = BigInt(qword);
  const bytes = Array.from({ length: 8 }, (_, index) =>
    Number((value >> BigInt(index * 8)) & 0xffn)
      .toString(16)
      .padStart(2, "0"),
  );
  return {
    address,
    bytes,
    readable: true,
    qword_le: qword,
    ascii: "........",
    annotations: [],
    changed_byte_offsets: [],
  };
}

function instruction(address: string, text: string, bytes: string) {
  const [mnemonic, ...rest] = text.split(" ");
  return {
    address,
    bytes,
    mnemonic,
    operands: rest.join(" "),
    text,
    function: "main",
  };
}

function snapshot(
  snapshotId: number,
  registers: Record<string, string>,
  currentInstruction: ReturnType<typeof instruction> | null,
  rows: StackRow[],
  changedRegisters: string[] = [],
  changedBytes: Snapshot["diff"]["changed_bytes"] = [],
): Snapshot {
  return {
    session_id: "sess_explain",
    snapshot_id: snapshotId,
    timestamp: "2026-11-03T00:00:00Z",
    state: "STOPPED",
    stop_reason: "end-stepping-range",
    architecture: "x86-64",
    endianness: "little",
    pointer_bits: 64,
    registers,
    frames: [],
    instruction: currentInstruction,
    disassembly: [],
    stack: {
      range_start: "0x00007fffffffe200",
      range_end: "0x00007fffffffe300",
      word_size: 8,
      rows,
      unreadable_ranges: [],
    },
    diff: {
      previous_snapshot_id: snapshotId > 1 ? snapshotId - 1 : null,
      changed_registers: changedRegisters,
      changed_bytes: changedBytes,
      window_changed: false,
    },
    warnings: [],
  };
}

describe("explainStep", () => {
  it("explains push using the real RSP delta and new stack qword", () => {
    const previous = snapshot(
      1,
      {
        rip: "0x0000000000401158",
        rsp: "0x00007fffffffe280",
        rbp: "0x00007fffffffe280",
        rax: "0x0000000000000000",
      },
      instruction("0x0000000000401158", "push rbp", "55"),
      [],
    );
    const current = snapshot(
      2,
      {
        rip: "0x0000000000401159",
        rsp: "0x00007fffffffe278",
        rbp: "0x00007fffffffe280",
        rax: "0x0000000000000000",
      },
      instruction("0x0000000000401159", "mov rbp,rsp", "4889e5"),
      [row("0x00007fffffffe278", "0x00007fffffffe280")],
      ["rip", "rsp"],
    );

    const explanation = explainStep(previous, current, "step_instruction");
    expect(explanation.matched).toBe(true);
    expect(explanation.rule).toBe("push");
    expect(explanation.lines.join(" ")).toContain("减少 8");
    expect(explanation.lines.join(" ")).toContain("0x00007fffffffe280");
  });

  it("explains sub rsp with the real immediate and warns against locals semantics", () => {
    const previous = snapshot(
      1,
      { rip: "0x000000000040115c", rsp: "0x00007fffffffe280", rbp: "0x00007fffffffe280" },
      instruction("0x000000000040115c", "sub rsp,0x10", "4883ec10"),
      [],
    );
    const current = snapshot(
      2,
      { rip: "0x0000000000401160", rsp: "0x00007fffffffe270", rbp: "0x00007fffffffe280" },
      instruction("0x0000000000401160", "mov DWORD PTR [rbp-0xc],0xa", "c745f40a000000"),
      [],
      ["rip", "rsp"],
    );

    const explanation = explainStep(previous, current, "step_instruction");
    expect(explanation.matched).toBe(true);
    expect(explanation.rule).toBe("sub rsp");
    expect(explanation.lines.join(" ")).toContain("不表示");
    expect(explanation.lines.join(" ")).toContain("局部变量");
  });

  it("recognizes a nop without treating RIP as an unexplained register change", () => {
    const previous = snapshot(
      1,
      { rip: "0x00000000004011a0", rsp: "0x00007fffffffe280", rbp: "0x00007fffffffe280" },
      instruction("0x00000000004011a0", "nop", "90"),
      [],
    );
    const current = snapshot(
      2,
      { rip: "0x00000000004011a1", rsp: "0x00007fffffffe280", rbp: "0x00007fffffffe280" },
      instruction("0x00000000004011a1", "ret", "c3"),
      [],
      ["rip"],
    );

    const explanation = explainStep(previous, current, "step_instruction");
    expect(explanation.matched).toBe(true);
    expect(explanation.rule).toBe("nop");
  });

  it("explains call with the measured return address", () => {
    const previous = snapshot(
      1,
      { rip: "0x0000000000401178", rsp: "0x00007fffffffe210", rbp: "0x00007fffffffe220" },
      instruction("0x0000000000401178", "call 0x401136 <add_numbers>", "e8b9ffffff"),
      [],
    );
    const current = snapshot(
      2,
      { rip: "0x0000000000401144", rsp: "0x00007fffffffe208", rbp: "0x00007fffffffe220" },
      instruction("0x0000000000401144", "push rbp", "55"),
      [row("0x00007fffffffe208", "0x000000000040117d")],
      ["rip", "rsp"],
    );

    const explanation = explainStep(previous, current, "step");
    expect(explanation.matched).toBe(true);
    expect(explanation.rule).toBe("call");
    expect(explanation.lines.join(" ")).toContain("返回地址");
  });

  it("explains ret using the measured stack qword", () => {
    const previous = snapshot(
      1,
      { rip: "0x0000000000401183", rsp: "0x00007fffffffe210", rbp: "0x00007fffffffe220" },
      instruction("0x0000000000401183", "ret", "c3"),
      [row("0x00007fffffffe210", "0x000000000040118d")],
    );
    const current = snapshot(
      2,
      { rip: "0x000000000040118d", rsp: "0x00007fffffffe218", rbp: "0x00007fffffffe220" },
      instruction("0x000000000040118d", "mov eax,0x0", "b800000000"),
      [],
      ["rip", "rsp"],
    );

    const explanation = explainStep(previous, current, "step_instruction");
    expect(explanation.matched).toBe(true);
    expect(explanation.rule).toBe("ret");
    expect(explanation.lines.join(" ")).toContain("返回地址");
  });

  it("explains leave without treating RBP as a fixed frame base", () => {
    const previous = snapshot(
      1,
      { rip: "0x0000000000401199", rsp: "0x00007fffffffe210", rbp: "0x00007fffffffe220" },
      instruction("0x0000000000401199", "leave", "c9"),
      [row("0x00007fffffffe220", "0x00007fffffffe240")],
    );
    const current = snapshot(
      2,
      { rip: "0x000000000040119a", rsp: "0x00007fffffffe228", rbp: "0x00007fffffffe240" },
      instruction("0x000000000040119a", "ret", "c3"),
      [],
      ["rip", "rsp", "rbp"],
    );

    const explanation = explainStep(previous, current, "step_instruction");
    expect(explanation.matched).toBe(true);
    expect(explanation.rule).toBe("leave");
    expect(explanation.lines.join(" ")).toContain("不假定");
  });

  it("explains pop using the measured stack qword and destination", () => {
    const previous = snapshot(
      1,
      { rip: "0x0000000000401152", rsp: "0x00007fffffffe210", rbp: "0x00007fffffffe220" },
      instruction("0x0000000000401152", "pop rbp", "5d"),
      [row("0x00007fffffffe210", "0x00007fffffffe260")],
    );
    const current = snapshot(
      2,
      { rip: "0x0000000000401153", rsp: "0x00007fffffffe218", rbp: "0x00007fffffffe260" },
      instruction("0x0000000000401153", "ret", "c3"),
      [],
      ["rip", "rsp", "rbp"],
    );

    const explanation = explainStep(previous, current, "step_instruction");
    expect(explanation.matched).toBe(true);
    expect(explanation.rule).toBe("pop");
    expect(explanation.lines.join(" ")).toContain("RBP");
  });

  it("explains add rsp and mov only from measured changes", () => {
    const previous = snapshot(
      1,
      { rip: "0x0000000000401160", rsp: "0x00007fffffffe210", rbp: "0x00007fffffffe220", rax: "0x1" },
      instruction("0x0000000000401160", "add rsp,0x10", "4883c410"),
      [],
    );
    const current = snapshot(
      2,
      { rip: "0x0000000000401164", rsp: "0x00007fffffffe220", rbp: "0x00007fffffffe220", rax: "0x1" },
      instruction("0x0000000000401164", "mov rax,rbx", "4889d8"),
      [],
      ["rip", "rsp"],
    );
    const addRsp = explainStep(previous, current, "step_instruction");
    expect(addRsp.matched).toBe(true);
    expect(addRsp.rule).toBe("add rsp");

    const movCurrent = snapshot(
      3,
      { rip: "0x0000000000401167", rsp: "0x00007fffffffe220", rbp: "0x00007fffffffe220", rax: "0x2", rbx: "0x2" },
      instruction("0x0000000000401167", "nop", "90"),
      [],
      ["rip", "rax"],
    );
    const mov = explainStep(current, movCurrent, "step_instruction");
    expect(mov.matched).toBe(true);
    expect(mov.rule).toBe("mov");
  });

  it("refuses to attribute a rule when an intermediate snapshot is missing", () => {
    const previous = snapshot(
      2,
      { rip: "0x0000000000401158", rsp: "0x00007fffffffe280", rbp: "0x00007fffffffe280" },
      instruction("0x0000000000401158", "push rbp", "55"),
      [],
    );
    const current = snapshot(
      4,
      { rip: "0x0000000000401160", rsp: "0x00007fffffffe270", rbp: "0x00007fffffffe280" },
      instruction("0x0000000000401160", "mov DWORD PTR [rbp-0xc],0xa", "c745f40a000000"),
      [],
      ["rip", "rsp"],
    );

    const explanation = explainStep(previous, current, "step_instruction");
    expect(explanation.matched).toBe(false);
    expect(explanation.headline).toContain("缺口");
  });

  it("does not guess for unknown instructions", () => {
    const previous = snapshot(
      1,
      { rip: "0x0000000000401190", rsp: "0x00007fffffffe280", rbp: "0x00007fffffffe280" },
      instruction("0x0000000000401190", "xor eax,eax", "31c0"),
      [],
    );
    const current = snapshot(
      2,
      { rip: "0x0000000000401192", rsp: "0x00007fffffffe280", rbp: "0x00007fffffffe280", rax: "0x0000000000000000" },
      instruction("0x0000000000401192", "nop", "90"),
      [],
      ["rip", "rax"],
    );

    const explanation = explainStep(previous, current, "step_instruction");
    expect(explanation.matched).toBe(false);
    expect(explanation.headline).toBe("已执行，请观察状态变化");
  });

  it("does not attribute a multi-instruction action to one instruction", () => {
    const previous = snapshot(1, { rip: "0x401190", rsp: "0x...", rbp: "0x..." }, null, []);
    const current = snapshot(2, { rip: "0x401200", rsp: "0x...", rbp: "0x..." }, null, []);
    const explanation = explainStep(previous, current, "finish");
    expect(explanation.matched).toBe(false);
    expect(explanation.headline).toContain("多条指令");
  });
});
