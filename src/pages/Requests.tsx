import { useProcessedTasks } from "@/hooks/useProcessedTasks";
import { useExecutionLogs } from "@/hooks/useExecutionLogs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Eye, RotateCcw, Terminal, Octagon } from "lucide-react";
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

const buildCurl = (requestData: any): string | null => {
  if (!requestData?.endpoint) return null;
  const parts = requestData.endpoint.split(" ");
  const method = parts[0] || "GET";
  const url = parts.slice(1).join(" ");
  let curl = `curl -X ${method} "${url}"`;
  curl += ` \\\n  -H "Authorization: Bearer <TOKEN>"`;
  curl += ` \\\n  -H "Content-Type: application/json"`;
  if (requestData.body) {
    curl += ` \\\n  -d '${JSON.stringify(requestData.body, null, 2)}'`;
  }
  return curl;
};

const Requests = () => {
  const { data: tasks, isLoading } = useProcessedTasks();
  const { data: executionLogs } = useExecutionLogs();
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

      const { data: envData } = await supabase.functions.invoke("process-jira-tasks", { method: "POST" });
      
      queryClient.invalidateQueries({ queryKey: ["processed_tasks"] });
      toast.success(`${issueKey} отправлена на повторную обработку`);
    } catch (e: any) {
      toast.error(`Ошибка: ${e.message}`);
    } finally {
      setRetrying(null);
    }
  };

  const getApiLogsForTask = (taskId: string) => {
    if (!executionLogs) return [];
    return executionLogs.filter(
      (log) => log.task_id === taskId && (log.request_data?.endpoint || log.error_message || log.step === "error")
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-foreground tracking-tight">Заявки</h1>
        <p className="text-sm text-muted-foreground mt-1">Обработанные заявки из Jira</p>
      </div>

      <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="data-table-wrapper">
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
              <th className="w-12"></th>
            </tr>
          </thead>
          <tbody>
            {tasks?.map((task) => {
              const apiLogs = getApiLogsForTask(task.id);
              return (
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
                    {apiLogs.length > 0 ? (
                      <Dialog>
                        <DialogTrigger asChild>
                          <button className="p-2 rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground" title="Показать cURL запросы">
                            <Terminal className="w-4 h-4" />
                          </button>
                        </DialogTrigger>
                        <DialogContent className="max-w-4xl">
                          <DialogHeader>
                            <DialogTitle className="text-sm font-semibold">{task.jira_issue_key} — API запросы</DialogTitle>
                          </DialogHeader>
                          <ScrollArea className="max-h-[70vh]">
                            <div className="space-y-4">
                              {apiLogs.map((log) => {
                                const curl = buildCurl(log.request_data);
                                return (
                                  <div key={log.id} className="border border-border rounded-xl overflow-hidden">
                                    <div className="flex items-center justify-between px-4 py-2 bg-muted/50">
                                      <div className="flex items-center gap-2">
                                        <span className="text-xs font-mono font-semibold text-foreground">{log.action}</span>
                                        <span className="text-xs text-muted-foreground">→ {log.step}</span>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        {log.success
                                          ? <span className="pill-success text-xs">OK</span>
                                          : <span className="pill-error text-xs">FAIL</span>}
                                        {log.response_data?.status && (
                                          <span className="text-xs font-mono text-muted-foreground">{log.response_data.status}</span>
                                        )}
                                      </div>
                                    </div>
                                    <div className="p-4 space-y-3">
                                      <div>
                                        <p className="text-xs text-muted-foreground font-semibold mb-1 uppercase tracking-wider">Endpoint</p>
                                        <p className="text-sm font-mono text-foreground break-all">{log.request_data?.endpoint}</p>
                                      </div>
                                      {log.request_data?.body && (
                                        <div>
                                          <p className="text-xs text-muted-foreground font-semibold mb-1 uppercase tracking-wider">Request Body</p>
                                          <pre className="bg-muted rounded-lg p-3 text-xs overflow-auto text-foreground whitespace-pre-wrap max-h-64">
                                            {JSON.stringify(log.request_data.body, null, 2)}
                                          </pre>
                                        </div>
                                      )}
                                      {curl && (
                                        <div>
                                          <p className="text-xs text-muted-foreground font-semibold mb-1 uppercase tracking-wider">cURL</p>
                                          <pre className="bg-muted rounded-lg p-3 text-xs overflow-auto text-foreground whitespace-pre-wrap max-h-64 select-all">
                                            {curl}
                                          </pre>
                                        </div>
                                      )}
                                      {log.response_data && (
                                        <div>
                                          <p className="text-xs text-muted-foreground font-semibold mb-1 uppercase tracking-wider">Response</p>
                                          <pre className="bg-muted rounded-lg p-3 text-xs overflow-auto text-foreground whitespace-pre-wrap max-h-40">
                                            {JSON.stringify(log.response_data, null, 2)}
                                          </pre>
                                        </div>
                                      )}
                                      {log.error_message && (
                                        <p className="text-destructive text-xs bg-destructive/5 p-2 rounded-lg">{log.error_message}</p>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </ScrollArea>
                        </DialogContent>
                      </Dialog>
                    ) : (
                      <span className="p-2 inline-block text-muted-foreground/30">
                        <Terminal className="w-4 h-4" />
                      </span>
                    )}
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
              );
            })}
            {isLoading && (
              <tr>
                <td colSpan={9} className="text-center text-muted-foreground py-16">Загрузка...</td>
              </tr>
            )}
            {!isLoading && (!tasks || tasks.length === 0) && (
              <tr>
                <td colSpan={9} className="text-center text-muted-foreground py-16">
                  Нет обработанных заявок.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
};

export default Requests;
