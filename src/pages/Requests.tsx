import { useProcessedTasks } from "@/hooks/useProcessedTasks";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Eye, RotateCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useState } from "react";

const statusPill = (status: string) => {
  if (status === "completed") return <span className="pill-success">Completed</span>;
  if (status === "error") return <span className="pill-error">Error</span>;
  if (status === "pending" || status === "processing") return <span className="pill-warning">{status}</span>;
  return <span className="pill-idle">{status}</span>;
};

const Requests = () => {
  const { data: tasks, isLoading } = useProcessedTasks();
  const queryClient = useQueryClient();
  const [retrying, setRetrying] = useState<string | null>(null);

  const handleRetry = async (taskId: string, issueKey: string) => {
    setRetrying(taskId);
    try {
      const { error } = await supabase
        .from("processed_tasks")
        .update({ status: "pending", retry_count: 0, execution_result: null } as any)
        .eq("id", taskId);
      if (error) throw error;

      // Trigger edge function
      const { data: envData } = await supabase.functions.invoke("process-jira-tasks", { method: "POST" });
      
      queryClient.invalidateQueries({ queryKey: ["processed_tasks"] });
      toast.success(`${issueKey} отправлена на повторную обработку`);
    } catch (e: any) {
      toast.error(`Ошибка: ${e.message}`);
    } finally {
      setRetrying(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-foreground tracking-tight">Заявки</h1>
        <p className="text-sm text-muted-foreground mt-1">Обработанные заявки из Jira</p>
      </div>

      <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
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
              <th className="w-12"></th>
            </tr>
          </thead>
          <tbody>
            {tasks?.map((task) => (
              <tr key={task.id}>
                <td className="text-sm font-semibold text-primary">{task.jira_issue_key}</td>
                <td className="text-sm text-foreground">{task.action || "—"}</td>
                <td>{statusPill(task.status)}</td>
                <td className="text-sm">
                  {task.dry_run ? (
                    <span className="pill-warning">ДА</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="text-sm">{task.retry_count}</td>
                <td className="text-sm text-muted-foreground">
                  {new Date(task.created_at).toLocaleString()}
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
                        <DialogTitle className="text-sm font-semibold">{task.jira_issue_key} — {task.action}</DialogTitle>
                      </DialogHeader>
                      <ScrollArea className="max-h-[60vh]">
                        <div className="space-y-4 text-sm">
                          <div>
                            <p className="text-xs text-muted-foreground font-medium mb-1">Summary</p>
                            <p className="text-foreground">{task.jira_summary || "—"}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground font-medium mb-1">AI Response</p>
                            <pre className="bg-muted rounded-xl p-4 text-xs overflow-auto text-foreground">
                              {task.ai_response ? JSON.stringify(task.ai_response, null, 2) : "—"}
                            </pre>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground font-medium mb-1">Результат</p>
                            <pre className="bg-muted rounded-xl p-4 text-xs overflow-auto text-foreground">
                              {task.execution_result ? JSON.stringify(task.execution_result, null, 2) : "—"}
                            </pre>
                          </div>
                        </div>
                      </ScrollArea>
                    </DialogContent>
                  </Dialog>
                </td>
                <td>
                  <button
                    onClick={() => handleRetry(task.id, task.jira_issue_key)}
                    disabled={retrying === task.id || task.status === "processing" || task.status === "pending"}
                    className="p-2 rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Повторить обработку"
                  >
                    <RotateCcw className={`w-4 h-4 ${retrying === task.id ? "animate-spin" : ""}`} />
                  </button>
                </td>
              </tr>
            ))}
            {isLoading && (
              <tr>
                <td colSpan={8} className="text-center text-muted-foreground py-16">Загрузка...</td>
              </tr>
            )}
            {!isLoading && (!tasks || tasks.length === 0) && (
              <tr>
                <td colSpan={8} className="text-center text-muted-foreground py-16">
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
