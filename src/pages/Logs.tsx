import { useExecutionLogs } from "@/hooks/useExecutionLogs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Eye } from "lucide-react";

const Logs = () => {
  const { data: logs, isLoading } = useExecutionLogs();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-foreground tracking-tight">Логи</h1>
        <p className="text-sm text-muted-foreground mt-1">Подробные логи выполнения операций</p>
      </div>

      <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
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
                <td className="text-sm text-muted-foreground">
                  {new Date(log.created_at).toLocaleString()}
                </td>
                <td className="text-sm text-foreground">{log.action}</td>
                <td className="text-sm text-muted-foreground">{log.step || "—"}</td>
                <td>
                  {log.success ? (
                    <span className="pill-success">OK</span>
                  ) : (
                    <span className="pill-error">FAIL</span>
                  )}
                </td>
                <td className="text-sm text-destructive truncate max-w-[250px]">
                  {log.error_message || "—"}
                </td>
                <td>
                  <Dialog>
                    <DialogTrigger asChild>
                      <button className="p-2 rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
                        <Eye className="w-4 h-4" />
                      </button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl">
                      <DialogHeader>
                        <DialogTitle className="text-sm font-semibold">{log.action} — {log.step}</DialogTitle>
                      </DialogHeader>
                      <ScrollArea className="max-h-[60vh]">
                        <div className="space-y-4 text-sm">
                          <div>
                            <p className="text-xs text-muted-foreground font-medium mb-1">Request</p>
                            <pre className="bg-muted rounded-xl p-4 text-xs overflow-auto text-foreground">
                              {log.request_data ? JSON.stringify(log.request_data, null, 2) : "—"}
                            </pre>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground font-medium mb-1">Response</p>
                            <pre className="bg-muted rounded-xl p-4 text-xs overflow-auto text-foreground">
                              {log.response_data ? JSON.stringify(log.response_data, null, 2) : "—"}
                            </pre>
                          </div>
                          {log.error_message && (
                            <div>
                              <p className="text-xs text-muted-foreground font-medium mb-1">Ошибка</p>
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
                <td colSpan={6} className="text-center text-muted-foreground py-16">Загрузка...</td>
              </tr>
            )}
            {!isLoading && (!logs || logs.length === 0) && (
              <tr>
                <td colSpan={6} className="text-center text-muted-foreground py-16">
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
