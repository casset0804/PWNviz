import { formatAddress, normalizeAddress, parseAddress, signedHexDelta } from "./address";
import zhExplanation from "../i18n/locales/zh-CN/explanation.json";
import type { ActionName, Snapshot } from "../types/debug";

export interface StepExplanation {
  headline: string;
  rule: string | null;
  matched: boolean;
  lines: string[];
  facts: string[];
}

/** Minimal translate function shape shared by i18next and the zh fallback. */
export type Translate = (
  key: string,
  params?: Record<string, unknown>,
) => string;

function lookup(resource: unknown, path: string): string | undefined {
  let cursor: unknown = resource;
  for (const part of path.split(".")) {
    if (typeof cursor !== "object" || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return typeof cursor === "string" ? cursor : undefined;
}

/**
 * Build a translator from a locale resource object. Used by the zh-CN default so
 * `explainStep` keeps returning Simplified Chinese when it is called outside a
 * React component (unit tests, logs) without duplicating any string.
 */
export function createTranslator(resource: unknown): Translate {
  return (key, params) => {
    const template = lookup(resource, key) ?? key;
    if (!params) return template;
    return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, name: string) =>
      String(params[name] ?? ""),
    );
  };
}

export const defaultExplainTranslate = createTranslator(zhExplanation);

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

function baseFacts(
  previous: Snapshot | null,
  current: Snapshot | null,
  t: Translate,
): string[] {
  if (!previous || !current) return [];
  const changedRegisters = current.diff.changed_registers;
  const na = t("facts.notAvailable");
  return [
    t("facts.rip", {
      from: previous.registers.rip ?? "—",
      to: current.registers.rip ?? "—",
    }),
    t("facts.rsp", {
      from: previous.registers.rsp ?? "—",
      to: current.registers.rsp ?? "—",
      delta: signedHexDelta(current.registers.rsp, previous.registers.rsp) ?? na,
    }),
    t("facts.rbp", {
      from: previous.registers.rbp ?? "—",
      to: current.registers.rbp ?? "—",
      delta: signedHexDelta(current.registers.rbp, previous.registers.rbp) ?? na,
    }),
    t("facts.changedRegisters", {
      list: changedRegisters.length ? changedRegisters.join(", ") : t("facts.none"),
    }),
    t("facts.changedBytes", { count: current.diff.changed_bytes.length }),
  ];
}

function generic(
  t: Translate,
  headline: string,
  lines: string[] = [],
  previous: Snapshot | null = null,
  current: Snapshot | null = null,
): StepExplanation {
  return {
    headline,
    rule: null,
    matched: false,
    lines,
    facts: baseFacts(previous, current, t),
  };
}

