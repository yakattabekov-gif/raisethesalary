import { useProcessedTasks } from "@/hooks/useProcessedTasks";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Eye, ListTodo } from "lucide-react";
import { motion } from "framer-motion";

const statusPill = (status: string) => {
  if (status === "completed") return <span className="pill-success">Completed</span>;
  if (status === "error") return <span className="pill-error">Error</span>;
  if (status === "pending" || status === "processing") return <span className="pill-warning">{status}</span>;
  return <span className="pill-idle">{status}</span>;
};

const Requests = () => {
  const { data: tasks, isLoading } = useProcessedTasks();

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-2xl bg-warning/15 flex items-center justify-center">
            <ListTodo className="w-5 h-5 text-warning" />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold text-foreground tracking-tight">Заявки</h1>
            <p className="text-[11px] text-muted-foreground">Обработанные заявки из Jira</p>
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="glass rounded-[24px] overflow-hidden"
      >
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
            {tasks?.map((task) => (
              <tr key={task.id}>
                <td className="text-sm font-semibold text-primary">{task.jira_issue_key}</td>
                <td className="text-sm text-foreground">{task.action || "—"}</td>
                <td>{statusPill(task.status)}</td>
                <td className="text-sm">
                  {task.dry_run ? <span className="pill-warning">ДА</span> : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="text-sm text-foreground">{task.retry_count}</td>
                <td className="text-sm text-muted-foreground">{new Date(task.created_at).toLocaleString()}</td>
                <td>
                  <Dialog>
                    <DialogTrigger asChild>
                      <button className="p-2 rounded-full hover:bg-muted/30 transition-colors text-muted-foreground hover:text-foreground">
                        <Eye className="w-4 h-4" />
                      </button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl glass-thick border-0">
                      <DialogHeader>
                        <DialogTitle className="text-sm font-semibold text-foreground">{task.jira_issue_key} — {task.action}</DialogTitle>
                      </DialogHeader>
                      <ScrollArea className="max-h-[60vh]">
                        <div className="space-y-4 text-sm">
                          <div>
                            <p className="text-[11px] text-muted-foreground font-medium mb-1 uppercase tracking-wider">Summary</p>
                            <p className="text-foreground">{task.jira_summary || "—"}</p>
                          </div>
                          <div>
                            <p className="text-[11px] text-muted-foreground font-medium mb-1 uppercase tracking-wider">AI Response</p>
                            <pre className="bg-muted/20 rounded-2xl p-4 text-xs overflow-auto text-foreground">
                              {task.ai_response ? JSON.stringify(task.ai_response, null, 2) : "—"}
                            </pre>
                          </div>
                          <div>
                            <p className="text-[11px] text-muted-foreground font-medium mb-1 uppercase tracking-wider">Результат</p>
                            <pre className="bg-muted/20 rounded-2xl p-4 text-xs overflow-auto text-foreground">
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
              <tr><td colSpan={7} className="text-center text-muted-foreground py-16">Загрузка...</td></tr>
            )}
            {!isLoading && (!tasks || tasks.length === 0) && (
              <tr><td colSpan={7} className="text-center text-muted-foreground py-16">Нет обработанных заявок</td></tr>
            )}
          </tbody>
        </table>
      </motion.div>
    </div>
  );
};

export default Requests;
