import { useState, useRef, useMemo } from "react";
import { useSparkCities } from "@/hooks/useSparkCities";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Upload, Plus, Trash2, Search, Building2, RefreshCw } from "lucide-react";
import * as XLSX from "xlsx";

const useAddCity = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name }: { id: number; name: string }) => {
      const { error } = await supabase.from("spark_cities").insert({ id, name });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["spark_cities"] }),
  });
};

const useBulkAddCities = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rows: { id: number; name: string }[]) => {
      if (rows.length === 0) return;
      // Insert in batches of 500
      for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500);
        const { error } = await supabase.from("spark_cities").insert(batch);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["spark_cities"] }),
  });
};

const useDeleteCity = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase.from("spark_cities").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["spark_cities"] }),
  });
};

const SparkCities = () => {
  const { data: cities, isLoading } = useSparkCities();
  const addCity = useAddCity();
  const bulkAdd = useBulkAddCities();
  const deleteCity = useDeleteCity();
  const qc = useQueryClient();

  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [search, setSearch] = useState("");
  const [importing, setImporting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("sync-cities", {
        body: { mode: "sync" },
      });
      if (error) throw error;
      const result = data as any;
      if (result?.error) throw new Error(result.error);
      toast.success(`Синхронизация завершена: ${result?.synced || 0} городов загружено`);
      qc.invalidateQueries({ queryKey: ["spark_cities"] });
    } catch (e: any) {
      toast.error("Ошибка синхронизации: " + (e.message || "неизвестная ошибка"));
    } finally {
      setSyncing(false);
    }
  };

  const filtered = useMemo(() => {
    if (!cities) return [];
    if (!search.trim()) return cities;
    const q = search.toLowerCase();
    return cities.filter(
      (c) => c.name.toLowerCase().includes(q) || String(c.id).includes(q)
    );
  }, [cities, search]);

  const handleAdd = async () => {
    const id = parseInt(newId);
    const name = newName.trim();
    if (!id || !name) return toast.error("Заполните ID и название");
    try {
      await addCity.mutateAsync({ id, name });
      toast.success(`Добавлен: ${name} (${id})`);
      setNewId("");
      setNewName("");
    } catch (e: any) {
      if (e.message?.includes("duplicate")) toast.error("Город с таким ID уже существует");
      else toast.error(e.message || "Ошибка");
    }
  };

  const handleExcelImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });

      const existingIds = new Set((cities || []).map((c) => c.id));
      const toInsert: { id: number; name: string }[] = [];
      let skipped = 0;
      let invalid = 0;

      for (const row of rows) {
        const id = parseInt(String(row[0] || ""));
        const name = String(row[1] || "").trim();
        if (!id || !name) { invalid++; continue; }
        if (existingIds.has(id)) { skipped++; continue; }
        toInsert.push({ id, name });
        existingIds.add(id);
      }

      if (toInsert.length > 0) {
        await bulkAdd.mutateAsync(toInsert);
      }

      const parts: string[] = [];
      if (toInsert.length > 0) parts.push(`добавлено: ${toInsert.length}`);
      if (skipped > 0) parts.push(`пропущено (дубли): ${skipped}`);
      if (invalid > 0) parts.push(`невалидных строк: ${invalid}`);
      toast.success(`Импорт завершён. ${parts.join(", ")}`);
    } catch (err: any) {
      toast.error("Ошибка: " + (err.message || "неизвестная ошибка"));
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  if (isLoading) return <div className="py-16 text-center text-muted-foreground">Загрузка...</div>;

  return (
    <div className="space-y-8 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold text-foreground tracking-tight">Города Spark</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Справочник городов — {cities?.length || 0} записей
          </p>
        </div>
        <Button onClick={handleSync} disabled={syncing} variant="outline" className="rounded-xl gap-1.5">
          <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Синхронизация..." : "Синхронизировать из Spark"}
        </Button>
      </div>

      {/* Import + Add */}
      <section className="bg-card rounded-2xl border border-border p-6 space-y-4">
        <h2 className="text-sm font-semibold text-foreground">Добавить город</h2>

        <div className="flex gap-2 items-end">
          <div className="space-y-1.5 w-28">
            <label className="text-xs font-medium text-muted-foreground">ID</label>
            <Input value={newId} onChange={(e) => setNewId(e.target.value)} placeholder="123" className="text-sm rounded-xl" />
          </div>
          <div className="flex-1 space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Название</label>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Алматы" className="text-sm rounded-xl" />
          </div>
          <Button onClick={handleAdd} disabled={addCity.isPending} size="sm" className="h-10 rounded-xl gap-1.5">
            <Plus className="w-4 h-4" /> Добавить
          </Button>
        </div>

        <div className="flex gap-2 pt-2 border-t border-border">
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleExcelImport} />
          <Button variant="outline" size="sm" className="rounded-xl gap-1.5 w-full" disabled={importing} onClick={() => fileInputRef.current?.click()}>
            <Upload className="w-4 h-4" />
            {importing ? "Импорт..." : "Импорт из Excel (ID | Название)"}
          </Button>
        </div>
      </section>

      {/* Search + List */}
      <section className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по названию или ID..." className="pl-9 text-sm rounded-xl" />
        </div>

        <div className="bg-card rounded-2xl border border-border divide-y divide-border max-h-[500px] overflow-y-auto">
          {filtered.length === 0 && (
            <div className="text-center py-8 text-muted-foreground text-sm">Ничего не найдено</div>
          )}
          {filtered.slice(0, 200).map((c) => (
            <div key={c.id} className="flex items-center justify-between px-4 py-2.5 hover:bg-muted/50 transition-colors">
              <div className="flex items-center gap-3">
                <Building2 className="w-4 h-4 text-primary" />
                <span className="text-sm text-foreground">{c.name}</span>
                <span className="text-xs text-muted-foreground">#{c.id}</span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => deleteCity.mutate(c.id)} className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive">
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}
          {filtered.length > 200 && (
            <div className="text-center py-3 text-xs text-muted-foreground">
              Показано 200 из {filtered.length} — используйте поиск
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default SparkCities;
