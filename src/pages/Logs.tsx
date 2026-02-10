import { useExecutionLogs } from "@/hooks/useExecutionLogs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

const Logs = () => {
  const { data: logs, isLoading } = useExecutionLogs();

  return (
    <div className="p-8 space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-foreground">Logs</h1>
        <p className="text-sm text-muted-foreground">Подробные логи выполнения операций</p>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Timestamp</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Action</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Step</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Result</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Error</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {logs?.map((log) => (
              <tr key={log.id} className="hover:bg-accent/30 transition-colors">
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                  {new Date(log.created_at).toLocaleString()}
                </td>
                <td className="px-4 py-3 text-xs font-mono">{log.action}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{log.step || "—"}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center gap-1.5 text-xs font-mono ${
                    log.success ? "text-primary" : "text-destructive"
                  }`}>
                    <span className={log.success ? "status-dot-success" : "status-dot-error"} />
                    {log.success ? "OK" : "FAIL"}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-destructive truncate max-w-[200px]">
                  {log.error_message || "—"}
                </td>
                <td className="px-4 py-3">
                  <Dialog>
                    <DialogTrigger asChild>
                      <button className="text-xs text-primary hover:underline">View</button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl bg-card border-border">
                      <DialogHeader>
                        <DialogTitle className="font-mono text-sm">{log.action} — {log.step}</DialogTitle>
                      </DialogHeader>
                      <ScrollArea className="max-h-[60vh]">
                        <div className="space-y-4 text-sm">
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">Request</p>
                            <pre className="bg-secondary rounded-md p-3 text-xs font-mono overflow-auto text-foreground">
                              {log.request_data ? JSON.stringify(log.request_data, null, 2) : "—"}
                            </pre>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">Response</p>
                            <pre className="bg-secondary rounded-md p-3 text-xs font-mono overflow-auto text-foreground">
                              {log.response_data ? JSON.stringify(log.response_data, null, 2) : "—"}
                            </pre>
                          </div>
                          {log.error_message && (
                            <div>
                              <p className="text-xs text-muted-foreground mb-1">Error</p>
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
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">Loading...</td>
              </tr>
            )}
            {!isLoading && (!logs || logs.length === 0) && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No logs yet.
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
