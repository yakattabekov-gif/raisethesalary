import { useState, useMemo } from "react";
import { useAllowedDirections, useAddDirection, useDeleteDirection } from "@/hooks/useAllowedDirections";
import { Button } from "@/components/ui/button";
import CityAutocomplete from "@/components/CityAutocomplete";
import { toast } from "sonner";
import { Plus, Trash2, MapPin, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const AllowedDirections = () => {
  const { data: directions, isLoading } = useAllowedDirections();
  const addDirection = useAddDirection();
  const deleteDirection = useDeleteDirection();

  const [parentCity, setParentCity] = useState("");
  const [childCity, setChildCity] = useState("");
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [newChild, setNewChild] = useState("");

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
          <div className="flex-1 space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Направление</label>
            <CityAutocomplete
              value={childCity}
              onChange={setChildCity}
              placeholder="Байсерке"
              onKeyDown={(e) => e.key === "Enter" && handleAdd(parentCity, childCity, () => setChildCity(""))}
            />
          </div>
          <Button
            onClick={() => handleAdd(parentCity, childCity, () => setChildCity(""))}
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
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AllowedDirections;
