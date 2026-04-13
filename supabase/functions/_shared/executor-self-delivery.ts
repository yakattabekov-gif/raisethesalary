import { VERSION, searchInvoice, getLogisticsInfo, checkSenderStatusAllowed } from "./helpers.ts";
import { verifySenderChange } from "./verify-change.ts";

/**
 * Самопривоз (self_delivery) — sets warehouse on SENDER.
 * Logic:
 * 1. Get sender info from logistics-info
 * 2. Check sender city → if child city, resolve parent from allowed_directions
 * 3. Find warehouse for the resolved city
 * 4. Update sender with warehouse_id, coords, address, city_id
 */
export async function executeSelfDelivery(
  supabase: any, settings: Record<string, string>, aiResult: any, taskId: string, dryRun: boolean
) {
  const results: any[] = [];
  const sparkUrl = settings.spark_base_url || "https://gateway.spark-dev.team/cabinet/api/v2";
  const sparkToken = settings.spark_bearer_token;
  const invoices = aiResult.invoices || [];

  for (const invoice of invoices) {
    try {
      // 1. Status check
      const statusCheck = await checkSenderStatusAllowed(invoice, sparkToken, supabase, taskId, "self_delivery");
      if (!statusCheck.allowed) {
        results.push({ invoice, success: false, error: statusCheck.error });
        continue;
      }

      // 2. Search invoice & get logistics info
      const item = await searchInvoice(sparkUrl, sparkToken, invoice);
      const logisticsInfo = await getLogisticsInfo(sparkUrl, sparkToken, item.id);
      const sender = logisticsInfo.sender || {};
      if (!sender?.id) throw new Error("Sender not found in logistics-info");

      const senderCity = sender.city?.name || sender.city || "";
      const senderCityId = typeof sender.city_id === 'number' ? sender.city_id
        : (sender.city?.id ? Number(sender.city.id) : Number(sender.city_id));

      console.log(`[${VERSION}] self_delivery: invoice=${invoice}, sender_id=${sender.id}, city="${senderCity}", city_id=${senderCityId}`);

      // 3. Resolve city: check allowed_directions for child→parent mapping
      let targetCityName = senderCity;
      let targetCityId = senderCityId;

      const { data: directionRows } = await supabase
        .from("allowed_directions")
        .select("parent_city")
        .ilike("child_city", senderCity);

      if (directionRows && directionRows.length > 0) {
        const parentCityName = directionRows[0].parent_city;
        console.log(`[${VERSION}] self_delivery: "${senderCity}" is child city, parent="${parentCityName}"`);
        
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
        console.log(`[${VERSION}] self_delivery: found warehouse in DB: id=${warehouse.id}, city="${warehouse.city_name}"`);
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
              console.log(`[${VERSION}] self_delivery: found warehouse from API: id=${warehouse.id}`);
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
          console.warn(`[${VERSION}] self_delivery: warehouse API call failed: ${e.message}`);
        }
      }

      if (!warehouse) {
        throw new Error(`Склад не найден для города "${targetCityName}" (city_id=${targetCityId})`);
      }

      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "self_delivery", step: "resolve_warehouse",
        request_data: { invoice, sender_city: senderCity, target_city: targetCityName, target_city_id: targetCityId },
        response_data: { warehouse_id: warehouse.id, address: warehouse.address, lat: warehouse.latitude, lng: warehouse.longitude },
        success: true,
      });

      // 5. Build update payload (same structure as update_sender but with warehouse fields)
      const updatePayload: any = {
        title: sender.title,
        entity: sender.entity || sender.title,
        full_name: sender.full_name,
        phone: sender.phone,
        additional_phone: sender.additional_phone || null,
        city_id: targetCityId,
        latitude: Number(warehouse.latitude),
        longitude: Number(warehouse.longitude),
        street: null,
        house: null,
        full_address: warehouse.address,
        comment: sender.comment || null,
        office: sender.office || null,
        company_id: sender.company_id || null,
        id: sender.id,
        warehouse_id: warehouse.id,
      };
      if (sender.index) {
        updatePayload.index = String(sender.index).substring(0, 10);
      } else {
        updatePayload.index = null;
      }

      const beforeState = {
        warehouse_id: sender.warehouse_id || null,
        city_id: senderCityId,
        city: senderCity,
        full_address: sender.full_address,
        latitude: sender.latitude,
        longitude: sender.longitude,
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
        task_id: taskId, action: "self_delivery", step: "before_after",
        request_data: { before: beforeState },
        response_data: { after: afterState }, success: true,
      });

      if (dryRun) {
        results.push({ invoice, success: true, dry_run: true, before: beforeState, after: afterState });
        continue;
      }

      // 6. PUT to /senders/{sender.id}
      console.log(`[${VERSION}] PUT /senders/${sender.id} (self_delivery) payload:`, JSON.stringify(updatePayload));
      const updateResp = await fetch(`${sparkUrl}/senders/${sender.id}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${sparkToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(updatePayload),
      });

      if (!updateResp.ok) {
        const errBody = await updateResp.text().catch(() => "");
        throw new Error(`Update sender (self_delivery) failed: ${updateResp.status} - ${errBody.substring(0, 300)}`);
      }

      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "self_delivery", step: "update_sender_api",
        request_data: { endpoint: `PUT ${sparkUrl}/senders/${sender.id}`, body: updatePayload },
        response_data: { status: updateResp.status }, success: true,
      });

      results.push({ invoice, success: true, before: beforeState, after: afterState });
    } catch (e: any) {
      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "self_delivery", step: "error",
        success: false, error_message: e.message, request_data: { invoice },
      });
      results.push({ invoice, success: false, error: e.message });
    }
  }
  return results;
}
