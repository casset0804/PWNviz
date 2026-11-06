import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { CoreRegisters } from "../RegisterPanel/CoreRegisters";
import { SourceDisassemblyPanel } from "../SourcePanel/SourceDisassemblyPanel";
import { StackMapCanvas } from "../StackMap/StackMapCanvas";
import { InspectorDrawer } from "./InspectorDrawer";

function useMinWidth(px: number): boolean {
  const [wide, setWide] = useState(() =>
    typeof window === "undefined" ? true : window.innerWidth >= px,
  );
  useEffect(() => {
    const query = window.matchMedia(`(min-width: ${px}px)`);
    const update = () => setWide(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [px]);
  return wide;
}

/**
 * Presentation workbench (V1.4): stack-centric three-column layout.
 *
 * At 1920×1080: source/disassembly 26 % (readable addresses, bytes, mnemonics,
 * operands), the stack-map work area 56 % (a centered, fixed-width memory
 * spine — the largest visual region by far), core registers 18 %. There is no
 * permanent bottom panel anymore: the teaching headline lives in
 * CurrentInstruction, and every detail surface moved into the Inspector
 * Drawer that slides over the right column when a memory block is selected.
 * On narrow screens the register column folds into a collapsed panel.
 */
export function PresentationWorkbench() {
  const { t } = useTranslation(["panels", "common"]);
  const wide = useMinWidth(1280);

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2.5 xl:grid xl:grid-cols-[minmax(340px,26fr)_minmax(620px,56fr)_minmax(260px,18fr)] xl:overflow-hidden"
      data-testid="presentation-workbench"
    >
      <div className="min-h-[300px] xl:h-full xl:min-h-0">
        <SourceDisassemblyPanel defaultTab="source" />
      </div>
      <div className="min-h-[440px] xl:h-full xl:min-h-0">
        <StackMapCanvas />
      </div>
      {wide ? (
        <div className="min-h-[300px] xl:h-full xl:min-h-0">
          <CoreRegisters />
        </div>
      ) : (
        <details className="shrink-0 rounded-lg border border-[#1b2a3a] bg-[#080f17]">
          <summary className="cursor-pointer list-none px-4 py-2.5 text-[14px] font-medium text-[#9fb2c6]">
            {t("panels:registers.coreTitle")}
          </summary>
          <div className="max-h-[50vh] overflow-auto p-2">
            <CoreRegisters />
          </div>
        </details>
      )}
      <InspectorDrawer />
    </div>
  );
}
