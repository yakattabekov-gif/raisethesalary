import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Search, Warehouse, Trash2, RefreshCw, Plus, MapPin } from "lucide-react";

type WarehouseRow = {
  id: number;
  city_id: number;
  city_name: string;
  address: string;
  latitude: number;
  longitude: number;
  name: string | null;
};

const useWarehouses = () =>
  useQuery({
    queryKey: ["warehouses"],
    queryFn: async () => {
      const all: WarehouseRow[] = [];
      let from = 0;
      const pageSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("warehouses")
          .select("*")
          .order("city_name")
          .range(from, from + pageSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...(data as WarehouseRow[]));
        if (data.length < pageSize) break;
        from += pageSize;
      }
      return all;
    },
    staleTime: 1000 * 60 * 10,
  });

const useDeleteWarehouse = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase.from("warehouses").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["warehouses"] }),
  });
};

const useAddWarehouse = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (wh: WarehouseRow) => {
      const { error } = await supabase.from("warehouses").upsert(wh);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["warehouses"] }),
  });
};

const Warehouses = () => {
  const { data: warehouses, isLoading } = useWarehouses();
  const deleteWh = useDeleteWarehouse();
  const addWh = useAddWarehouse();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [syncing, setSyncing] = useState(false);

  // Add form
  const [newId, setNewId] = useState("");
  const [newCityId, setNewCityId] = useState("");
  const [newCityName, setNewCityName] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newLat, setNewLat] = useState("");
  const [newLng, setNewLng] = useState("");
  const [newName, setNewName] = useState("");

  const filtered = useMemo(() => {
    if (!warehouses) return [];
    if (!search.trim()) return warehouses;
    const q = search.toLowerCase();
    return warehouses.filter(
      (w) =>
        w.city_name.toLowerCase().includes(q) ||
        w.address.toLowerCase().includes(q) ||
        (w.name || "").toLowerCase().includes(q) ||
        String(w.id).includes(q) ||
        String(w.city_id).includes(q)
    );
  }, [warehouses, search]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("sync-warehouses");
      if (error) throw error;
      const result = data as any;
      if (result?.error) throw new Error(result.error);
      toast.success(`Синхронизация завершена: ${result?.synced || 0} складов загружено`);
      qc.invalidateQueries({ queryKey: ["warehouses"] });
    } catch (e: any) {
      toast.error("Ошибка синхронизации: " + (e.message || "неизвестная ошибка"));
    } finally {
      setSyncing(false);
    }
  };

  const handleAdd = async () => {
    const id = parseInt(newId);
    const cityId = parseInt(newCityId);
    const lat = parseFloat(newLat);
    const lng = parseFloat(newLng);
    if (!id || !cityId || !newCityName.trim() || !newAddress.trim() || isNaN(lat) || isNaN(lng)) {
      return toast.error("Заполните все обязательные поля");
    }
    try {
      await addWh.mutateAsync({
        id, city_id: cityId, city_name: newCityName.trim(),
        address: newAddress.trim(), latitude: lat, longitude: lng,
        name: newName.trim() || null,
      });
      toast.success("Склад добавлен");
      setNewId(""); setNewCityId(""); setNewCityName(""); setNewAddress(""); setNewLat(""); setNewLng(""); setNewName("");
    } catch (e: any) {
      toast.error(e.message || "Ошибка");
    }
  };

  if (isLoading) return <div className="py-16 text-center text-muted-foreground">Загрузка...</div>;

  return (
    <div className="space-y-8 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold text-foreground tracking-tight">Склады</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Справочник складов — {warehouses?.length || 0} записей
          </p>
        </div>
        <Button onClick={handleSync} disabled={syncing} variant="outline" className="rounded-xl gap-1.5">
          <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Синхронизация..." : "Синхронизировать из Spark"}
        </Button>
      </div>

      {/* Add warehouse */}
      <section className="bg-card rounded-2xl border border-border p-6 space-y-4">
        <h2 className="text-sm font-semibold text-foreground">Добавить склад вручную</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">ID *</label>
            <Input value={newId} onChange={(e) => setNewId(e.target.value)} placeholder="123" className="text-sm rounded-xl" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Название</label>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Склад Алматы" className="text-sm rounded-xl" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">City ID *</label>
            <Input value={newCityId} onChange={(e) => setNewCityId(e.target.value)} placeholder="1" className="text-sm rounded-xl" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Город *</label>
            <Input value={newCityName} onChange={(e) => setNewCityName(e.target.value)} placeholder="Алматы" className="text-sm rounded-xl" />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <div className="space-y-1 md:col-span-1">
            <label className="text-xs font-medium text-muted-foreground">Широта *</label>
            <Input value={newLat} onChange={(e) => setNewLat(e.target.value)} placeholder="43.259786" className="text-sm rounded-xl" />
          </div>
          <div className="space-y-1 md:col-span-1">
            <label className="text-xs font-medium text-muted-foreground">Долгота *</label>
            <Input value={newLng} onChange={(e) => setNewLng(e.target.value)} placeholder="76.894765" className="text-sm rounded-xl" />
          </div>
          <div className="space-y-1 md:col-span-1">
            <label className="text-xs font-medium text-muted-foreground">Адрес *</label>
            <Input value={newAddress} onChange={(e) => setNewAddress(e.target.value)} placeholder="г. Алматы, ул. ..." className="text-sm rounded-xl" />
          </div>
        </div>
        <Button onClick={handleAdd} disabled={addWh.isPending} size="sm" className="rounded-xl gap-1.5">
          <Plus className="w-4 h-4" /> Добавить
        </Button>
      </section>

      {/* Search + List */}
      <section className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по городу, адресу или ID..." className="pl-9 text-sm rounded-xl" />
        </div>

        <div className="bg-card rounded-2xl border border-border divide-y divide-border max-h-[500px] overflow-y-auto">
          {filtered.length === 0 && (
            <div className="text-center py-8 text-muted-foreground text-sm">
              {warehouses?.length === 0 ? "Нет складов. Нажмите «Синхронизировать из Spark» чтобы загрузить." : "Ничего не найдено"}
            </div>
          )}
          {filtered.slice(0, 200).map((w) => (
            <div key={w.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors">
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <Warehouse className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{w.name || `Склад #${w.id}`}</span>
                    <span className="text-xs text-muted-foreground">#{w.id}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    <span className="font-medium">{w.city_name}</span> (city_id: {w.city_id})
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                    <MapPin className="w-3 h-3" />
                    {w.address}
                  </div>
                  <div className="text-[10px] text-muted-foreground/70 mt-0.5">
                    {w.latitude.toFixed(6)}, {w.longitude.toFixed(6)}
                  </div>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => deleteWh.mutate(w.id)} className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive shrink-0">
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

export default Warehouses;
