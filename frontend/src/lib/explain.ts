import { formatAddress, normalizeAddress, parseAddress, signedHexDelta } from "./address";
import type { ActionName, Snapshot } from "../types/debug";

export interface StepExplanation {
  headline: string;
  rule: string | null;
  matched: boolean;
  lines: string[];
  facts: string[];
}

const SINGLE_STEP_ACTIONS = new Set<ActionName>([
  "step_instruction",
  "next_instruction",
  "step",
]);

function delta(after: string | null, before: string | null): bigint | null {
  const next = parseAddress(after);
  const previous = parseAddress(before);
  return next !== null && previous !== null ? next - previous : null;
}

/** Read an 8-byte little-endian value from a snapshot, even across rows. */
function readQword(snapshot: Snapshot, address: string | null): string | null {
  const target = parseAddress(address);
  if (target === null) return null;
  let value = 0n;
  for (let index = 0; index < 8; index += 1) {
    let found: string | null | undefined;
    for (const row of snapshot.stack.rows) {
      const rowStart = parseAddress(row.address);
      if (rowStart === null) continue;
      const offset = target + BigInt(index) - rowStart;
      if (offset >= 0n && offset < 8n) {
        found = row.bytes[Number(offset)];
        break;
      }
    }
    if (found === null || found === undefined) return null;
    value |= BigInt(parseInt(found, 16)) << BigInt(index * 8);
  }
  return formatAddress(value);
}

