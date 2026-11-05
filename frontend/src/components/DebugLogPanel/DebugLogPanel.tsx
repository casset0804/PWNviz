import { useTranslation } from "react-i18next";

import { useDebugStore, type LogLevel } from "../../stores/debugStore";
import { StatusBadge } from "../common/StatusBadge";

const LEVEL_KEYS: Record<LogLevel, string> = {
  info: "panels:log.levelInfo",
  event: "panels:log.levelEvent",
  error: "panels:log.levelError",
  gdb: "panels:log.levelGdb",
};

export function DebugLogPanel() {
  const { t } = useTranslation(["panels", "common"]);
  const log = useDebugStore((state) => state.log);
  const session = useDebugStore((state) => state.session);
  const streamStatus = useDebugStore((state) => state.streamStatus);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-[#1e2635] px-3 py-1.5">
        <StatusBadge tone={streamStatus === "open" ? "ok" : "idle"}>
          {streamStatus}
        </StatusBadge>
        <span className="font-mono text-[10px] text-slate-600">
          {session ? session.session_id : t("panels:log.noSession")}
        </span>
        <span className="ml-auto font-mono text-[10px] text-slate-600">
          {t("panels:log.entries", { count: log.length })}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2" data-testid="debug-log-panel">
        {log.length === 0 ? (
          <p className="p-2 font-mono text-[10px] text-slate-600">
            {t("panels:log.empty")}
          </p>
        ) : (
          <ul className="space-y-0.5 font-mono text-[10px]">
            {log
              .slice()
              .reverse()
              .map((entry) => (
                <li
                  key={entry.id}
                  data-testid="debug-log-entry"
                  data-level={entry.level}
                  className="flex gap-2 px-1 py-0.5"
                >
                  <span className="w-20 shrink-0 text-slate-700">{entry.at.slice(11, 19)}</span>
                  <span
                    className={`w-14 shrink-0 ${
                      entry.level === "error"
                        ? "text-rose-300"
                        : entry.level === "event"
                          ? "text-cyan-300"
                          : entry.level === "gdb"
                            ? "text-emerald-300/80"
                            : "text-slate-600"
                    }`}
                  >
                    {t(LEVEL_KEYS[entry.level])}
                  </span>
                  <span className="min-w-0 break-all text-slate-400">{entry.message}</span>
                </li>
              ))}
          </ul>
        )}
      </div>
    </div>
  );
}
