import { VERSION, normalizePhone, searchInvoice, getLogisticsInfo, levenshtein, normalizeCityName, findCity, stripCityFromAddress } from "./helpers.ts";

export async function executeChangeDirection(
  supabase: any, settings: Record<string, string>, aiResult: any, taskId: string, dryRun: boolean
) {
  const results = [];
  const sparkUrl = settings.spark_base_url || "https://gateway.spark-dev.team/cabinet/api/v2";
  const sparkToken = settings.spark_bearer_token;
  const invoices = aiResult.invoices || [];
  
  // Support both formats: { city: "Алматы - Калбатау" } and { from_city: "Алматы", to_city: "Калбатау" }
  let targetCity = aiResult.city;
  if (!targetCity && aiResult.from_city && aiResult.to_city) {
    targetCity = `${aiResult.from_city} - ${aiResult.to_city}`;
    console.log(`[${VERSION}] Constructed city pair from from_city/to_city: "${targetCity}"`);
  } else if (!targetCity && aiResult.to_city) {
    targetCity = aiResult.to_city;
    console.log(`[${VERSION}] Using to_city as target: "${targetCity}"`);
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
  const { data: allCities } = await supabase.from("spark_cities").select("id, name");
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

  // Resolve origin city if provided
  let originMatch: { id: number; name: string } | null = null;
  if (originCity) {
    originMatch = findCity(originCity, allCities);
    if (!originMatch) {
      console.warn(`[${VERSION}] Origin city "${originCity}" not found — will only change destination`);
    } else {
      console.log(`[${VERSION}] Origin city match: "${originCity}" → id=${originMatch.id}, name="${originMatch.name}"`);
    }
  }

  const cityId = destMatch.id;
  const cityName = destMatch.name;
  console.log(`[${VERSION}] Destination city match: "${destinationCity}" → id=${cityId}, name="${cityName}"`);

  await supabase.from("execution_logs").insert({
    task_id: taskId, action: "change_direction", step: "city_lookup",
    request_data: { requested_city: targetCity, origin: originCity, destination: destinationCity },
    response_data: { dest_city_id: cityId, dest_city_name: cityName, origin_city_id: originMatch?.id, origin_city_name: originMatch?.name }, success: true,
  });

  for (const invoice of invoices) {
    try {
      // 1. Get logistics info FIRST to know current sender/receiver cities
      const item = await searchInvoice(sparkUrl, sparkToken, invoice);
      const logisticsInfo = await getLogisticsInfo(sparkUrl, sparkToken, item.id);

      const receiver = logisticsInfo.receiver || {};
      const sender = logisticsInfo.sender || {};
      const receiverCityId = typeof receiver.city_id === 'number' ? receiver.city_id : Number(receiver.city_id);
      const receiverCityName = receiver.city?.name || "";
      const senderCityId = typeof sender.city_id === 'number' ? sender.city_id : Number(sender.city_id);
      const senderCityName = sender.city?.name || "";

      console.log(`[${VERSION}] ${invoice}: sender city="${senderCityName}" (${senderCityId}), receiver city="${receiverCityName}" (${receiverCityId})`);

      // 2. Determine WHAT to change by comparing order data with request
      let changeSender = false;
      let changeReceiver = false;
      let senderTargetCityId = senderCityId;
      let senderTargetCityName = senderCityName;
      let receiverTargetCityId = receiverCityId;
      let receiverTargetCityName = receiverCityName;

      const normalize = normalizeCityName;

      if (originMatch) {
        // Two cities provided (e.g. "Алматы - Костанай")
        // Compare each city from request against actual order sender/receiver
        const normSenderCity = normalize(senderCityName);
        const normReceiverCity = normalize(receiverCityName);
        const normOrigin = normalize(originMatch.name);
        const normDest = normalize(cityName);

        const senderMatchesOrigin = normSenderCity === normOrigin || senderCityId === originMatch.id;
        const senderMatchesDest = normSenderCity === normDest || senderCityId === cityId;
        const receiverMatchesOrigin = normReceiverCity === normOrigin || receiverCityId === originMatch.id;
        const receiverMatchesDest = normReceiverCity === normDest || receiverCityId === cityId;

        console.log(`[${VERSION}] Match: sender="${senderCityName}" vs origin="${originMatch.name}"=${senderMatchesOrigin}, vs dest="${cityName}"=${senderMatchesDest}`);
        console.log(`[${VERSION}] Match: receiver="${receiverCityName}" vs origin="${originMatch.name}"=${receiverMatchesOrigin}, vs dest="${cityName}"=${receiverMatchesDest}`);

        // Rule: the city that MATCHES the current order = don't touch. The one that DOESN'T = change it.
        if (senderMatchesOrigin && receiverMatchesDest) {
          // Already correct
          results.push({ invoice, success: true, city: cityName, message: "Направление уже соответствует" });
          continue;
        }

        if (senderMatchesOrigin) {
          // Sender matches origin → change RECEIVER to destination
          changeReceiver = true;
          receiverTargetCityId = cityId;
          receiverTargetCityName = cityName;
        } else if (senderMatchesDest) {
          // Sender matches dest → AI swapped. Change RECEIVER to origin
          changeReceiver = true;
          receiverTargetCityId = originMatch.id;
          receiverTargetCityName = originMatch.name;
        } else if (receiverMatchesDest) {
          // Receiver matches dest → change SENDER to origin
          changeSender = true;
          senderTargetCityId = originMatch.id;
          senderTargetCityName = originMatch.name;
        } else if (receiverMatchesOrigin) {
          // Receiver matches origin → change SENDER to dest
          changeSender = true;
          senderTargetCityId = cityId;
          senderTargetCityName = cityName;
        } else {
          // Neither side matches either city — ambiguous, default to changing receiver to dest
          console.warn(`[${VERSION}] No city match found — defaulting to change receiver to "${cityName}"`);
          changeReceiver = true;
          receiverTargetCityId = cityId;
          receiverTargetCityName = cityName;
        }
      } else {
        // Only one city provided — smart detection
        const normReceiverCity = normalize(receiverCityName);
        const normSenderCity = normalize(senderCityName);
        const normDest = normalize(cityName);

        if (normReceiverCity === normDest || receiverCityId === cityId) {
          console.log(`[${VERSION}] Receiver already in "${cityName}" — no change needed`);
          results.push({ invoice, success: true, city: cityName, message: "Получатель уже в указанном городе" });
          continue;
        } else if (normSenderCity === normDest || senderCityId === cityId) {
          // Sender matches the target city — that means we should NOT touch sender, this is ambiguous
          console.log(`[${VERSION}] Sender is already "${cityName}" — ignoring, ambiguous single-city request`);
          results.push({ invoice, success: false, error: `Отправитель уже в городе "${cityName}", непонятно что менять. Укажите маршрут полностью.` });
          continue;
        } else {
          // Neither matches — default to changing receiver
          changeReceiver = true;
          receiverTargetCityId = cityId;
          receiverTargetCityName = cityName;
        }
      }

      // Determine the effective route for allowed_directions check
      const effectiveSenderCity = changeSender ? senderTargetCityName : senderCityName;
      const effectiveReceiverCity = changeReceiver ? receiverTargetCityName : receiverCityName;

      // Check allowed_directions for the target route
      let isAllowedDirection = false;
      {
        const { data: ad1 } = await supabase
          .from("allowed_directions").select("id")
          .eq("parent_city", effectiveSenderCity).eq("child_city", effectiveReceiverCity).limit(1);
        if (ad1 && ad1.length > 0) isAllowedDirection = true;
        if (!isAllowedDirection) {
          const { data: ad2 } = await supabase
            .from("allowed_directions").select("id")
            .eq("parent_city", effectiveReceiverCity).eq("child_city", effectiveSenderCity).limit(1);
          if (ad2 && ad2.length > 0) isAllowedDirection = true;
        }
        if (!isAllowedDirection) {
          const { data: adAny } = await supabase
            .from("allowed_directions").select("id, parent_city")
            .eq("child_city", effectiveReceiverCity).limit(1);
          if (adAny && adAny.length > 0) isAllowedDirection = true;
        }
      }

      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "change_direction", step: "direction_analysis",
        request_data: { sender_city: senderCityName, sender_city_id: senderCityId, receiver_city: receiverCityName, receiver_city_id: receiverCityId, parsed_origin: originMatch?.name || null, parsed_destination: cityName },
        response_data: { change_sender: changeSender, change_receiver: changeReceiver, sender_target: senderTargetCityName, receiver_target: receiverTargetCityName, is_allowed: isAllowedDirection },
        success: true,
      });

      // 3. Check "В пути" status
      const statusResp = await fetch(
        `https://gateway.spark.kz/cabinet/api/invoice-status/${encodeURIComponent(invoice)}`
      );
      if (statusResp.ok) {
        const statusData = await statusResp.json();
        let statuses: any[] = [];
        if (Array.isArray(statusData)) statuses = statusData;
        else if (statusData && typeof statusData === "object") {
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
            console.log(`[${VERSION}] Invoice ${invoice}: "Груз в пути" completed but direction "${effectiveSenderCity}→${effectiveReceiverCity}" is ALLOWED — proceeding`);
          } else {
            // IGNORE — don't change, don't error, just skip silently
            console.log(`[${VERSION}] Invoice ${invoice}: "Груз в пути" completed and direction NOT in allowed_directions — IGNORING`);
            await supabase.from("execution_logs").insert({
              task_id: taskId, action: "change_direction", step: "status_check",
              request_data: { invoice, direction: `${effectiveSenderCity}→${effectiveReceiverCity}`, allowed: false },
              response_data: { status: inTransit }, success: false,
              error_message: "Груз в пути (завершён), направление не в разрешённых — пропускаем",
            });
            results.push({ invoice, success: false, error: "Груз в пути (завершён), направление не в разрешённых — смена невозможна" });
            continue;
          }
        }
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
