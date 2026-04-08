import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ExecutionLog {
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

export const useExecutionLogs = () => {
  return useQuery({
    queryKey: ["execution_logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("execution_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as ExecutionLog[];
    },
    refetchInterval: 10000,
  });
};
