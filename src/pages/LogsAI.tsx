import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Eye, Brain } from "lucide-react";
import { format } from "date-fns";
import { motion } from "framer-motion";

interface AILog {
  id: string;
  task_id: string | null;
  action: string;
  step: string | null;
  request_data: any;
  response_data: any;
  success: boolean;
  error_message: string | null;
  created_at: string;
}

const useAILogs = () => {
  return useQuery({
    queryKey: ["ai_logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("execution_logs")
        .select("*")
        .eq("action", "ai_parse")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as AILog[];
    },
    refetchInterval: 5000,
  });
};

const LogsAI = () => {
  const { data: logs, isLoading } = useAILogs();

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-2xl bg-primary/15 flex items-center justify-center">
            <Brain className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold text-foreground tracking-tight">Логи AI</h1>
            <p className="text-[11px] text-muted-foreground">Запросы к OpenAI и ответы парсинга заявок</p>
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
              <th>Время</th>
              <th>Шаг</th>
              <th>Результат</th>
              <th>Ошибка</th>
              <th className="w-12"></th>
            </tr>
          </thead>
          <tbody>
            {logs?.map((log) => (
              <tr key={log.id}>
                <td className="text-sm text-muted-foreground whitespace-nowrap">
                  {format(new Date(log.created_at), "dd.MM HH:mm:ss")}
                </td>
                <td className="text-sm font-medium text-foreground">{log.step || "—"}</td>
                <td>
                  {log.success
                    ? <span className="pill-success">OK</span>
                    : <span className="pill-error">FAIL</span>}
                </td>
                <td className="text-sm text-destructive truncate max-w-[200px]">{log.error_message || "—"}</td>
                <td>
                  <Dialog>
                    <DialogTrigger asChild>
                      <button className="p-2 rounded-full hover:bg-muted/30 transition-colors text-muted-foreground hover:text-foreground">
                        <Eye className="w-4 h-4" />
                      </button>
                    </DialogTrigger>
                    <DialogContent className="max-w-3xl glass-thick border-0">
                      <DialogHeader>
                        <DialogTitle className="text-sm font-semibold text-foreground">AI запрос / ответ</DialogTitle>
                      </DialogHeader>
                      <ScrollArea className="max-h-[70vh]">
                        <div className="space-y-4 text-sm">
                          <div>
                            <p className="text-[11px] text-muted-foreground font-semibold mb-2 uppercase tracking-wider">Запрос к AI</p>
                            <pre className="bg-muted/20 rounded-2xl p-4 text-xs overflow-auto text-foreground whitespace-pre-wrap">
                              {log.request_data ? JSON.stringify(log.request_data, null, 2) : "Нет данных"}
                            </pre>
                          </div>
                          <div>
                            <p className="text-[11px] text-muted-foreground font-semibold mb-2 uppercase tracking-wider">Ответ AI</p>
                            <pre className="bg-muted/20 rounded-2xl p-4 text-xs overflow-auto text-foreground whitespace-pre-wrap">
                              {log.response_data ? JSON.stringify(log.response_data, null, 2) : "Нет данных"}
                            </pre>
                          </div>
                          {log.error_message && (
                            <div>
                              <p className="text-[11px] text-muted-foreground font-semibold mb-2 uppercase tracking-wider">Ошибка</p>
                              <p className="text-destructive text-sm bg-destructive/10 p-4 rounded-2xl">{log.error_message}</p>
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
              <tr><td colSpan={5} className="text-center text-muted-foreground py-16">Загрузка...</td></tr>
            )}
            {!isLoading && (!logs || logs.length === 0) && (
              <tr><td colSpan={5} className="text-center text-muted-foreground py-16">Нет логов AI</td></tr>
            )}
          </tbody>
        </table>
      </motion.div>
    </div>
  );
};

export default LogsAI;
