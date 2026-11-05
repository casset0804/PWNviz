import { CoreRegisters } from "../RegisterPanel/CoreRegisters";
import { SourceDisassemblyPanel } from "../SourcePanel/SourceDisassemblyPanel";
import { StackMapCanvas } from "../StackMap/StackMapCanvas";
import { StepTeachingPanel } from "./StepTeachingPanel";

/**
 * Presentation mode: stack map first.
 *
 * The frame map gets the largest column (roughly 60% of the three-column
 * workspace at 1920×1080). Source/disassembly is deliberately smaller; the
 * bottom strip is the only other persistent information surface.
 */
export function PresentationWorkbench() {
  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2.5 xl:overflow-hidden"
      data-testid="presentation-workbench"
    >
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 xl:grid-cols-[minmax(250px,0.84fr)_minmax(0,2.55fr)_minmax(268px,0.88fr)] xl:overflow-hidden">
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
