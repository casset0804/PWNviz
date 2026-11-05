import { CoreRegisters } from "../RegisterPanel/CoreRegisters";
import { SourceDisassemblyPanel } from "../SourcePanel/SourceDisassemblyPanel";
import { StackMapCanvas } from "../StackMap/StackMapCanvas";
import { StepTeachingPanel } from "./StepTeachingPanel";

/**
 * Presentation mode: stack map first.
 *
 * At 1920×1080 the frame map gets roughly two thirds of the three-column
 * workspace; source/disassembly is deliberately narrower and the right column
 * only carries RIP/RSP/RBP/RAX (the rest stays folded). The bottom teaching
 * strip is capped so the stack map keeps the largest share of the screen.
 */
export function PresentationWorkbench() {
  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2.5 xl:overflow-hidden"
      data-testid="presentation-workbench"
    >
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 xl:grid-cols-[minmax(220px,0.62fr)_minmax(0,3.1fr)_minmax(250px,0.8fr)] xl:overflow-hidden">
        <div className="h-full min-h-[300px] xl:min-h-0">
          <SourceDisassemblyPanel defaultTab="source" />
        </div>
        <div className="h-full min-h-[440px] xl:min-h-0">
          <StackMapCanvas />
        </div>
        <div className="h-full min-h-[300px] xl:min-h-0">
          <CoreRegisters />
        </div>
      </div>
      <StepTeachingPanel />
    </div>
  );
}
