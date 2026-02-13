import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface AllowedDirection {
  id: string;
  parent_city: string;
  child_city: string;
  created_at: string;
}

export const useAllowedDirections = () =>
  useQuery({
    queryKey: ["allowed_directions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("allowed_directions")
        .select("*")
        .order("parent_city");
      if (error) throw error;
      return data as AllowedDirection[];
    },
  });

export const useAddDirection = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ parent_city, child_city }: { parent_city: string; child_city: string }) => {
      const { error } = await supabase.from("allowed_directions").insert({ parent_city, child_city });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["allowed_directions"] }),
  });
};

export const useBulkAddDirections = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rows: { parent_city: string; child_city: string }[]) => {
      if (rows.length === 0) return;
      const { error } = await supabase.from("allowed_directions").insert(rows);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["allowed_directions"] }),
  });
};

export const useDeleteDirection = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("allowed_directions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["allowed_directions"] }),
  });
};

export const useDeleteDirectionsByParent = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (parent_city: string) => {
      const { error } = await supabase.from("allowed_directions").delete().eq("parent_city", parent_city);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["allowed_directions"] }),
  });
};
