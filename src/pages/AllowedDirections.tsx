import { useState, useMemo } from "react";
import { useAllowedDirections, useAddDirection, useDeleteDirection } from "@/hooks/useAllowedDirections";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Plus, Trash2, MapPin, ChevronDown, ChevronRight } from "lucide-react";

const AllowedDirections = () => {
  const { data: directions, isLoading } = useAllowedDirections();
  const addDirection = useAddDirection();
  const deleteDirection = useDeleteDirection();

  const [parentCity, setParentCity] = useState("");
  const [childCity, setChildCity] = useState("");
  const [expandedCities, setExpandedCities] = useState<Set<string>>(new Set());

  const grouped = useMemo(() => {
    if (!directions) return {};
    const map: Record<string, typeof directions> = {};
    directions.forEach((d) => {
      if (!map[d.parent_city]) map[d.parent_city] = [];
      map[d.parent_city].push(d);
    });
    return map;
  }, [directions]);

  const toggleCity = (city: string) => {
    setExpandedCities((prev) => {
      const next = new Set(prev);
      next.has(city) ? next.delete(city) : next.add(city);
      return next;
    });
  };

  const handleAdd = async () => {
    const p = parentCity.trim();
    const c = childCity.trim();
    if (!p || !c) return toast.error("Заполните оба поля");
    try {
      await addDirection.mutateAsync({ parent_city: p, child_city: c });
      toast.success(`Добавлено: ${p} → ${c}`);
      setChildCity("");
      setExpandedCities((prev) => new Set(prev).add(p));
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

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-3xl font-extrabold text-foreground tracking-tight">Разрешённые направления</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Направления, по которым разрешена смена даже при статусе «Груз в пути»
        </p>
      </div>

      {/* Add form */}
      <section className="bg-card rounded-2xl border border-border p-6 space-y-4">
        <h2 className="text-sm font-semibold text-foreground">Добавить направление</h2>
        <div className="flex gap-2 items-end">
          <div className="flex-1 space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Основной город</label>
            <Input
              value={parentCity}
              onChange={(e) => setParentCity(e.target.value)}
              placeholder="Алматы"
              className="text-sm rounded-xl"
            />
          </div>
          <div className="flex-1 space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Направление</label>
            <Input
              value={childCity}
              onChange={(e) => setChildCity(e.target.value)}
              placeholder="Астана"
              className="text-sm rounded-xl"
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            />
          </div>
          <Button
            onClick={handleAdd}
            disabled={addDirection.isPending}
            size="sm"
            className="h-10 rounded-xl gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Добавить
          </Button>
        </div>
      </section>

      {/* Directions list */}
      <section className="space-y-3">
        {Object.keys(grouped).length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-sm">Нет добавленных направлений</div>
        )}
        {Object.entries(grouped).map(([city, dirs]) => {
          const isExpanded = expandedCities.has(city);
          return (
            <div key={city} className="bg-card rounded-2xl border border-border overflow-hidden">
              <button
                onClick={() => toggleCity(city)}
                className="w-full flex items-center justify-between px-6 py-4 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <MapPin className="w-4 h-4 text-primary" />
                  <span className="text-sm font-semibold text-foreground">{city}</span>
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                    {dirs.length}
                  </span>
                </div>
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                )}
              </button>
              {isExpanded && (
                <div className="border-t border-border">
                  {dirs.map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center justify-between px-6 py-3 border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">→</span>
                        <span className="text-sm text-foreground">{d.child_city}</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(d.id, d.parent_city, d.child_city)}
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
};

export default AllowedDirections;
