import { useExecutionLogs } from "@/hooks/useExecutionLogs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Eye } from "lucide-react";

const Logs = () => {
  const { data: logs, isLoading } = useExecutionLogs();

  return (
    <div className="p-6 lg:p-10 space-y-6 max-w-[1400px]">
      <div>
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Логи</h1>
        <p className="text-sm text-muted-foreground mt-1">Подробные логи выполнения операций</p>
      </div>

      <div className="glass-card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>Время</th>
              <th>Действие</th>
              <th>Шаг</th>
              <th>Результат</th>
              <th>Ошибка</th>
              <th className="w-12"></th>
            </tr>
          </thead>
          <tbody>
            {logs?.map((log) => (
              <tr key={log.id}>
                <td className="font-mono text-xs text-muted-foreground">
                  {new Date(log.created_at).toLocaleString()}
                </td>
                <td className="text-xs font-mono">{log.action}</td>
                <td className="text-xs text-muted-foreground">{log.step || "—"}</td>
                <td>
                  <span className={`inline-flex items-center gap-2 text-xs font-mono ${
                    log.success ? "text-primary" : "text-destructive"
                  }`}>
                    <span className={log.success ? "status-dot-success" : "status-dot-error"} />
                    {log.success ? "OK" : "FAIL"}
                  </span>
                </td>
                <td className="text-xs text-destructive truncate max-w-[250px]">
                  {log.error_message || "—"}
                </td>
                <td>
                  <Dialog>
                    <DialogTrigger asChild>
                      <button className="p-1.5 rounded-lg hover:bg-accent transition-colors text-muted-foreground hover:text-foreground">
                        <Eye className="w-4 h-4" />
                      </button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl bg-card border-border">
                      <DialogHeader>
                        <DialogTitle className="font-mono text-sm">{log.action} — {log.step}</DialogTitle>
                      </DialogHeader>
                      <ScrollArea className="max-h-[60vh]">
                        <div className="space-y-4 text-sm">
                          <div>
                            <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1.5">Request</p>
                            <pre className="bg-background rounded-lg p-4 text-xs font-mono overflow-auto text-foreground border border-border/40">
                              {log.request_data ? JSON.stringify(log.request_data, null, 2) : "—"}
                            </pre>
                          </div>
                          <div>
                            <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1.5">Response</p>
                            <pre className="bg-background rounded-lg p-4 text-xs font-mono overflow-auto text-foreground border border-border/40">
                              {log.response_data ? JSON.stringify(log.response_data, null, 2) : "—"}
                            </pre>
                          </div>
                          {log.error_message && (
                            <div>
                              <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1.5">Ошибка</p>
                              <p className="text-destructive text-sm">{log.error_message}</p>
                            </div>
                          )}
                        </div>
                      </ScrollArea>
                    </DialogContent>
                  </Dialog>
                </td>
              </tr>
            ))}
            {isLoading && (
              <tr>
                <td colSpan={6} className="text-center text-muted-foreground py-12">Загрузка...</td>
              </tr>
            )}
            {!isLoading && (!logs || logs.length === 0) && (
              <tr>
                <td colSpan={6} className="text-center text-muted-foreground py-12">
                  Нет логов.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Logs;
