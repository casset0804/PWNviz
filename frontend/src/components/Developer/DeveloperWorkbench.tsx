import { useTranslation } from "react-i18next";

import type { Capabilities, SampleInfo } from "../../types/api";
import { useDebugStore } from "../../stores/debugStore";
import { BottomDock } from "../BottomDock/BottomDock";
import { PanelRail } from "../common/PanelRail";
import { DisassemblyView } from "../DisassemblyView/DisassemblyView";
import { RegisterPanel } from "../RegisterPanel/RegisterPanel";
import { StackMemoryView } from "../StackMemoryView/StackMemoryView";

interface DeveloperWorkbenchProps {
  capabilities: Capabilities | null;
  samples: SampleInfo[];
  error: string | null;
  loading: boolean;
  verifying: boolean;
  onRefresh: () => void;
  onVerifyPwndbg: () => void;
}

/**
 * Developer mode keeps the original IDE surface: full disassembly, the raw
 * byte-table stack view, every register and the inspector dock. It shares the
 * exact same store as presentation mode.
 */
export function DeveloperWorkbench({
  capabilities,
  samples,
  error,
  loading,
  verifying,
  onRefresh,
  onVerifyPwndbg,
}: DeveloperWorkbenchProps) {
  const { t } = useTranslation(["panels"]);
  const leftPanelCollapsed = useDebugStore((state) => state.leftPanelCollapsed);
  const rightPanelCollapsed = useDebugStore((state) => state.rightPanelCollapsed);
  const toggleLeftPanel = useDebugStore((state) => state.toggleLeftPanel);
  const toggleRightPanel = useDebugStore((state) => state.toggleRightPanel);

  return (
    <div className="developer-chrome flex min-h-0 flex-1 flex-col" data-testid="developer-workbench">
      <main
        className={`debug-layout min-h-0 flex-1 ${
          leftPanelCollapsed ? "left-collapsed" : ""
        } ${rightPanelCollapsed ? "right-collapsed" : ""}`}
      >
        {leftPanelCollapsed ? (
          <PanelRail
            label={t("panels:disassembly.title")}
            side="left"
            onExpand={toggleLeftPanel}
          />
        ) : (
          <DisassemblyView onCollapse={toggleLeftPanel} />
        )}
        <StackMemoryView />
        {rightPanelCollapsed ? (
          <PanelRail
            label={t("panels:registers.title")}
            side="right"
            onExpand={toggleRightPanel}
          />
        ) : (
          <RegisterPanel onCollapse={toggleRightPanel} />
        )}
      </main>

      <BottomDock
        capabilities={capabilities}
        samples={samples}
        error={error}
        loading={loading}
        verifying={verifying}
        onRefresh={onRefresh}
        onVerifyPwndbg={onVerifyPwndbg}
      />
    </div>
  );
}
