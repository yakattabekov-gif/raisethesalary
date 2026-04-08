import { useState, useMemo, useRef, useEffect } from "react";
import { useAllowedDirections, useAddDirection, useDeleteDirection, useBulkAddDirections, useDeleteDirectionsByParent } from "@/hooks/useAllowedDirections";
import { useQueryClient } from "@tanstack/react-query";
import { useSparkCities } from "@/hooks/useSparkCities";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import CityAutocomplete from "@/components/CityAutocomplete";
import { toast } from "sonner";
import { Plus, Trash2, MapPin, Upload, Globe } from "lucide-react";
import * as XLSX from "xlsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const AllowedDirections = () => {
  const { data: directions, isLoading } = useAllowedDirections();
  const { data: sparkCities } = useSparkCities();
  const addDirection = useAddDirection();
  const deleteDirection = useDeleteDirection();
  const bulkAdd = useBulkAddDirections();
  const deleteByParent = useDeleteDirectionsByParent();
  const qc = useQueryClient();

  const [parentCity, setParentCity] = useState("");
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [newChild, setNewChild] = useState("");
  const [importing, setImporting] = useState(false);
  const [addingRegion, setAddingRegion] = useState(false);
  const [regions, setRegions] = useState<string[]>([]);
  const [selectedRegion, setSelectedRegion] = useState<string>("");
  const [loadingRegions, setLoadingRegions] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load regions when a city dialog is opened
  useEffect(() => {
    if (selectedCity && regions.length === 0 && !loadingRegions) {
      setLoadingRegions(true);
      supabase.functions.invoke("sync-cities", { body: { mode: "regions" } })
        .then(({ data, error }) => {
          if (!error && data?.regions) {
            setRegions(data.regions);
          }
        })
        .finally(() => setLoadingRegions(false));
    }
  }, [selectedCity]);

  const handleAddByRegion = async () => {
    if (!selectedCity || !selectedRegion) return toast.error("Выберите область");
    setAddingRegion(true);
    try {
      const { data, error } = await supabase.functions.invoke("sync-cities", {
        body: { mode: "directions_by_region", parent_city: selectedCity, region: selectedRegion },
      });
      if (error) throw error;
      const result = data as any;
      if (result?.error) throw new Error(result.error);
      toast.success(`Добавлено ${result.added} направлений из области "${selectedRegion}" (пропущено: ${result.skipped})`);
      // Refresh directions
      qc.invalidateQueries({ queryKey: ["allowed_directions"] });
    } catch (e: any) {
      toast.error("Ошибка: " + (e.message || "неизвестная ошибка"));
    } finally {
      setAddingRegion(false);
      setSelectedRegion("");
    }
  };

  const handleExcelImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedCity) return;
    setImporting(true);
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });

      const cityNames = rows
        .map((row) => String(row[0] || "").trim())
        .filter(Boolean);

      if (cityNames.length === 0) {
        toast.error("Файл пуст или первый столбец не содержит данных");
        return;
      }

      const sparkMap = new Map(
        (sparkCities || []).map((c) => [c.name.toLowerCase(), c.name])
      );

      const existingChildren = new Set(
        (directions || [])
          .filter((d) => d.parent_city === selectedCity)
          .map((d) => d.child_city.toLowerCase())
      );

      const toInsert: { parent_city: string; child_city: string }[] = [];
      const notFound: string[] = [];
      let skipped = 0;

      for (const name of cityNames) {
        const matched = sparkMap.get(name.toLowerCase());
        if (!matched) {
          notFound.push(name);
          continue;
        }
        if (existingChildren.has(matched.toLowerCase())) {
          skipped++;
          continue;
        }
        toInsert.push({ parent_city: selectedCity, child_city: matched });
        existingChildren.add(matched.toLowerCase());
      }

      if (toInsert.length > 0) {
        await bulkAdd.mutateAsync(toInsert);
      }

      const parts: string[] = [];
      if (toInsert.length > 0) parts.push(`добавлено: ${toInsert.length}`);
      if (skipped > 0) parts.push(`пропущено (дубли): ${skipped}`);
      if (notFound.length > 0) parts.push(`не найдено: ${notFound.join(", ")}`);
      toast.success(`Импорт завершён. ${parts.join(", ")}`);
    } catch (err: any) {
      toast.error("Ошибка чтения файла: " + (err.message || "неизвестная ошибка"));
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const grouped = useMemo(() => {
    if (!directions) return {};
    const map: Record<string, typeof directions> = {};
    directions.forEach((d) => {
      if (!map[d.parent_city]) map[d.parent_city] = [];
      map[d.parent_city].push(d);
    });
    return map;
  }, [directions]);

  const handleAdd = async (parent: string, child: string, clearFn?: () => void) => {
    const p = parent.trim();
    const c = child.trim();
    if (!p || !c) return toast.error("Заполните оба поля");
    try {
      await addDirection.mutateAsync({ parent_city: p, child_city: c });
      toast.success(`Добавлено: ${p} → ${c}`);
      clearFn?.();
    } catch (e: any) {
      if (e.message?.includes("duplicate")) toast.error("Такое направление уже существует");
      else toast.error(e.message || "Ошибка");
    }
  };

  const handleDelete = async (id: string, parent: string, child: string) => {
    try {
      await deleteDirection.mutateAsync(id);
      toast.success(`Удалено: ${parent} → ${child}`);
    } catch {
      toast.error("Ошибка удаления");
    }
  };

  const handleDeleteParent = async (city: string) => {
    const count = grouped[city]?.length || 0;
    try {
      await deleteByParent.mutateAsync(city);
      setSelectedCity(null);
      toast.success(`Удалено направление «${city}» и ${count} дочерних`);
    } catch {
      toast.error("Ошибка удаления");
    }
  };

  if (isLoading) return <div className="py-16 text-center text-muted-foreground">Загрузка...</div>;

  const selectedDirs = selectedCity ? grouped[selectedCity] || [] : [];

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-3xl font-extrabold text-foreground tracking-tight">Разрешённые направления</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Направления, по которым разрешена смена даже при статусе «Груз в пути»
        </p>
      </div>

      {/* Add new parent city + first child */}
      <section className="bg-card rounded-2xl border border-border p-6 space-y-4">
        <h2 className="text-sm font-semibold text-foreground">Добавить направление</h2>
        <div className="flex gap-2 items-end">
          <div className="flex-1 space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Основной город</label>
            <CityAutocomplete
              value={parentCity}
              onChange={setParentCity}
              placeholder="Алматы"
            />
          </div>
          <Button
            onClick={() => handleAdd(parentCity, parentCity, () => setParentCity(""))}
            disabled={addDirection.isPending}
            size="sm"
            className="h-10 rounded-xl gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Добавить
          </Button>
        </div>
      </section>

      {/* City cards grid */}
      <section className="space-y-3">
        {Object.keys(grouped).length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-sm">Нет добавленных направлений</div>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {Object.entries(grouped).map(([city, dirs]) => (
            <button
              key={city}
              onClick={() => setSelectedCity(city)}
              className="bg-card rounded-2xl border border-border p-5 text-left hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center gap-2 mb-2">
                <MapPin className="w-4 h-4 text-primary" />
                <span className="text-sm font-semibold text-foreground">{city}</span>
              </div>
              <span className="text-xs text-muted-foreground">
                {dirs.length} {dirs.length === 1 ? "направление" : "направлений"}
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* Modal for selected city */}
      <Dialog open={!!selectedCity} onOpenChange={(open) => !open && setSelectedCity(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MapPin className="w-5 h-5 text-primary" />
              {selectedCity}
            </DialogTitle>
            <DialogDescription>
              Дочерние направления — смена разрешена даже при статусе «Груз в пути»
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 mt-2">
            {/* List of child directions */}
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {selectedDirs.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">→</span>
                    <span className="text-sm text-foreground">{d.child_city}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(d.id, d.parent_city, d.child_city)}
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
              {selectedDirs.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">Нет направлений</p>
              )}
            </div>

            {/* Import from Excel */}
            <div className="flex gap-2 pt-2 border-t border-border">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={handleExcelImport}
              />
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl gap-1.5 w-full"
                disabled={importing}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="w-4 h-4" />
                {importing ? "Импорт..." : "Импорт из Excel"}
              </Button>
            </div>

            {/* Add by region */}
            <div className="flex gap-2 pt-2 border-t border-border items-end">
              <div className="flex-1">
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Добавить по области</label>
                <Select value={selectedRegion} onValueChange={setSelectedRegion}>
                  <SelectTrigger className="rounded-xl text-sm h-9">
                    <SelectValue placeholder={loadingRegions ? "Загрузка..." : "Выберите область"} />
                  </SelectTrigger>
                  <SelectContent className="max-h-64">
                    {regions.map((r) => (
                      <SelectItem key={r} value={r} className="text-sm">{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={handleAddByRegion}
                disabled={addingRegion || !selectedRegion}
                size="sm"
                variant="outline"
                className="rounded-xl gap-1 h-9"
              >
                <Globe className="w-4 h-4" />
                {addingRegion ? "Добавление..." : "Добавить"}
              </Button>
            </div>

            {/* Add child within modal */}
            <div className="flex gap-2 pt-2 border-t border-border">
              <CityAutocomplete
                value={newChild}
                onChange={setNewChild}
                placeholder="Новое направление"
                onKeyDown={(e) =>
                  e.key === "Enter" && selectedCity && handleAdd(selectedCity, newChild, () => setNewChild(""))
                }
              />
              <Button
                onClick={() => selectedCity && handleAdd(selectedCity, newChild, () => setNewChild(""))}
                disabled={addDirection.isPending}
                size="sm"
                className="rounded-xl gap-1"
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>

            {/* Delete parent with all children */}
            <div className="pt-2 border-t border-border">
              <Button
                variant="destructive"
                size="sm"
                className="rounded-xl gap-1.5 w-full"
                disabled={deleteByParent.isPending}
                onClick={() => selectedCity && handleDeleteParent(selectedCity)}
              >
                <Trash2 className="w-4 h-4" />
                Удалить направление со всеми дочерними
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AllowedDirections;
