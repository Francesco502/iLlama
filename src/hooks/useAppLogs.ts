import { useCallback, useState } from "react";
import type { LogEntry } from "../types/domain";

function formatLogTime(d: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(d);
}

export function useAppLogs(initial: LogEntry[]) {
  const [logs, setLogs] = useState<LogEntry[]>(initial);

  const appendSystemLog = useCallback((message: string) => {
    const timestamp = formatLogTime(new Date());
    setLogs((current) =>
      [
        ...current,
        {
          id: crypto.randomUUID(),
          timestamp,
          stream: "system" as const,
          message,
        },
      ].slice(-80),
    );
  }, []);

  const mergeLogs = useCallback((incoming: LogEntry[]) => {
    setLogs((current) => {
      const byId = new Map<string, LogEntry>();
      for (const log of current) byId.set(log.id, log);
      for (const log of incoming) byId.set(log.id, log);
      return Array.from(byId.values()).slice(-120);
    });
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  return { logs, setLogs, appendSystemLog, mergeLogs, clearLogs };
}
