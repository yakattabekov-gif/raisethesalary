export interface SparkCity {
  id: number;
  name: string;
}

export async function loadAllSparkCities(supabase: any): Promise<SparkCity[]> {
  const allCities: SparkCity[] = [];
  let from = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from("spark_cities")
      .select("id, name")
      .order("id")
      .range(from, from + pageSize - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    allCities.push(...data);

    if (data.length < pageSize) break;
    from += pageSize;
  }

  return allCities;
}