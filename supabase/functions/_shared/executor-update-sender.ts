import { VERSION, normalizePhone, searchInvoice, getLogisticsInfo, checkSenderStatusAllowed } from "./helpers.ts";

export async function executeUpdateSender(
  supabase: any, settings: Record<string, string>, aiResult: any, taskId: string, dryRun: boolean
) {
  const results = [];
  const sparkUrl = settings.spark_base_url || "https://gateway.spark-dev.team/cabinet/api/v2";
  const sparkToken = settings.spark_bearer_token;
  const invoices = aiResult.invoices || [];
  const newAddress = aiResult.address;
  const newSender = aiResult.sender;

  for (const invoice of invoices) {
    try {
      // 1. Status check
      const statusCheck = await checkSenderStatusAllowed(invoice, sparkToken, supabase, taskId, "update_sender");
      if (!statusCheck.allowed) {
        results.push({ invoice, success: false, error: statusCheck.error });
        continue;
      }

      // 2. Search invoice
      const item = await searchInvoice(sparkUrl, sparkToken, invoice);
      const orderId = item.order_id;
      if (!orderId) throw new Error("order_id not found in logistics-info search result");

      // 3. Get full logistics-info
      const logisticsInfo = await getLogisticsInfo(sparkUrl, sparkToken, item.id);
      const sender = logisticsInfo.sender || {};
      if (!sender?.id) throw new Error("Sender not found in logistics-info");

      const senderCity = sender.city?.name || sender.city || "";
      console.log(`[${VERSION}] Sender: id=${sender.id}, order_id=${orderId}, city="${senderCity}", title="${sender.title}", phone="${sender.phone}"`);

      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "update_sender", step: "get_sender_info",
        request_data: { invoice, logistics_info_id: item.id, order_id: orderId },
        response_data: { sender_id: sender.id, city: senderCity, title: sender.title, full_name: sender.full_name, phone: sender.phone },
        success: true,
      });

      // 4. Build update payload
      const senderCityId = typeof sender.city_id === 'number' ? sender.city_id
        : (sender.city?.id ? Number(sender.city.id) : Number(sender.city_id));

      const updatePayload: any = {
        title: sender.title,
        entity: sender.entity || sender.title,
        full_name: sender.full_name,
        phone: sender.phone,
        additional_phone: sender.additional_phone || null,
        city_id: senderCityId,
        latitude: sender.latitude != null ? Number(sender.latitude) : null,
        longitude: sender.longitude != null ? Number(sender.longitude) : null,
        street: sender.street || "",
        house: sender.house || "",
        full_address: sender.full_address || "",
        comment: sender.comment || null,
        office: sender.office || null,
        company_id: sender.company_id || null,
        id: sender.id,
        warehouse_id: null,
      };
      if (sender.index) {
        updatePayload.index = String(sender.index).substring(0, 10);
      } else {
        updatePayload.index = null;
      }

      // If existing lat/lng are null, geocode using existing address
      if (updatePayload.latitude == null || updatePayload.longitude == null) {
        const yandexApiKey = settings.yandex_geocoder_api_key;
        if (yandexApiKey && (sender.street || sender.full_address)) {
          const existingGeoQuery = `${senderCity}, ${sender.street || ""} ${sender.house || ""}`.trim();
          console.log(`[${VERSION}] Geocoding existing sender address (lat/lng were null): "${existingGeoQuery}"`);
          try {
            const geoResp = await fetch(
              `https://geocode-maps.yandex.ru/1.x?apikey=${encodeURIComponent(yandexApiKey)}&lang=ru_RU&format=json&geocode=${encodeURIComponent(existingGeoQuery)}`
            );
            const geoData = await geoResp.json();
            const geoMember = geoData?.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject;
            const pos = geoMember?.Point?.pos;
            if (pos) {
              const [lon, lat] = pos.split(" ").map(Number);
              updatePayload.latitude = lat;
              updatePayload.longitude = lon;
              console.log(`[${VERSION}] Resolved existing sender coords: lat=${lat}, lng=${lon}`);
            }
          } catch (geoErr: any) {
            console.warn(`[${VERSION}] Geocoding existing sender address failed: ${geoErr.message}`);
          }
        }
      }

      const beforeState: any = {};
      const afterState: any = {};

      // 5. Handle address change
      if (newAddress) {
        const requestedCity = newAddress.city || null;
        const effectiveCity = requestedCity || senderCity;

        if (requestedCity && senderCity && requestedCity.toLowerCase() !== senderCity.toLowerCase()) {
          const error = `Город не совпадает: запрос="${requestedCity}" vs отправитель="${senderCity}". Обновление отклонено.`;
          await supabase.from("execution_logs").insert({
            task_id: taskId, action: "update_sender", step: "city_check",
            success: false, error_message: error,
          });
          results.push({ invoice, success: false, error });
          continue;
        }

        const yandexApiKey = settings.yandex_geocoder_api_key;
        if (!yandexApiKey) throw new Error("Yandex Geocoder API key not configured");

        const geoQuery = `${effectiveCity}, ${newAddress.street} ${newAddress.house}`;
        const geoResp = await fetch(
          `https://geocode-maps.yandex.ru/1.x?apikey=${encodeURIComponent(yandexApiKey)}&lang=ru_RU&format=json&geocode=${encodeURIComponent(geoQuery)}`
        );
        const geoData = await geoResp.json();
        const geoMember = geoData?.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject;
        const pos = geoMember?.Point?.pos;
        if (pos) {
          const [lon, lat] = pos.split(" ").map(Number);
          updatePayload.latitude = lat;
          updatePayload.longitude = lon;
        }

        await supabase.from("execution_logs").insert({
          task_id: taskId, action: "update_sender", step: "geocoding_yandex",
          request_data: { query: geoQuery },
          response_data: geoMember ? { pos, formatted: geoMember?.metaDataProperty?.GeocoderMetaData?.text } : { error: "No results" },
          success: !!geoMember,
        });

        beforeState.street = sender.street;
        beforeState.house = sender.house;
        beforeState.full_address = sender.full_address;
        updatePayload.street = newAddress.street;
        updatePayload.house = newAddress.house;
        updatePayload.full_address = newAddress.full_address;
        afterState.street = newAddress.street;
        afterState.house = newAddress.house;
        afterState.full_address = newAddress.full_address;
      }

      // 6. Handle name/phone change
      if (newSender) {
        if (newSender.full_name) {
          beforeState.full_name = sender.full_name;
          beforeState.entity = sender.entity;
          updatePayload.full_name = newSender.full_name;
          updatePayload.title = newSender.full_name;
          updatePayload.entity = newSender.entity || newSender.full_name;
          afterState.full_name = newSender.full_name;
          afterState.entity = updatePayload.entity;
        }
        if (newSender.entity && !newSender.full_name) {
          beforeState.entity = sender.entity;
          updatePayload.entity = newSender.entity;
          updatePayload.title = newSender.entity;
          updatePayload.full_name = newSender.entity;
          afterState.entity = newSender.entity;
          afterState.full_name = newSender.entity;
        }
        if (newSender.phone) {
          beforeState.phone = sender.phone;
          const normalizedPhone = normalizePhone(newSender.phone);
          updatePayload.phone = normalizedPhone;
          afterState.phone = normalizedPhone;
        }
      }

      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "update_sender", step: "before_after",
        request_data: { before: beforeState },
        response_data: { after: afterState }, success: true,
      });

      if (dryRun) {
        results.push({ invoice, success: true, dry_run: true, before: beforeState, after: afterState });
        continue;
      }

      // 7. PUT to /senders/{sender.id}
      console.log(`[${VERSION}] PUT /senders/${sender.id} payload:`, JSON.stringify(updatePayload));
      const updateResp = await fetch(`${sparkUrl}/senders/${sender.id}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${sparkToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(updatePayload),
      });

      if (!updateResp.ok) {
        const errBody = await updateResp.text().catch(() => "");
        throw new Error(`Update sender failed: ${updateResp.status} - ${errBody.substring(0, 300)}`);
      }

      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "update_sender", step: "update_sender_api",
        request_data: { order_id: orderId },
        response_data: { status: updateResp.status }, success: true,
      });

      results.push({ invoice, success: true, before: beforeState, after: afterState });
    } catch (e: any) {
      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "update_sender", step: "error",
        success: false, error_message: e.message, request_data: { invoice },
      });
      results.push({ invoice, success: false, error: e.message });
    }
  }
  return results;
}
