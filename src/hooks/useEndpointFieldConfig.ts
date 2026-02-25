import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface FieldConfig {
  id: string;
  action: string;
  field_name: string;
  is_mutable: boolean;
  description: string | null;
  created_at: string;
}

export function useEndpointFieldConfig() {
  return useQuery({
    queryKey: ["endpoint_field_config"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("endpoint_field_config" as any)
        .select("*")
        .order("action")
        .order("field_name");
      if (error) throw error;
      return data as unknown as FieldConfig[];
    },
  });
}

export function useToggleFieldMutable() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, is_mutable }: { id: string; is_mutable: boolean }) => {
      const { error } = await supabase
        .from("endpoint_field_config" as any)
        .update({ is_mutable } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["endpoint_field_config"] });
    },
  });
}
