import { VERSION, normalizePhone, searchInvoice, getLogisticsInfo, levenshtein, normalizeCityName, findCity, stripCityFromAddress } from "./helpers.ts";
import { loadAllSparkCities } from "./load-spark-cities.ts";
import { verifyReceiverChange, verifySenderChange } from "./verify-change.ts";

export async function executeChangeDirection(
  supabase: any, settings: Record<string, string>, aiResult: any, taskId: string, dryRun: boolean
) {
  const results = [];
  const sparkUrl = settings.spark_base_url || "https://gateway.spark-dev.team/cabinet/api/v2";
  const sparkToken = settings.spark_bearer_token;
  const invoices = aiResult.invoices || [];
  
  // Support both formats: { city: "Алматы - Калбатау" } and { from_city: "Алматы", to_city: "Калбатау" }
  // IMPORTANT: Prioritize from_city/to_city over city to preserve full direction info
  let targetCity: string | undefined;
  if (aiResult.from_city && aiResult.to_city) {
    targetCity = `${aiResult.from_city} - ${aiResult.to_city}`;
    console.log(`[${VERSION}] Constructed city pair from from_city/to_city: "${targetCity}"`);
  } else if (aiResult.to_city) {
    targetCity = aiResult.to_city;
    console.log(`[${VERSION}] Using to_city as target: "${targetCity}"`);
  } else {
    targetCity = aiResult.city;
  }

  if (!targetCity) {
    return [{ invoice: "N/A", success: false, error: "Город назначения не указан" }];
  }

  // Parse city pair: "Алматы - Байсерке" → originCity="Алматы", destinationCity="Байсерке"
  let originCity: string | null = null;
  let destinationCity: string = targetCity;
  const separators = [" - ", " – ", " — ", "-"];
  for (const sep of separators) {
    if (targetCity.includes(sep)) {
      const parts = targetCity.split(sep).map((p: string) => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        originCity = parts[0];
        destinationCity = parts[parts.length - 1];
        console.log(`[${VERSION}] City pair detected: "${targetCity}" → origin="${originCity}", destination="${destinationCity}"`);
      }
      break;
    }
  }

  // Load all cities
  const allCities = await loadAllSparkCities(supabase);
  if (!allCities || allCities.length === 0) {
    return invoices.map((inv: string) => ({ invoice: inv, success: false, error: "Справочник городов пуст" }));
  }

  // Resolve destination city
  const destMatch = findCity(destinationCity, allCities);
  if (!destMatch) {
    await supabase.from("execution_logs").insert({
      task_id: taskId, action: "change_direction", step: "city_lookup",
      success: false, error_message: `Город "${destinationCity}" не найден в справочнике (fuzzy)`,
    });
    return invoices.map((inv: string) => ({ invoice: inv, success: false, error: `Город "${destinationCity}" не найден` }));
  }

  // Resolve origin city if provided.
  // IMPORTANT: preserve the requested sender city itself whenever it exists in spark_cities.
  // Only fall back to allowed_directions child->parent when the origin city truly does not exist.
  let originMatch: { id: number; name: string } | null = null;
  let originResolution: "direct" | "mapped_child_to_parent_for_validation" | "missing" = "missing";
  if (originCity) {
    originMatch = findCity(originCity, allCities);
    if (originMatch) {
      originResolution = "direct";
      console.log(`[${VERSION}] Origin city match: "${originCity}" → id=${originMatch.id}, name="${originMatch.name}"`);
    } else {
      const { data: originDirectionRows } = await supabase
        .from("allowed_directions")
        .select("parent_city, child_city")
        .ilike("child_city", originCity)
        .limit(1);

      const mappedParentCity = originDirectionRows?.[0]?.parent_city || null;
      if (mappedParentCity) {
        const mappedOrigin = findCity(mappedParentCity, allCities);
        if (mappedOrigin) {
          originMatch = mappedOrigin;
          originResolution = "mapped_child_to_parent_for_validation";
          console.log(`[${VERSION}] Origin city "${originCity}" not found directly, mapped via allowed_directions to parent "${mappedParentCity}" → id=${mappedOrigin.id}, name="${mappedOrigin.name}"`);
        }
      }

      if (!originMatch) {
        console.warn(`[${VERSION}] Origin city "${originCity}" not found — will only change destination`);
      }
    }
  }

  const cityId = destMatch.id;
  const cityName = destMatch.name;
  console.log(`[${VERSION}] Destination city match: "${destinationCity}" → id=${cityId}, name="${cityName}"`);

  await supabase.from("execution_logs").insert({
    task_id: taskId, action: "change_direction", step: "city_lookup",
    request_data: { requested_city: targetCity, origin: originCity, destination: destinationCity },
    response_data: { dest_city_id: cityId, dest_city_name: cityName, origin_city_id: originMatch?.id, origin_city_name: originMatch?.name, origin_resolution: originResolution }, success: true,
  });

  // Check allowed_directions
  let isAllowedDirection = false;
  if (originMatch) {
    const { data: allowedDirs } = await supabase
      .from("allowed_directions").select("id")
      .eq("parent_city", originMatch.name).eq("child_city", cityName).limit(1);
    if (allowedDirs && allowedDirs.length > 0) {
      isAllowedDirection = true;
      console.log(`[${VERSION}] Direction "${originMatch.name}" → "${cityName}" is in allowed_directions`);
    }
    if (!isAllowedDirection) {
      const { data: allowedDirsReverse } = await supabase
        .from("allowed_directions").select("id")
        .eq("parent_city", cityName).eq("child_city", originMatch.name).limit(1);
      if (allowedDirsReverse && allowedDirsReverse.length > 0) {
        isAllowedDirection = true;
        console.log(`[${VERSION}] Direction "${cityName}" → "${originMatch.name}" is in allowed_directions (reverse)`);
      }
    }
  }
  if (!isAllowedDirection) {
    const { data: allowedAny } = await supabase
      .from("allowed_directions").select("id, parent_city")
      .eq("child_city", cityName).limit(1);
    if (allowedAny && allowedAny.length > 0) {
      isAllowedDirection = true;
      console.log(`[${VERSION}] Destination "${cityName}" found as child in allowed_directions (parent="${allowedAny[0].parent_city}")`);
    }
  }

  for (const invoice of invoices) {
    try {
      // 1. Check invoice status
      const statusResp = await fetch(
        `https://gateway.spark.kz/cabinet/api/invoice-status/${encodeURIComponent(invoice)}`
      );
      if (statusResp.ok) {
        const statusData = await statusResp.json();
        console.log(`[${VERSION}] Invoice ${invoice} status response:`, JSON.stringify(statusData).substring(0, 500));
        let statuses: any[] = [];
        if (Array.isArray(statusData)) {
          statuses = statusData;
        } else if (statusData && typeof statusData === "object") {
          if (Array.isArray(statusData.data?.status_history)) statuses = statusData.data.status_history;
          else if (Array.isArray(statusData.data)) statuses = statusData.data;
          else if (Array.isArray(statusData.statuses)) statuses = statusData.statuses;
          else if (Array.isArray(statusData.status_history)) statuses = statusData.status_history;
          else if (Array.isArray(statusData.result)) statuses = statusData.result;
          else statuses = [statusData];
        }
        const inTransit = statuses.find((s: any) => s.status_code === 206 || s.status_name === "Груз в пути");
        if (inTransit && inTransit.state === "completed") {
          if (isAllowedDirection) {
            console.log(`[${VERSION}] Invoice ${invoice}: "Груз в пути" completed but direction is ALLOWED — proceeding`);
            await supabase.from("execution_logs").insert({
              task_id: taskId, action: "change_direction", step: "status_check",
              request_data: { invoice, allowed_direction: true },
              response_data: { status: inTransit, allowed: true }, success: true,
            });
          } else {
            console.log(`[${VERSION}] Invoice ${invoice}: "Груз в пути" already completed — skipping direction change`);
            await supabase.from("execution_logs").insert({
              task_id: taskId, action: "change_direction", step: "status_check",
              request_data: { invoice }, response_data: { status: inTransit }, success: false,
              error_message: "Груз уже в пути — смена направления невозможна",
            });
            results.push({ invoice, success: false, error: "Груз уже в пути — смена направления невозможна" });
            continue;
          }
        }
      }

      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "change_direction", step: "status_check",
        request_data: { invoice }, response_data: { passed: true }, success: true,
      });

      // 2. Get logistics info
      const item = await searchInvoice(sparkUrl, sparkToken, invoice);
      const logisticsInfo = await getLogisticsInfo(sparkUrl, sparkToken, item.id);

      const receiver = logisticsInfo.receiver || {};
      const sender = logisticsInfo.sender || {};
      const receiverCityId = typeof receiver.city_id === 'number' ? receiver.city_id : Number(receiver.city_id);
      const receiverCityName = receiver.city?.name || "";
      const senderCityId = typeof sender.city_id === 'number' ? sender.city_id : Number(sender.city_id);
      const senderCityName = sender.city?.name || "";

      console.log(`[${VERSION}] ${invoice}: sender city="${senderCityName}" (${senderCityId}), receiver city="${receiverCityName}" (${receiverCityId})`);

      let changeSender = false;
      let changeReceiver = false;
      let senderTargetCityId = senderCityId;
      let senderTargetCityName = senderCityName;
      let receiverTargetCityId = cityId;
      let receiverTargetCityName = cityName;

      if (originMatch) {
        const senderMatchesOrigin = senderCityId === originMatch.id;
        const receiverMatchesDestination = receiverCityId === cityId;
        const receiverMatchesOrigin = receiverCityId === originMatch.id;
        const senderMatchesDestination = senderCityId === cityId;

        console.log(
          `[${VERSION}] Strict direction check: sender(${senderCityId})===origin(${originMatch.id})=${senderMatchesOrigin}, receiver(${receiverCityId})===dest(${cityId})=${receiverMatchesDestination}, sender===dest=${senderMatchesDestination}, receiver===origin=${receiverMatchesOrigin}`
        );

        // IMPORTANT: when origin and destination are both known, respect the requested order exactly.
        // Requested pair means: sender must be in origin city, receiver must be in destination city.
        // Reverse direction is NOT considered "already matches".
        if (senderMatchesOrigin && receiverMatchesDestination) {
          results.push({ invoice, success: true, city: `${originCity || originMatch.name} - ${cityName}`, message: "Направление уже соответствует" });
          continue;
        }

        changeSender = !senderMatchesOrigin;

        if (changeSender && originResolution === "mapped_child_to_parent_for_validation") {
          console.warn(`[${VERSION}] Sender change skipped: requested origin "${originCity}" was resolved only via parent mapping "${originMatch.name}"; applying parent city would corrupt the requested direction`);
          changeSender = false;
        }

        senderTargetCityId = originMatch.id;
        senderTargetCityName = originMatch.name;

        changeReceiver = !receiverMatchesDestination;
        receiverTargetCityId = cityId;
        receiverTargetCityName = cityName;

        await supabase.from("execution_logs").insert({
          task_id: taskId, action: "change_direction", step: "direction_analysis",
          request_data: { sender_city: senderCityName, sender_city_id: senderCityId, receiver_city: receiverCityName, receiver_city_id: receiverCityId, requested_origin: originCity, resolved_origin: originMatch.name, origin_id: originMatch.id, destination: cityName, dest_id: cityId },
          response_data: { change_sender: changeSender, change_receiver: changeReceiver, sender_target: senderTargetCityName, receiver_target: receiverTargetCityName, interpretation: "strict_requested_order", reverse_state_detected: senderMatchesDestination && receiverMatchesOrigin, sender_change_skipped_due_to_parent_mapping: originResolution === "mapped_child_to_parent_for_validation" && !senderMatchesOrigin },
          success: true,
        });
      } else {
        // Single city — change receiver
        if (receiverCityId === cityId) {
          results.push({ invoice, success: true, city: cityName, message: "Направление получателя уже соответствует" });
          continue;
        }
        changeReceiver = true;
      }

      // ---- CHANGE RECEIVER if needed ----
      if (changeReceiver) {
        let currentStreet = stripCityFromAddress(receiver.street || "", allCities);
        const currentHouse = receiver.house || "";
        let cleanFullAddress = stripCityFromAddress(receiver.full_address || "", allCities);
        let newLatitude = receiver.latitude != null ? Number(receiver.latitude) : null;
        let newLongitude = receiver.longitude != null ? Number(receiver.longitude) : null;
        let newFullAddress = cleanFullAddress;

        if (currentStreet) {
          const yandexApiKey = settings.yandex_geocoder_api_key;
          if (yandexApiKey) {
            const geoQuery = `${receiverTargetCityName}, ${currentStreet} ${currentHouse}`.trim();
            console.log(`[${VERSION}] Geocoding receiver in new city: "${geoQuery}"`);
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
                task_id: taskId, action: "change_direction", step: "geocoding_receiver",
                request_data: { query: geoQuery },
                response_data: geoMember ? { pos, formatted: geoMember?.metaDataProperty?.GeocoderMetaData?.text } : { error: "No results" },
                success: !!geoMember,
              });
            } catch (geoErr: any) {
              console.warn(`[${VERSION}] Geocoding failed: ${geoErr.message}`);
            }
          }
        }

        const receiverPayload: any = {
          title: receiver.title, entity: receiver.entity || receiver.title,
          full_name: receiver.full_name, phone: receiver.phone,
          additional_phone: receiver.additional_phone || null,
          city_id: Number(receiverTargetCityId),
          latitude: newLatitude, longitude: newLongitude,
          street: currentStreet, house: currentHouse, full_address: newFullAddress,
          flat: receiver.flat || "", comment: receiver.comment || null,
          office: receiver.office || null, index: receiver.index ? String(receiver.index).substring(0, 10) : null,
          company_id: receiver.company_id || null, id: receiver.id,
          sender_id: receiver.sender_id || null, warehouse_id: receiver.warehouse_id || null,
        };

        await supabase.from("execution_logs").insert({
          task_id: taskId, action: "change_direction", step: "receiver_before_after",
          request_data: { before_city: receiverCityName, before_city_id: receiverCityId },
          response_data: { after_city: receiverTargetCityName, after_city_id: receiverTargetCityId, after_address: newFullAddress }, success: true,
        });

        if (!dryRun) {
          console.log(`[${VERSION}] PUT /receivers/${receiver.id} direction change: city_id=${receiverTargetCityId} (${receiverTargetCityName})`);
          const updateResp = await fetch(`${sparkUrl}/receivers/${receiver.id}`, {
            method: "PUT",
            headers: { Authorization: `Bearer ${sparkToken}`, "Content-Type": "application/json" },
            body: JSON.stringify(receiverPayload),
          });
          if (!updateResp.ok) {
            const errBody = await updateResp.text().catch(() => "");
            throw new Error(`Update receiver direction failed: ${updateResp.status} - ${errBody.substring(0, 300)}`);
          }
          await supabase.from("execution_logs").insert({
            task_id: taskId, action: "change_direction", step: "update_receiver_api",
            request_data: { endpoint: `PUT ${sparkUrl}/receivers/${receiver.id}`, body: receiverPayload },
            response_data: { status: updateResp.status }, success: true,
          });
        }
      }

      // ---- CHANGE SENDER if needed ----
      if (changeSender) {
        if (!sender?.id) {
          console.warn(`[${VERSION}] Cannot change sender — sender not found in logistics-info`);
        } else {
          let senderStreet = stripCityFromAddress(sender.street || "", allCities);
          const senderHouse = sender.house || "";
          let senderFullAddress = stripCityFromAddress(sender.full_address || "", allCities);
          let senderLat = sender.latitude != null ? Number(sender.latitude) : null;
          let senderLon = sender.longitude != null ? Number(sender.longitude) : null;

          const yandexApiKey = settings.yandex_geocoder_api_key;
          if (yandexApiKey && (senderStreet || senderHouse)) {
            const geoQuery = `${senderTargetCityName}, ${senderStreet} ${senderHouse}`.trim();
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
                senderLat = lat;
                senderLon = lon;
                const formattedAddr = geoMember?.metaDataProperty?.GeocoderMetaData?.text || "";
                if (formattedAddr) senderFullAddress = formattedAddr;
              }
              await supabase.from("execution_logs").insert({
                task_id: taskId, action: "change_direction", step: "geocoding_sender",
                request_data: { query: geoQuery },
                response_data: geoMember ? { pos, formatted: geoMember?.metaDataProperty?.GeocoderMetaData?.text } : { error: "No results" },
                success: !!geoMember,
              });
            } catch (geoErr: any) {
              console.warn(`[${VERSION}] Sender geocoding failed: ${geoErr.message}`);
            }
          }

          // Fallback to city center coords
          if (senderLat == null || senderLon == null) {
            if (yandexApiKey) {
              try {
                const cityGeoResp = await fetch(
                  `https://geocode-maps.yandex.ru/1.x?apikey=${encodeURIComponent(yandexApiKey)}&lang=ru_RU&format=json&geocode=${encodeURIComponent(senderTargetCityName)}`
                );
                const cityGeoData = await cityGeoResp.json();
                const cityPos = cityGeoData?.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject?.Point?.pos;
                if (cityPos) {
                  const [lon, lat] = cityPos.split(" ").map(Number);
                  senderLat = lat;
                  senderLon = lon;
                }
              } catch (_) {}
            }
          }

          const senderPayload: any = {
            title: sender.title, entity: sender.entity || sender.title,
            full_name: sender.full_name, phone: sender.phone,
            additional_phone: sender.additional_phone || null,
            city_id: Number(senderTargetCityId),
            latitude: senderLat, longitude: senderLon,
            street: senderStreet, house: senderHouse, full_address: senderFullAddress,
            comment: sender.comment || null, office: sender.office || null,
            index: sender.index ? String(sender.index).substring(0, 10) : null,
            company_id: sender.company_id || null, id: sender.id,
            warehouse_id: null,
          };

          await supabase.from("execution_logs").insert({
            task_id: taskId, action: "change_direction", step: "sender_before_after",
            request_data: { before_city: senderCityName, before_city_id: senderCityId },
            response_data: { after_city: senderTargetCityName, after_city_id: senderTargetCityId }, success: true,
          });

          if (!dryRun) {
            console.log(`[${VERSION}] PUT /senders/${sender.id} direction change: city_id=${senderTargetCityId} (${senderTargetCityName})`);
            const updateResp = await fetch(`${sparkUrl}/senders/${sender.id}`, {
              method: "PUT",
              headers: { Authorization: `Bearer ${sparkToken}`, "Content-Type": "application/json" },
              body: JSON.stringify(senderPayload),
            });
            if (!updateResp.ok) {
              const errBody = await updateResp.text().catch(() => "");
              throw new Error(`Update sender direction failed: ${updateResp.status} - ${errBody.substring(0, 300)}`);
            }
            await supabase.from("execution_logs").insert({
              task_id: taskId, action: "change_direction", step: "update_sender_api",
              request_data: { endpoint: `PUT ${sparkUrl}/senders/${sender.id}`, body: senderPayload },
              response_data: { status: updateResp.status }, success: true,
            });
          }
        }
      }

      const changedParts: string[] = [];
      if (changeReceiver) changedParts.push(`получатель→${receiverTargetCityName}`);
      if (changeSender) changedParts.push(`отправитель→${senderTargetCityName}`);
      results.push({ invoice, success: true, city: cityName, dry_run: dryRun || undefined, changed: changedParts.join(", ") || "receiver", before: { direction: `${receiverCityName || ""}${changeSender ? ` / ${senderCityName || ""}` : ""}` }, after: { direction: `${receiverTargetCityName || cityName}${changeSender ? ` / ${senderTargetCityName || ""}` : ""}` } });
    } catch (e: any) {
      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "change_direction", step: "error",
        success: false, error_message: e.message, request_data: { invoice },
      });
      results.push({ invoice, success: false, error: e.message });
    }
  }
  return results;
}
