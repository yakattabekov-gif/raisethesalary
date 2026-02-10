import { useProcessedTasks } from "@/hooks/useProcessedTasks";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

const statusColors: Record<string, string> = {
  completed: "bg-primary/10 text-primary border-primary/20",
  error: "bg-destructive/10 text-destructive border-destructive/20",
  pending: "bg-warning/10 text-warning border-warning/20",
  processing: "bg-blue-500/10 text-blue-400 border-blue-500/20",
};

const actionLabels: Record<string, string> = {
  cancel: "❌ Отмена",
  update_address: "📍 Смена адреса",
};

const Requests = () => {
  const { data: tasks, isLoading } = useProcessedTasks();

  return (
    <div className="p-8 space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-foreground">Requests</h1>
        <p className="text-sm text-muted-foreground">Обработанные заявки из Jira</p>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Jira Issue</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Action</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Dry Run</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Retries</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Date</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {tasks?.map((task) => (
              <tr key={task.id} className="hover:bg-accent/30 transition-colors">
                <td className="px-4 py-3 font-mono text-xs text-primary">{task.jira_issue_key}</td>
                <td className="px-4 py-3 text-xs">
                  {task.action ? (actionLabels[task.action] || task.action) : "—"}
                </td>
                <td className="px-4 py-3">
                  <Badge variant="outline" className={`text-[11px] font-mono ${statusColors[task.status] || ""}`}>
                    {task.status}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-xs font-mono">
                  {task.dry_run ? <span className="text-warning">YES</span> : <span className="text-muted-foreground">no</span>}
                </td>
                <td className="px-4 py-3 font-mono text-xs">{task.retry_count}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                  {new Date(task.created_at).toLocaleString()}
                </td>
                <td className="px-4 py-3">
                  <Dialog>
                    <DialogTrigger asChild>
                      <button className="text-xs text-primary hover:underline">View</button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl bg-card border-border">
                      <DialogHeader>
                        <DialogTitle className="font-mono text-sm">{task.jira_issue_key}</DialogTitle>
                      </DialogHeader>
                      <ScrollArea className="max-h-[60vh]">
                        <div className="space-y-4 text-sm">
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">Summary</p>
                            <p className="text-foreground">{task.jira_summary || "—"}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">AI Response</p>
                            <pre className="bg-secondary rounded-md p-3 text-xs font-mono overflow-auto text-foreground">
                              {task.ai_response ? JSON.stringify(task.ai_response, null, 2) : "—"}
                            </pre>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">Execution Result</p>
                            <pre className="bg-secondary rounded-md p-3 text-xs font-mono overflow-auto text-foreground">
                              {task.execution_result ? JSON.stringify(task.execution_result, null, 2) : "—"}
                            </pre>
                          </div>
                        </div>
                      </ScrollArea>
                    </DialogContent>
                  </Dialog>
                </td>
              </tr>
            ))}
            {isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">Loading...</td>
              </tr>
            )}
            {!isLoading && (!tasks || tasks.length === 0) && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No requests processed yet.
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
