import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const useSparkCities = () =>
  useQuery({
    queryKey: ["spark_cities"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("spark_cities")
        .select("id, name")
        .order("name");
      if (error) throw error;
      return data;
    },
    staleTime: 1000 * 60 * 30,
  });
