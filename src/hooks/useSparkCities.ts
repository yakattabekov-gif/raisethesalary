import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const useSparkCities = () =>
  useQuery({
    queryKey: ["spark_cities"],
    queryFn: async () => {
      const all: { id: number; name: string }[] = [];
      let from = 0;
      const pageSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("spark_cities")
          .select("id, name")
          .order("name")
          .range(from, from + pageSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < pageSize) break;
        from += pageSize;
      }
      return all;
    },
    staleTime: 1000 * 60 * 30,
  });
