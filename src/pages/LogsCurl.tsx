import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Eye, Globe } from "lucide-react";
import { format } from "date-fns";

interface CurlLog {
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

const useCurlLogs = () => {
  return useQuery({
    queryKey: ["curl_logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("execution_logs")
        .select("*")
        .neq("action", "ai_parse")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as CurlLog[];
    },
    refetchInterval: 10000,
  });
};

const LogsCurl = () => {
  const { data: logs, isLoading } = useCurlLogs();

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Globe className="w-5 h-5 text-primary" />
          <h1 className="text-3xl font-extrabold text-foreground tracking-tight">Логи запросов</h1>
        </div>
        <p className="text-sm text-muted-foreground">HTTP-запросы к внешним API (Spark, Jira, Yandex)</p>
      </div>

      <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="data-table-wrapper">
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
                <td className="text-sm text-muted-foreground whitespace-nowrap">
                  {format(new Date(log.created_at), "dd.MM HH:mm:ss")}
                </td>
                <td className="text-sm font-medium text-foreground">{log.action}</td>
                <td className="text-sm text-muted-foreground">{log.step || "—"}</td>
                <td>
                  {log.success
                    ? <span className="pill-success">OK</span>
                    : <span className="pill-error">FAIL</span>}
                </td>
                <td className="text-sm text-destructive truncate max-w-[200px]">
                  {log.error_message || "—"}
                </td>
                <td>
                  <Dialog>
                    <DialogTrigger asChild>
                      <button className="p-2 rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
                        <Eye className="w-4 h-4" />
                      </button>
                    </DialogTrigger>
                    <DialogContent className="max-w-3xl">
                      <DialogHeader>
                        <DialogTitle className="text-sm font-semibold">{log.action} → {log.step}</DialogTitle>
                      </DialogHeader>
                      <ScrollArea className="max-h-[70vh]">
                        <div className="space-y-4 text-sm">
                          <div>
                            <p className="text-xs text-muted-foreground font-semibold mb-2 uppercase tracking-wider">Request</p>
                            <pre className="bg-muted rounded-xl p-4 text-xs overflow-auto text-foreground whitespace-pre-wrap">
                              {log.request_data ? JSON.stringify(log.request_data, null, 2) : "Нет данных"}
                            </pre>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground font-semibold mb-2 uppercase tracking-wider">Response</p>
                            <pre className="bg-muted rounded-xl p-4 text-xs overflow-auto text-foreground whitespace-pre-wrap">
                              {log.response_data ? JSON.stringify(log.response_data, null, 2) : "Нет данных"}
                            </pre>
                          </div>
                          {log.error_message && (
                            <div>
                              <p className="text-xs text-muted-foreground font-semibold mb-2 uppercase tracking-wider">Ошибка</p>
                              <p className="text-destructive text-sm bg-destructive/5 p-3 rounded-xl">{log.error_message}</p>
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
              <tr><td colSpan={6} className="text-center text-muted-foreground py-16">Загрузка...</td></tr>
            )}
            {!isLoading && (!logs || logs.length === 0) && (
              <tr><td colSpan={6} className="text-center text-muted-foreground py-16">Нет логов запросов</td></tr>
            )}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
};

export default LogsCurl;
