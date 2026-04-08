import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface CronRun {
  id: string;
  started_at: string;
  finished_at: string | null;
  tasks_found: number;
  tasks_processed: number;
  status: string;
  error_message: string | null;
}

export const useCronRuns = () => {
  return useQuery({
    queryKey: ["cron_runs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cron_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as CronRun[];
    },
    refetchInterval: 10000,
  });
};