export function explainStep(
  previous: Snapshot | null,
  current: Snapshot | null,
  lastAction: ActionName | null,
  t: Translate = defaultExplainTranslate,
): StepExplanation {
  const executed = t("headline.executed");
  if (!previous || !current) {
    return generic(t, t("headline.waiting"), [t("lines.waiting")]);
  }

  // A slow WebSocket subscriber can miss intermediate events. Never attribute a
  // multi-snapshot delta to the last instruction in that case.
  if (current.diff.previous_snapshot_id !== previous.snapshot_id) {
    return generic(
      t,
      t("headline.gap"),
      [t("lines.gap1"), t("lines.gap2")],
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
  const facts = () => baseFacts(previous, current, t);

  if (!lastAction || !SINGLE_STEP_ACTIONS.has(lastAction)) {
    return generic(
      t,
      t("headline.multi"),
      [t("lines.multi1")],
      previous,
      current,
    );
  }
  if (!instruction || !mnemonic) {
    return generic(t, executed, [t("lines.noInstruction")], previous, current);
  }

  if (mnemonic === "push") {
    const source = operandList(operands)[0] ?? "";
    const newQword = readQword(current, currentRsp);
    const sourceRegister = source.replace(/^\$/, "").toLowerCase();
    const sourceBefore =
      sourceRegister in previous.registers
        ? previous.registers[sourceRegister]
        : null;
    if (rspDelta === -8n) {
      const lines = [t("lines.pushDecreased")];
      if (newQword) lines.push(t("lines.pushNewQword", { value: newQword }));
      if (sourceBefore && newQword && sourceBefore === newQword) {
        lines.push(
          t("lines.pushMatchesSource", {
            register: sourceRegister.toUpperCase(),
            value: sourceBefore,
          }),
        );
        // Teaching sentence, only after the pushed qword was measured equal to
        // the register it came from. It never claims a frame layout.
        lines.push(
          t("lines.pushSavedRegister", {
            register: sourceRegister.toUpperCase(),
          }),
        );
      }
      return {
        headline: t("headline.push"),
        rule: "push",
        matched: true,
        lines,
        facts: facts(),
      };
    }
    return generic(
      t,
      executed,
      [t("lines.pushUnexpected", { delta: rspDelta ?? t("facts.notAvailable") })],
      previous,
      current,
    );
  }

  if (mnemonic === "pop") {
    const destination =
      operandList(operands)[0]?.replace(/^\$/, "").toLowerCase() ?? "";
    const oldQword = readQword(previous, previousRsp);
    const destinationAfter =
      destination in current.registers ? current.registers[destination] : null;
    if (rspDelta === 8n) {
      const lines = [t("lines.popIncreased")];
      if (oldQword) lines.push(t("lines.popOldQword", { value: oldQword }));
      if (oldQword && destinationAfter && oldQword === destinationAfter) {
        lines.push(
          t("lines.popWroteDestination", {
            register: destination.toUpperCase(),
            value: destinationAfter,
          }),
        );
      }
      return {
        headline: t("headline.pop"),
        rule: "pop",
        matched: true,
        lines,
        facts: facts(),
      };
    }
    return generic(
      t,
      executed,
      [t("lines.popUnexpected", { delta: rspDelta ?? t("facts.notAvailable") })],
      previous,
      current,
    );
  }

  if (mnemonic === "mov") {
    const destination = operandList(operands)[0] ?? "";
    const destRegister = destination.replace(/^\$/, "").toLowerCase();
    const sourceOperand = operandList(operands)[1] ?? "";
    const sourceRegister = sourceOperand.replace(/^\$/, "").trim().toLowerCase();
    const before =
      destRegister in previous.registers ? previous.registers[destRegister] : null;
    const after =
      destRegister in current.registers ? current.registers[destRegister] : null;
    const lines: string[] = [];
    if (before !== null || after !== null) {
      lines.push(
        t("lines.movRegister", {
          register: destRegister.toUpperCase(),
          before: before ?? "—",
          after: after ?? "—",
        }),
      );
    }
    // `mov rbp, rsp` is the common frame-base setup. Only call it a frame base
    // when the measured new RBP really equals the previous RSP.
    if (
      destRegister === "rbp" &&
      sourceRegister === "rsp" &&
      after !== null &&
      previousRsp !== null &&
      after === previousRsp
    ) {
      lines.push(t("lines.movFrameBase", { value: after }));
    }
    lines.push(t("lines.movBytes", { count: current.diff.changed_bytes.length }));
    return {
      headline: t("headline.mov"),
      rule: "mov",
      matched: true,
      lines,
      facts: facts(),
    };
  }

  if (
    (mnemonic === "sub" || mnemonic === "add") &&
    operandList(operands)[0]?.replace(/^\$/, "").toLowerCase() === "rsp"
  ) {
    const immediate = parseImmediate(operandList(operands)[1]);
    const expectedDelta =
      immediate === null ? null : mnemonic === "sub" ? -immediate : immediate;
    if (expectedDelta !== null && rspDelta === expectedDelta) {
      const lines = [
        t("lines.stackPointerDelta", {
          delta: signedHexDelta(currentRsp, previousRsp) ?? t("facts.notAvailable"),
        }),
      ];
      // The immediate matched the measured RSP delta, so the reserved/released
      // byte count is measured, not assumed. It still does not claim that the
      // whole RSP..RBP gap is one variable.
      if (immediate !== null) {
        lines.push(
          t(mnemonic === "sub" ? "lines.stackPointerReserved" : "lines.stackPointerReleased", {
            bytes: immediate.toString(),
          }),
        );
      }
      lines.push(t("lines.stackPointerNoFrame"));
      return {
        headline: t("headline.stackPointer", { mnemonic }),
        rule: `${mnemonic} rsp`,
        matched: true,
        lines,
        facts: facts(),
      };
    }
    return generic(
      t,
      executed,
      [t("lines.stackPointerMismatch")],
      previous,
      current,
    );
  }

  if (mnemonic === "call") {
    const target = operandList(operands)[0] || "unknown target";
    const returnAddress = readQword(current, currentRsp);
    if (rspDelta === -8n) {
      const lines = [t("lines.callJumped", { target })];
      if (returnAddress && expectedNext && returnAddress === expectedNext) {
        lines.push(t("lines.callReturnConfirmed", { value: returnAddress }));
      } else if (returnAddress) {
        lines.push(t("lines.callReturnUnconfirmed", { value: returnAddress }));
      }
      return {
        headline: t("headline.call"),
        rule: "call",
        matched: true,
        lines,
        facts: facts(),
      };
    }
    return generic(
      t,
      executed,
      [t("lines.callUnexpected", { delta: rspDelta ?? t("facts.notAvailable") })],
      previous,
      current,
    );
  }

  if (mnemonic === "ret") {
    const returnAddress = readQword(previous, previousRsp);
    if (rspDelta === 8n) {
      const lines = [t("lines.retIncreased")];
      if (returnAddress) {
        lines.push(t("lines.retOldQword", { value: returnAddress }));
        if (currentRip && returnAddress === currentRip) {
          lines.push(t("lines.retConfirmed"));
        }
      }
      return {
        headline: t("headline.ret"),
        rule: "ret",
        matched: true,
        lines,
        facts: facts(),
      };
    }
    return generic(
      t,
      executed,
      [t("lines.retUnexpected", { delta: rspDelta ?? t("facts.notAvailable") })],
      previous,
      current,
    );
  }

  if (mnemonic === "leave") {
    const frameQword = readQword(previous, previousRbp);
    const oldRbpValue = parseAddress(previousRbp);
    const expectedRsp =
      oldRbpValue !== null ? formatAddress(oldRbpValue + 8n) : null;
    if (expectedRsp && currentRsp === expectedRsp) {
      const lines = [t("lines.leaveMechanism")];
      if (frameQword && currentRbp === frameQword) {
        lines.push(t("lines.leaveRestored", { value: frameQword }));
      }
      lines.push(t("lines.leaveNoFrameBase"));
      return {
        headline: t("headline.leave"),
        rule: "leave",
        matched: true,
        lines,
        facts: facts(),
      };
    }
    return generic(t, executed, [t("lines.leaveUnexpected")], previous, current);
  }

  if (mnemonic === "nop") {
    const nonRipRegisterChanges = current.diff.changed_registers.filter(
      (name) => name !== "rip",
    );
    const noRegisterChange = nonRipRegisterChanges.length === 0;
    const noByteChange = current.diff.changed_bytes.length === 0;
    if (noRegisterChange && noByteChange) {
      return {
        headline: t("headline.nop"),
        rule: "nop",
        matched: true,
        lines: [
          t("lines.nopQuiet"),
          expectedNext && currentRip === expectedNext
            ? t("lines.nopRipAdvanced", {
                count: instruction.bytes ? instruction.bytes.length / 2 : "?",
              })
            : t("lines.nopRipUnclear"),
        ],
        facts: facts(),
      };
    }
    return generic(t, executed, [t("lines.nopUnexpected")], previous, current);
  }

  return generic(
    t,
    executed,
    [t("lines.unknownMnemonic", { mnemonic })],
    previous,
    current,
  );
}
