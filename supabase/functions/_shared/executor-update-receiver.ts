import { VERSION, normalizePhone, searchInvoice, getLogisticsInfo, checkOrderRestored } from "./helpers.ts";

export async function executeUpdateReceiver(
  supabase: any, settings: Record<string, string>, aiResult: any, taskId: string, dryRun: boolean
) {
  const results = [];
  const sparkUrl = settings.spark_base_url || "https://gateway.spark-dev.team/cabinet/api/v2";
  const sparkToken = settings.spark_bearer_token;
  const invoices = aiResult.invoices || [];
  const newAddress = aiResult.address;
  const newReceiver = aiResult.receiver;

  for (const invoice of invoices) {
    try {
      const item = await searchInvoice(sparkUrl, sparkToken, invoice);

      // Check if order is cancelled
      const orderStatus = item.status?.name || item.status || "";
      const orderStatusCode = item.status?.code || null;
      const isCancelledStatus = orderStatus.toLowerCase().includes("отмен") || orderStatus.toLowerCase().includes("cancel") || orderStatusCode === 503;

      if (isCancelledStatus) {
        const isRestored = await checkOrderRestored(invoice, sparkToken);
        if (!isRestored) {
          console.log(`[${VERSION}] Skipping update for ${invoice}: order already cancelled (status: ${orderStatus})`);
          results.push({ invoice, success: false, error: `Заказ уже отменён (статус: ${orderStatus})` });
          continue;
        }
        console.log(`[${VERSION}] Order ${invoice} was cancelled but RESTORED (code 233) — proceeding with update`);
      }

      const logisticsInfo = await getLogisticsInfo(sparkUrl, sparkToken, item.id);

      // Also check status from full logistics-info
      const fullStatus = logisticsInfo.status?.name || logisticsInfo.status || "";
      const isFullCancelled = fullStatus.toLowerCase().includes("отмен") || fullStatus.toLowerCase().includes("cancel");
      if (isFullCancelled && !isCancelledStatus) {
        const isRestored = await checkOrderRestored(invoice, sparkToken);
        if (!isRestored) {
          results.push({ invoice, success: false, error: `Заказ уже отменён (статус: ${fullStatus})` });
          continue;
        }
      }

      const receiver = logisticsInfo.receiver || logisticsInfo;
      if (!receiver?.id) throw new Error("Receiver not found in full logistics-info");

      const receiverCity = receiver.city?.name || receiver.city || "";
      console.log(`[${VERSION}] Full receiver: id=${receiver.id}, city="${receiverCity}", title="${receiver.title}", phone="${receiver.phone}"`);

      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "update_receiver", step: "get_full_logistics_info",
        request_data: { invoice, logistics_info_id: item.id },
        response_data: { receiver_id: receiver.id, city: receiverCity, title: receiver.title, full_name: receiver.full_name, phone: receiver.phone, city_id: receiver.city_id, latitude: receiver.latitude, longitude: receiver.longitude },
        success: true,
      });

      // Build update payload
      const updatePayload: any = {
        title: receiver.title,
        entity: receiver.entity || receiver.title,
        full_name: receiver.full_name,
        phone: normalizePhone(receiver.phone),
        additional_phone: normalizePhone(receiver.phone),
        city_id: typeof receiver.city_id === 'number' ? receiver.city_id : Number(receiver.city_id),
        latitude: receiver.latitude != null ? Number(receiver.latitude) : null,
        longitude: receiver.longitude != null ? Number(receiver.longitude) : null,
        street: receiver.street || "",
        house: receiver.house || "",
        full_address: receiver.full_address || "",
        flat: receiver.flat || "",
        comment: receiver.comment || null,
        office: receiver.office || null,
        company_id: receiver.company_id || null,
        id: receiver.id,
        sender_id: receiver.sender_id || null,
        warehouse_id: receiver.warehouse_id || null,
      };
      if (receiver.index) {
        updatePayload.index = String(receiver.index).substring(0, 10);
      }

      const beforeState: any = {};
      const afterState: any = {};

      // Handle address change
      if (newAddress) {
        // IMPORTANT: update_receiver NEVER changes city. City changes go through change_direction.
        // Always use the current receiver city for geocoding.
        const effectiveCity = receiverCity;

        if (newAddress.city && newAddress.city.toLowerCase() !== receiverCity.toLowerCase()) {
          console.log(`[${VERSION}] update_receiver: IGNORING city change "${receiverCity}" -> "${newAddress.city}" for ${invoice} — city changes must go through change_direction`);
        }

        const yandexApiKey = settings.yandex_geocoder_api_key;
        if (!yandexApiKey) throw new Error("Yandex Geocoder API key not configured");

        const geoQuery = `${effectiveCity}, ${newAddress.street} ${newAddress.house}`;
        const geoResp = await fetch(
          `https://geocode-maps.yandex.ru/1.x?apikey=${encodeURIComponent(yandexApiKey)}&lang=ru_RU&format=json&geocode=${encodeURIComponent(geoQuery)}`,
          { headers: { "User-Agent": "Mozilla/5.0 (compatible; spark-bot/1.0)", Authorization: `Bearer ${sparkToken}` } }
        );
        const geoData = await geoResp.json();
        const geoMember = geoData?.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject;
        const pos = geoMember?.Point?.pos;
        let latitude: number | null = null;
        let longitude: number | null = null;
        if (pos) {
          const [lon, lat] = pos.split(" ").map(Number);
          latitude = lat;
          longitude = lon;
        }

        await supabase.from("execution_logs").insert({
          task_id: taskId, action: "update_receiver", step: "geocoding_yandex",
          request_data: { query: geoQuery },
          response_data: geoMember ? { pos, formatted: geoMember.metaDataProperty?.GeocoderMetaData?.text } : { error: "No results" },
          success: !!geoMember,
        });

        // Use geocoder's formatted address instead of AI-generated one (AI may put street in city field)
        const geocoderFormattedAddress = geoMember?.metaDataProperty?.GeocoderMetaData?.text || null;
        const finalFullAddress = geocoderFormattedAddress || `${effectiveCity}, ${newAddress.street} ${newAddress.house}`;

        beforeState.street = receiver.street;
        beforeState.house = receiver.house;
        beforeState.full_address = receiver.full_address;
        if (latitude !== null) updatePayload.latitude = latitude;
        if (longitude !== null) updatePayload.longitude = longitude;
        updatePayload.street = newAddress.street;
        updatePayload.house = newAddress.house;
        updatePayload.full_address = finalFullAddress;
        afterState.street = newAddress.street;
        afterState.house = newAddress.house;
        afterState.full_address = finalFullAddress;
      }

      // Handle name/phone change
      if (newReceiver) {
        if (newReceiver.full_name) {
          beforeState.full_name = receiver.full_name;
          beforeState.entity = receiver.entity;
          updatePayload.full_name = newReceiver.full_name;
          updatePayload.title = newReceiver.full_name;
          updatePayload.entity = newReceiver.entity || newReceiver.full_name;
          afterState.full_name = newReceiver.full_name;
          afterState.entity = updatePayload.entity;
        }
        if (newReceiver.entity && !newReceiver.full_name) {
          beforeState.entity = receiver.entity;
          updatePayload.entity = newReceiver.entity;
          updatePayload.title = newReceiver.entity;
          updatePayload.full_name = newReceiver.entity;
          afterState.entity = newReceiver.entity;
          afterState.full_name = newReceiver.entity;
        }
        if (newReceiver.phone) {
          beforeState.phone = receiver.phone;
          const normalizedPhone = normalizePhone(newReceiver.phone);
          updatePayload.phone = normalizedPhone;
          afterState.phone = normalizedPhone;
          console.log(`[${VERSION}] Phone normalized: "${newReceiver.phone}" → "${normalizedPhone}"`);
        }
        if (newReceiver.additional_phone) {
          beforeState.additional_phone = receiver.additional_phone || null;
          const normalizedAdditionalPhone = normalizePhone(newReceiver.additional_phone);
          if (newReceiver.phone && normalizedAdditionalPhone === normalizePhone(newReceiver.phone) && receiver.phone) {
            const oldPhone = normalizePhone(receiver.phone);
            updatePayload.additional_phone = oldPhone;
            afterState.additional_phone = oldPhone;
            console.log(`[${VERSION}] additional_phone same as new phone — using OLD phone "${oldPhone}" as additional`);
          } else {
            updatePayload.additional_phone = normalizedAdditionalPhone;
            afterState.additional_phone = normalizedAdditionalPhone;
          }
        }
      }

      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "update_receiver", step: "before_after",
        request_data: { before: beforeState },
        response_data: { after: afterState }, success: true,
      });

      if (dryRun) {
        results.push({ invoice, success: true, dry_run: true, before: beforeState, after: afterState });
        continue;
      }

      console.log(`[${VERSION}] PUT /receivers/${receiver.id} payload:`, JSON.stringify(updatePayload));
      const updateResp = await fetch(`${sparkUrl}/receivers/${receiver.id}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${sparkToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(updatePayload),
      });

      if (!updateResp.ok) {
        const errBody = await updateResp.text().catch(() => "");
        console.error(`[${VERSION}] Update receiver failed: ${updateResp.status}, payload: ${JSON.stringify(updatePayload)}, body: ${errBody.substring(0, 500)}`);
        throw new Error(`Update receiver failed: ${updateResp.status} - ${errBody.substring(0, 300)}`);
      }

      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "update_receiver", step: "update_receiver_api",
        request_data: { endpoint: `PUT ${sparkUrl}/receivers/${receiver.id}`, body: updatePayload },
        response_data: { status: updateResp.status }, success: true,
      });

      results.push({ invoice, success: true, before: beforeState, after: afterState });
    } catch (e: any) {
      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "update_receiver", step: "error",
        success: false, error_message: e.message, request_data: { invoice },
      });
      results.push({ invoice, success: false, error: e.message });
    }
  }
  return results;
}
