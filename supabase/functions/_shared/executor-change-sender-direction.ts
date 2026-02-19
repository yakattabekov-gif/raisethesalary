import { VERSION, normalizePhone, searchInvoice, getLogisticsInfo, checkSenderStatusAllowed, levenshtein, normalizeCityName, stripCityFromAddress } from "./helpers.ts";

export async function executeChangeSenderDirection(
  supabase: any, settings: Record<string, string>, aiResult: any, taskId: string, dryRun: boolean
) {
  const results = [];
  const sparkUrl = settings.spark_base_url || "https://gateway.spark-dev.team/cabinet/api/v2";
  const sparkToken = settings.spark_bearer_token;
  const invoices = aiResult.invoices || [];
  let targetCity = aiResult.city;

  if (!targetCity) {
    return [{ invoice: "N/A", success: false, error: "Город отправителя не указан" }];
  }

  // Parse city pairs
  const separators = [" - ", " – ", " — ", "-"];
  for (const sep of separators) {
    if (targetCity.includes(sep)) {
      const parts = targetCity.split(sep).map((p: string) => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        console.log(`[${VERSION}] Sender city pair: "${targetCity}" → taking: "${parts[parts.length - 1]}"`);
        targetCity = parts[parts.length - 1];
      }
      break;
    }
  }

  // Fuzzy city lookup
  const { data: allCities } = await supabase.from("spark_cities").select("id, name");
  if (!allCities || allCities.length === 0) {
    return invoices.map((inv: string) => ({ invoice: inv, success: false, error: "Справочник городов пуст" }));
  }

  const normalizedTarget = normalizeCityName(targetCity);

  let bestMatch: any = null;
  let bestScore = Infinity;
  for (const city of allCities) {
    const normalizedName = normalizeCityName(city.name);
    if (normalizedName === normalizedTarget) { bestMatch = city; bestScore = 0; break; }
    const dist = levenshtein(normalizedTarget, normalizedName);
    const maxLen = Math.max(normalizedTarget.length, normalizedName.length);
    const similarity = 1 - dist / maxLen;
    if (similarity > 0.6 && dist < bestScore) { bestScore = dist; bestMatch = city; }
  }

  if (!bestMatch) {
    await supabase.from("execution_logs").insert({
      task_id: taskId, action: "change_sender_direction", step: "city_lookup",
      success: false, error_message: `Город отправителя "${targetCity}" не найден в справочнике`,
    });
    return invoices.map((inv: string) => ({ invoice: inv, success: false, error: `Город "${targetCity}" не найден` }));
  }

  const cityId = bestMatch.id;
  const cityName = bestMatch.name;
  console.log(`[${VERSION}] Sender direction city match: "${targetCity}" → id=${cityId}, name="${cityName}"`);

  await supabase.from("execution_logs").insert({
    task_id: taskId, action: "change_sender_direction", step: "city_lookup",
    request_data: { requested_city: targetCity },
    response_data: { city_id: cityId, city_name: cityName }, success: true,
  });

  for (const invoice of invoices) {
    try {
      // 1. Status check (225 must be "waiting")
      const statusCheck = await checkSenderStatusAllowed(invoice, sparkToken, supabase, taskId, "change_sender_direction");
      if (!statusCheck.allowed) {
        results.push({ invoice, success: false, error: statusCheck.error });
        continue;
      }

      // 2. Search for invoice
      const item = await searchInvoice(sparkUrl, sparkToken, invoice);
      const orderId = item.order_id;
      if (!orderId) throw new Error("order_id not found in logistics-info");

      // 3. GET full logistics-info for sender data
      const logisticsInfo = await getLogisticsInfo(sparkUrl, sparkToken, item.id);
      const sender = logisticsInfo.sender || {};
      if (!sender?.id) throw new Error("Sender not found in logistics-info");

      // 4. Geocode sender address in new city
      const newAddress = aiResult.address;
      const newSenderData = aiResult.sender;
      let currentStreet = newAddress?.street || stripCityFromAddress(sender.street || "", allCities);
      const currentHouse = newAddress?.house || sender.house || "";
      let newFullAddress = newAddress?.full_address || stripCityFromAddress(sender.full_address || "", allCities);
      let newLatitude = sender.latitude != null ? Number(sender.latitude) : null;
      let newLongitude = sender.longitude != null ? Number(sender.longitude) : null;

      const yandexApiKey = settings.yandex_geocoder_api_key;
      if (yandexApiKey && (currentStreet || currentHouse)) {
        const geoQuery = `${cityName}, ${currentStreet} ${currentHouse}`.trim();
        console.log(`[${VERSION}] Geocoding sender in new city: "${geoQuery}"`);
        try {
          const geoResp = await fetch(
            `https://geocode-maps.yandex.ru/1.x?apikey=${encodeURIComponent(yandexApiKey)}&lang=ru_RU&format=json&geocode=${encodeURIComponent(geoQuery)}`
          );
          const geoData = await geoResp.json();
          const geoMember = geoData?.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject;
          const pos = geoMember?.Point?.pos;
          if (pos) {
            const [lon, lat] = pos.split(" ").map(Number);
            newLatitude = lat;
            newLongitude = lon;
            const formattedAddr = geoMember?.metaDataProperty?.GeocoderMetaData?.text || "";
            if (formattedAddr) newFullAddress = formattedAddr;
          }
          await supabase.from("execution_logs").insert({
            task_id: taskId, action: "change_sender_direction", step: "geocoding_new_city",
            request_data: { query: geoQuery },
            response_data: geoMember ? { pos, formatted: geoMember?.metaDataProperty?.GeocoderMetaData?.text } : { error: "No results" },
            success: !!geoMember,
          });
        } catch (geoErr: any) {
          console.warn(`[${VERSION}] Sender geocoding failed: ${geoErr.message}`);
        }
      }

      // Fallback: city center
      if (newLatitude == null || newLongitude == null) {
        console.warn(`[${VERSION}] WARNING: lat/lng still null after geocoding, attempting city-level geocode`);
        if (yandexApiKey) {
          try {
            const cityGeoResp = await fetch(
              `https://geocode-maps.yandex.ru/1.x?apikey=${encodeURIComponent(yandexApiKey)}&lang=ru_RU&format=json&geocode=${encodeURIComponent(cityName)}`
            );
            const cityGeoData = await cityGeoResp.json();
            const cityPos = cityGeoData?.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject?.Point?.pos;
            if (cityPos) {
              const [lon, lat] = cityPos.split(" ").map(Number);
              newLatitude = lat;
              newLongitude = lon;
              console.log(`[${VERSION}] Using city center coords: lat=${lat}, lng=${lon}`);
            }
          } catch (_) {}
        }
      }

      // 5. Build PUT payload
      const senderTitle = newSenderData?.full_name || sender.title;
      const senderEntity = newSenderData?.entity || newSenderData?.full_name || sender.entity || sender.title;
      const senderFullName = newSenderData?.full_name || sender.full_name;
      const senderPhone = newSenderData?.phone ? normalizePhone(newSenderData.phone) : sender.phone;
      const senderAdditionalPhone = newSenderData?.additional_phone ? normalizePhone(newSenderData.additional_phone) : (sender.additional_phone || null);

      const updatePayload: any = {
        title: senderTitle,
        entity: senderEntity,
        full_name: senderFullName,
        phone: senderPhone,
        additional_phone: senderAdditionalPhone,
        city_id: Number(cityId),
        latitude: newLatitude,
        longitude: newLongitude,
        street: currentStreet,
        house: currentHouse,
        full_address: newFullAddress,
        comment: sender.comment || null,
        office: sender.office || null,
        index: sender.index ? String(sender.index).substring(0, 10) : null,
        company_id: sender.company_id || null,
        id: sender.id,
        warehouse_id: null,
      };

      const beforeCity = sender.city?.name || sender.city_id;

      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "change_sender_direction", step: "before_after",
        request_data: { before_city: beforeCity, before_city_id: sender.city_id },
        response_data: { after_city: cityName, after_city_id: cityId, after_address: newFullAddress }, success: true,
      });

      if (dryRun) {
        results.push({ invoice, success: true, dry_run: true, city: cityName, before_city: beforeCity });
        continue;
      }

      // 6. PUT to /senders/{sender.id}
      console.log(`[${VERSION}] PUT /senders/${sender.id} sender direction: city_id=${cityId} (${cityName})`);
      const updateResp = await fetch(`${sparkUrl}/senders/${sender.id}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${sparkToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(updatePayload),
      });

      if (!updateResp.ok) {
        const errBody = await updateResp.text().catch(() => "");
        throw new Error(`Update sender direction failed: ${updateResp.status} - ${errBody.substring(0, 300)}`);
      }

      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "change_sender_direction", step: "update_sender_direction_api",
        request_data: { order_id: orderId, new_city_id: cityId },
        response_data: { status: updateResp.status }, success: true,
      });

      results.push({ invoice, success: true, city: cityName, before: { city: beforeCity }, after: { city: cityName } });
    } catch (e: any) {
      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "change_sender_direction", step: "error",
        success: false, error_message: e.message, request_data: { invoice },
      });
      results.push({ invoice, success: false, error: e.message });
    }
  }
  return results;
}