function parseImmediate(text: string | null | undefined): bigint | null {
  if (!text) return null;
  const cleaned = text.trim().replace(/^#/, "");
  if (/^-?0x[0-9a-f]+$/i.test(cleaned)) {
    try {
      return BigInt(cleaned);
    } catch {
      return null;
    }
  }
  if (/^-?\d+$/.test(cleaned)) {
    try {
      return BigInt(cleaned);
    } catch {
      return null;
    }
  }
  return null;
}

function operandList(operands: string | null): string[] {
  if (!operands) return [];
  return operands.split(",").map((part) => part.trim());
}

function baseFacts(previous: Snapshot | null, current: Snapshot | null): string[] {
  if (!previous || !current) return [];
  const changedRegisters = current.diff.changed_registers;
  return [
    `RIP ${previous.registers.rip ?? "—"} → ${current.registers.rip ?? "—"}`,
    `RSP ${previous.registers.rsp ?? "—"} → ${current.registers.rsp ?? "—"} (${signedHexDelta(
      current.registers.rsp,
      previous.registers.rsp,
    ) ?? "n/a"})`,
    `RBP ${previous.registers.rbp ?? "—"} → ${current.registers.rbp ?? "—"} (${signedHexDelta(
      current.registers.rbp,
      previous.registers.rbp,
    ) ?? "n/a"})`,
    `changed registers: ${changedRegisters.length ? changedRegisters.join(", ") : "none"}`,
    `changed bytes: ${current.diff.changed_bytes.length}`,
  ];
}

function generic(
  headline = "已执行，请观察状态变化",
  lines: string[] = [],
  previous: Snapshot | null = null,
  current: Snapshot | null = null,
): StepExplanation {
  return {
    headline,
    rule: null,
    matched: false,
    lines,
    facts: baseFacts(previous, current),
  };
}

export function explainStep(
  previous: Snapshot | null,
  current: Snapshot | null,
  lastAction: ActionName | null,
): StepExplanation {
  if (!previous || !current) {
    return generic("等待单步执行", ["执行一条指令后，这里会给出基于 before/after 快照的教学解释。"]);
  }

  // A slow WebSocket subscriber can miss intermediate events. Never attribute a
  // multi-snapshot delta to the last instruction in that case.
  if (current.diff.previous_snapshot_id !== previous.snapshot_id) {
    return generic(
      "快照之间有缺口，无法归因于单条指令",
      [
        "当前快照的 previous_snapshot_id 与本地保存的上一张快照不一致。",
        "只展示实测差异；等待连续快照后再解释具体指令。",
      ],
      previous,
      current,
    );
  }

  const instruction = previous.instruction;
  const mnemonic = instruction?.mnemonic?.toLowerCase() ?? null;
  const operands = instruction?.operands ?? "";
  const currentRip = normalizeAddress(current.registers.rip);
  const previousRsp = normalizeAddress(previous.registers.rsp);
  const currentRsp = normalizeAddress(current.registers.rsp);
  const previousRbp = normalizeAddress(previous.registers.rbp);
  const currentRbp = normalizeAddress(current.registers.rbp);
  const rspDelta = delta(currentRsp, previousRsp);
  const expectedNext =
    instruction && instruction.bytes
      ? (() => {
          const start = parseAddress(instruction.address);
          const length = instruction.bytes.length / 2;
          return start !== null && length > 0
            ? formatAddress(start + BigInt(length))
            : null;
        })()
      : null;

  if (!lastAction || !SINGLE_STEP_ACTIONS.has(lastAction)) {
    return generic(
      "该动作可能执行了多条指令，只展示测量差异",
      ["Finish/Continue/launch 不是单条指令，不能把 before/after 差异归因给某一条指令。"],
      previous,
      current,
    );
  }
  if (!instruction || !mnemonic) {
    return generic("已执行，请观察状态变化", ["快照没有提供可解释的当前指令。"], previous, current);
  }

  if (mnemonic === "push") {
    const source = operandList(operands)[0] ?? "";
    const newQword = readQword(current, currentRsp);
    const sourceRegister = source.replace(/^\$/, "").toLowerCase();
    const sourceBefore = sourceRegister in previous.registers
      ? previous.registers[sourceRegister]
      : null;
    if (rspDelta === -8n) {
      const lines = ["RSP 减少 8 字节，栈向低地址增长。"];
      if (newQword) lines.push(`新 RSP 处的 8 字节为 ${newQword}。`);
      if (sourceBefore && newQword && sourceBefore === newQword) {
        lines.push(`该值等于 push 前的 ${sourceRegister.toUpperCase()}（${sourceBefore}）。`);
      }
      return { headline: "push：RSP 下移 8 字节", rule: "push", matched: true, lines, facts: baseFacts(previous, current) };
    }
    return generic("已执行，请观察状态变化", [`push 的 RSP 实测量变化为 ${rspDelta ?? "n/a"}，不是预期的 -8。`], previous, current);
  }

  if (mnemonic === "pop") {
    const destination = operandList(operands)[0]?.replace(/^\$/, "").toLowerCase() ?? "";
    const oldQword = readQword(previous, previousRsp);
    const destinationAfter = destination in current.registers ? current.registers[destination] : null;
    if (rspDelta === 8n) {
      const lines = ["RSP 增加 8 字节。"];
      if (oldQword) lines.push(`弹出前 RSP 处的 8 字节为 ${oldQword}。`);
      if (oldQword && destinationAfter && oldQword === destinationAfter) {
        lines.push(`该值实测写入了 ${destination.toUpperCase()}（${destinationAfter}）。`);
      }
      return { headline: "pop：RSP 上移 8 字节", rule: "pop", matched: true, lines, facts: baseFacts(previous, current) };
    }
    return generic("已执行，请观察状态变化", [`pop 的 RSP 实测量变化为 ${rspDelta ?? "n/a"}，不是预期的 +8。`], previous, current);
  }

  if (mnemonic === "mov") {
    const destination = operandList(operands)[0] ?? "";
    const destRegister = destination.replace(/^\$/, "").toLowerCase();
    const before = destRegister in previous.registers ? previous.registers[destRegister] : null;
    const after = destRegister in current.registers ? current.registers[destRegister] : null;
    const lines: string[] = [];
    if (before !== null || after !== null) {
      lines.push(`目标寄存器 ${destRegister.toUpperCase()}：${before ?? "—"} → ${after ?? "—"}。`);
    }
    lines.push(
      `本快照窗口内实测 ${current.diff.changed_bytes.length} 个字节变化。`,
    );
    return { headline: "mov：按实测寄存器/内存变化观察", rule: "mov", matched: true, lines, facts: baseFacts(previous, current) };
  }

  if (
    (mnemonic === "sub" || mnemonic === "add") &&
    operandList(operands)[0]?.replace(/^\$/, "").toLowerCase() === "rsp"
  ) {
    const immediate = parseImmediate(operandList(operands)[1]);
    const expectedDelta = immediate === null ? null : mnemonic === "sub" ? -immediate : immediate;
    if (expectedDelta !== null && rspDelta === expectedDelta) {
      return {
        headline: `${mnemonic} rsp：栈指针按立即数移动`,
        rule: `${mnemonic} rsp`,
        matched: true,
        lines: [
          `RSP 变化 ${signedHexDelta(currentRsp, previousRsp) ?? "n/a"}，与指令中的立即数一致。`,
          "这是 RSP 算术结果，不表示 RSP 与 RBP 之间的空间都属于局部变量。",
        ],
        facts: baseFacts(previous, current),
      };
    }
    return generic("已执行，请观察状态变化", ["RSP 变化与指令中的立即数不一致，未套用栈帧语义。"], previous, current);
  }

  if (mnemonic === "call") {
    const target = operandList(operands)[0] || "unknown target";
    const returnAddress = readQword(current, currentRsp);
    if (rspDelta === -8n) {
      const lines = [`RSP 减少 8 字节；RIP 跳转到 ${target}。`];
      if (returnAddress && expectedNext && returnAddress === expectedNext) {
        lines.push(`[RSP] 实测为 ${returnAddress}，等于 call 的下一条指令地址，即返回地址。`);
      } else if (returnAddress) {
        lines.push(`[RSP] 实测为 ${returnAddress}；未确认它就是返回地址。`);
      }
      return { headline: "call：压入返回地址并跳转", rule: "call", matched: true, lines, facts: baseFacts(previous, current) };
    }
    return generic("已执行，请观察状态变化", [`call 的 RSP 实测量变化为 ${rspDelta ?? "n/a"}，不是预期的 -8。`], previous, current);
  }

  if (mnemonic === "ret") {
    const returnAddress = readQword(previous, previousRsp);
    if (rspDelta === 8n) {
      const lines = ["RSP 增加 8 字节。"];
      if (returnAddress) {
        lines.push(`从旧 RSP 读出的 8 字节为 ${returnAddress}。`);
        if (currentRip && returnAddress === currentRip) {
          lines.push(`该值等于新的 RIP，实测为返回地址。`);
        }
      }
      return { headline: "ret：从栈顶取返回地址", rule: "ret", matched: true, lines, facts: baseFacts(previous, current) };
    }
    return generic("已执行，请观察状态变化", [`ret 的 RSP 实测量变化为 ${rspDelta ?? "n/a"}，不是预期的 +8。`], previous, current);
  }

  if (mnemonic === "leave") {
    const frameQword = readQword(previous, previousRbp);
    const oldRbpValue = parseAddress(previousRbp);
    const expectedRsp = oldRbpValue !== null ? formatAddress(oldRbpValue + 8n) : null;
    if (expectedRsp && currentRsp === expectedRsp) {
      const lines = [
        "RSP 被设置为旧 RBP 后再增加 8 字节（等价于 mov rsp,rbp; pop rbp）。",
      ];
      if (frameQword && currentRbp === frameQword) {
        lines.push(`RBP 实测恢复为 [旧 RBP] = ${frameQword}。`);
      }
      lines.push("这里只陈述实际寄存器变化，不假定旧 RBP 一定是某个固定栈帧的栈底。");
      return { headline: "leave：恢复 RSP/RBP", rule: "leave", matched: true, lines, facts: baseFacts(previous, current) };
    }
    return generic("已执行，请观察状态变化", ["实测 RSP/RBP 变化与 leave 的常见形态不一致。"], previous, current);
  }

  if (mnemonic === "nop") {
    const nonRipRegisterChanges = current.diff.changed_registers.filter(
      (name) => name !== "rip",
    );
    const noRegisterChange = nonRipRegisterChanges.length === 0;
    const noByteChange = current.diff.changed_bytes.length === 0;
    if (noRegisterChange && noByteChange) {
      return {
        headline: "nop：未改变可见状态",
        rule: "nop",
        matched: true,
        lines: [
          "没有寄存器变化，快照窗口内也没有字节变化。",
          expectedNext && currentRip === expectedNext
            ? `RIP 前进了 ${instruction.bytes ? instruction.bytes.length / 2 : "?"} 字节。`
            : "RIP 变化未与顺序执行直接对上，请结合 disassembly 观察。",
        ],
        facts: baseFacts(previous, current),
      };
    }
    return generic("已执行，请观察状态变化", ["nop 却观测到寄存器或内存变化，未套用 nop 语义。"], previous, current);
  }

  return generic(
    "已执行，请观察状态变化",
    [`暂不为 ${mnemonic} 生成语义解释；请结合寄存器、栈与 diff 观察。`],
    previous,
    current,
  );
}
