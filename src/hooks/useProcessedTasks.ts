import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ProcessedTask {
  id: string;
  jira_issue_key: string;
  jira_summary: string | null;
  jira_description: string | null;
  action: string | null;
  ai_response: any;
  execution_result: any;
  status: string;
  retry_count: number;
  dry_run: boolean;
  created_at: string;
  updated_at: string;
}

export const useProcessedTasks = () => {
  return useQuery({
    queryKey: ["processed_tasks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("processed_tasks")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as ProcessedTask[];
    },
    refetchInterval: 10000,
  });
};
