import { VERSION, normalizePhone, searchInvoice, getLogisticsInfo, checkOrderRestored } from "./helpers.ts";

/**
 * Самовывоз (self_pickup) — sets warehouse on RECEIVER.
 * Logic:
 * 1. Get receiver info from logistics-info
 * 2. Check receiver city → if child city, resolve parent from allowed_directions
 * 3. Find warehouse for the resolved city
 * 4. Update receiver with warehouse_id, coords, address, city_id
 */
export async function executeSelfPickup(
  supabase: any, settings: Record<string, string>, aiResult: any, taskId: string, dryRun: boolean
) {
  const results: any[] = [];
  const sparkUrl = settings.spark_base_url || "https://gateway.spark-dev.team/cabinet/api/v2";
  const sparkToken = settings.spark_bearer_token;
  const invoices = aiResult.invoices || [];

  for (const invoice of invoices) {
    try {
      // 1. Search invoice & check cancellation status
      const item = await searchInvoice(sparkUrl, sparkToken, invoice);
      
      const orderStatus = item.status?.name || item.status || "";
      const orderStatusCode = item.status?.code || null;
      const isCancelledStatus = orderStatus.toLowerCase().includes("отмен") || orderStatus.toLowerCase().includes("cancel") || orderStatusCode === 503;

      if (isCancelledStatus) {
        const isRestored = await checkOrderRestored(invoice, sparkToken);
        if (!isRestored) {
          results.push({ invoice, success: false, error: `Заказ уже отменён (статус: ${orderStatus})` });
          continue;
        }
      }

      // 2. Get full logistics info
      const logisticsInfo = await getLogisticsInfo(sparkUrl, sparkToken, item.id);
      const receiver = logisticsInfo.receiver || logisticsInfo;
      if (!receiver?.id) throw new Error("Receiver not found in logistics-info");

      const receiverCity = receiver.city?.name || receiver.city || "";
      const receiverCityId = typeof receiver.city_id === 'number' ? receiver.city_id : Number(receiver.city_id);

      console.log(`[${VERSION}] self_pickup: invoice=${invoice}, receiver_id=${receiver.id}, city="${receiverCity}", city_id=${receiverCityId}`);

      // 3. Resolve city: check allowed_directions for child→parent mapping
      let targetCityName = receiverCity;
      let targetCityId = receiverCityId;

      const { data: directionRows } = await supabase
        .from("allowed_directions")
        .select("parent_city")
        .ilike("child_city", receiverCity);

      if (directionRows && directionRows.length > 0) {
        const parentCityName = directionRows[0].parent_city;
        console.log(`[${VERSION}] self_pickup: "${receiverCity}" is child city, parent="${parentCityName}"`);
        
        // Find parent city ID from spark_cities
        const { data: cityRows } = await supabase
          .from("spark_cities")
          .select("id, name")
          .ilike("name", parentCityName);
        
        if (cityRows && cityRows.length > 0) {
          targetCityName = cityRows[0].name;
          targetCityId = cityRows[0].id;
        }
      }

      // 4. Find warehouse for target city
      const { data: warehouseRows } = await supabase
        .from("warehouses")
        .select("*")
        .eq("city_id", targetCityId)
        .limit(1);

      let warehouse: any = null;

      if (warehouseRows && warehouseRows.length > 0) {
        warehouse = warehouseRows[0];
        console.log(`[${VERSION}] self_pickup: found warehouse in DB: id=${warehouse.id}, city="${warehouse.city_name}"`);
      } else {
        // Try fetching from Spark API
        try {
          const whResp = await fetch(
            `https://gateway.spark.kz/location/api/warehouses?city_id=${targetCityId}`,
            { headers: { Authorization: `Bearer ${sparkToken}`, Accept: "application/json" } }
          );
          if (whResp.ok) {
            const whData = await whResp.json();
            const whItems = whData.data || whData || [];
            const whList = Array.isArray(whItems) ? whItems : [whItems];
            if (whList.length > 0) {
              warehouse = whList[0];
              console.log(`[${VERSION}] self_pickup: found warehouse from API: id=${warehouse.id}`);
              // Cache in DB
              await supabase.from("warehouses").upsert({
                id: warehouse.id,
                city_id: targetCityId,
                city_name: targetCityName,
                address: warehouse.fullAddress || warehouse.fullAddressRu || warehouse.address || warehouse.full_address || "",
                latitude: warehouse.latitude ? Number(warehouse.latitude) : 0,
                longitude: warehouse.longitude ? Number(warehouse.longitude) : 0,
                name: warehouse.title || warehouse.titleRu || warehouse.name || null,
              });
            }
          }
        } catch (e: any) {
          console.warn(`[${VERSION}] self_pickup: warehouse API call failed: ${e.message}`);
        }
      }

      if (!warehouse) {
        throw new Error(`Склад не найден для города "${targetCityName}" (city_id=${targetCityId})`);
      }

      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "self_pickup", step: "resolve_warehouse",
        request_data: { invoice, receiver_city: receiverCity, target_city: targetCityName, target_city_id: targetCityId },
        response_data: { warehouse_id: warehouse.id, address: warehouse.address, lat: warehouse.latitude, lng: warehouse.longitude },
        success: true,
      });

      // 5. Build update payload (same structure as update_receiver but with warehouse fields)
      const updatePayload: any = {
        title: receiver.title,
        entity: receiver.entity || receiver.title,
        full_name: receiver.full_name,
        phone: normalizePhone(receiver.phone),
        additional_phone: normalizePhone(receiver.additional_phone || receiver.phone),
        city_id: targetCityId,
        latitude: Number(warehouse.latitude),
        longitude: Number(warehouse.longitude),
        street: null,
        house: null,
        full_address: warehouse.address,
        flat: null,
        comment: receiver.comment || null,
        office: receiver.office || null,
        company_id: receiver.company_id || null,
        id: receiver.id,
        sender_id: receiver.sender_id || null,
        warehouse_id: warehouse.id,
      };
      if (receiver.index) {
        updatePayload.index = String(receiver.index).substring(0, 10);
      }

      const beforeState = {
        warehouse_id: receiver.warehouse_id || null,
        city_id: receiverCityId,
        city: receiverCity,
        full_address: receiver.full_address,
        latitude: receiver.latitude,
        longitude: receiver.longitude,
      };
      const afterState = {
        warehouse_id: warehouse.id,
        city_id: targetCityId,
        city: targetCityName,
        full_address: warehouse.address,
        latitude: Number(warehouse.latitude),
        longitude: Number(warehouse.longitude),
      };

      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "self_pickup", step: "before_after",
        request_data: { before: beforeState },
        response_data: { after: afterState }, success: true,
      });

      if (dryRun) {
        results.push({ invoice, success: true, dry_run: true, before: beforeState, after: afterState });
        continue;
      }

      // 6. PUT to /receivers/{receiver.id}
      console.log(`[${VERSION}] PUT /receivers/${receiver.id} (self_pickup) payload:`, JSON.stringify(updatePayload));
      const updateResp = await fetch(`${sparkUrl}/receivers/${receiver.id}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${sparkToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(updatePayload),
      });

      if (!updateResp.ok) {
        const errBody = await updateResp.text().catch(() => "");
        throw new Error(`Update receiver (self_pickup) failed: ${updateResp.status} - ${errBody.substring(0, 300)}`);
      }

      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "self_pickup", step: "update_receiver_api",
        request_data: { endpoint: `PUT ${sparkUrl}/receivers/${receiver.id}`, body: updatePayload },
        response_data: { status: updateResp.status }, success: true,
      });

      results.push({ invoice, success: true, before: beforeState, after: afterState });
    } catch (e: any) {
      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "self_pickup", step: "error",
        success: false, error_message: e.message, request_data: { invoice },
      });
      results.push({ invoice, success: false, error: e.message });
    }
  }
  return results;
}
