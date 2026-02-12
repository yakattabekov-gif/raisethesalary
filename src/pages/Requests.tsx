import { useProcessedTasks } from "@/hooks/useProcessedTasks";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Eye } from "lucide-react";

const statusConfig: Record<string, { dot: string; badge: string }> = {
  completed: { dot: "status-dot-success", badge: "bg-primary/10 text-primary border-primary/20" },
  error: { dot: "status-dot-error", badge: "bg-destructive/10 text-destructive border-destructive/20" },
  pending: { dot: "status-dot-warning", badge: "bg-warning/10 text-warning border-warning/20" },
  processing: { dot: "status-dot-warning", badge: "bg-warning/10 text-warning border-warning/20" },
};

const Requests = () => {
  const { data: tasks, isLoading } = useProcessedTasks();

  return (
    <div className="p-6 lg:p-10 space-y-6 max-w-[1400px]">
      <div>
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Заявки</h1>
        <p className="text-sm text-muted-foreground mt-1">Обработанные заявки из Jira</p>
      </div>

      <div className="glass-card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>Jira</th>
              <th>Действие</th>
              <th>Статус</th>
              <th>Dry Run</th>
              <th>Попытки</th>
              <th>Дата</th>
              <th className="w-12"></th>
            </tr>
          </thead>
          <tbody>
            {tasks?.map((task) => {
              const sc = statusConfig[task.status] || { dot: "status-dot-idle", badge: "" };
              return (
                <tr key={task.id}>
                  <td className="font-mono text-xs text-primary font-medium">{task.jira_issue_key}</td>
                  <td className="text-xs">{task.action || "—"}</td>
                  <td>
                    <Badge variant="outline" className={`text-[11px] font-mono gap-1.5 ${sc.badge}`}>
                      <span className={sc.dot} />
                      {task.status}
                    </Badge>
                  </td>
                  <td className="text-xs font-mono">
                    {task.dry_run ? <span className="text-warning">ДА</span> : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="font-mono text-xs">{task.retry_count}</td>
                  <td className="font-mono text-xs text-muted-foreground">
                    {new Date(task.created_at).toLocaleString()}
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
                          <DialogTitle className="font-mono text-sm">{task.jira_issue_key} — {task.action}</DialogTitle>
                        </DialogHeader>
                        <ScrollArea className="max-h-[60vh]">
                          <div className="space-y-4 text-sm">
                            <div>
                              <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1.5">Summary</p>
                              <p className="text-foreground">{task.jira_summary || "—"}</p>
                            </div>
                            <div>
                              <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1.5">AI Response</p>
                              <pre className="bg-background rounded-lg p-4 text-xs font-mono overflow-auto text-foreground border border-border/40">
                                {task.ai_response ? JSON.stringify(task.ai_response, null, 2) : "—"}
                              </pre>
                            </div>
                            <div>
                              <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1.5">Результат</p>
                              <pre className="bg-background rounded-lg p-4 text-xs font-mono overflow-auto text-foreground border border-border/40">
                                {task.execution_result ? JSON.stringify(task.execution_result, null, 2) : "—"}
                              </pre>
                            </div>
                          </div>
                        </ScrollArea>
                      </DialogContent>
                    </Dialog>
                  </td>
                </tr>
              );
            })}
            {isLoading && (
              <tr>
                <td colSpan={7} className="text-center text-muted-foreground py-12">Загрузка...</td>
              </tr>
            )}
            {!isLoading && (!tasks || tasks.length === 0) && (
              <tr>
                <td colSpan={7} className="text-center text-muted-foreground py-12">
                  Нет обработанных заявок.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Requests;
