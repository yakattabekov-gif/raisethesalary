import { VERSION, normalizePhone, searchInvoice, getLogisticsInfo, checkSenderStatusAllowed, findCity, normalizeCityName, stripCityFromAddress } from "./helpers.ts";

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

  // Parse city pair: "Алматы - Астана" → city1="Алматы", city2="Астана"
  let city1Name: string | null = null;
  let city2Name: string | null = null;
  const separators = [" - ", " – ", " — ", "-"];
  for (const sep of separators) {
    if (targetCity.includes(sep)) {
      const parts = targetCity.split(sep).map((p: string) => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        city1Name = parts[0];
        city2Name = parts[parts.length - 1];
        console.log(`[${VERSION}] Sender direction city pair: "${targetCity}" → city1="${city1Name}", city2="${city2Name}"`);
      }
      break;
    }
  }

  // If no pair, treat as single target city for sender
  if (!city1Name || !city2Name) {
    city2Name = targetCity;
  }

  // Load all cities from DB
  const { data: allCities } = await supabase.from("spark_cities").select("id, name");
  if (!allCities || allCities.length === 0) {
    return invoices.map((inv: string) => ({ invoice: inv, success: false, error: "Справочник городов пуст" }));
  }

  // Resolve city IDs
  const city1Match = city1Name ? findCity(city1Name, allCities) : null;
  const city2Match = findCity(city2Name!, allCities);

  if (!city2Match && !city1Match) {
    await supabase.from("execution_logs").insert({
      task_id: taskId, action: "change_sender_direction", step: "city_lookup",
      success: false, error_message: `Города "${city1Name}" и "${city2Name}" не найдены в справочнике`,
    });
    return invoices.map((inv: string) => ({ invoice: inv, success: false, error: `Города не найдены в справочнике` }));
  }

  if (city1Match) {
    console.log(`[${VERSION}] City1 match: "${city1Name}" → id=${city1Match.id}, name="${city1Match.name}"`);
  }
  if (city2Match) {
    console.log(`[${VERSION}] City2 match: "${city2Name}" → id=${city2Match.id}, name="${city2Match.name}"`);
  }

  await supabase.from("execution_logs").insert({
    task_id: taskId, action: "change_sender_direction", step: "city_lookup",
    request_data: { requested_city: targetCity, city1: city1Name, city2: city2Name },
    response_data: {
      city1_id: city1Match?.id, city1_name: city1Match?.name,
      city2_id: city2Match?.id, city2_name: city2Match?.name,
    },
    success: true,
  });

  for (const invoice of invoices) {
    try {
      // 1. Status check
      const statusCheck = await checkSenderStatusAllowed(invoice, sparkToken, supabase, taskId, "change_sender_direction");
      if (!statusCheck.allowed) {
        results.push({ invoice, success: false, error: statusCheck.error });
        continue;
      }

      // 2. Search invoice and get logistics info
      const item = await searchInvoice(sparkUrl, sparkToken, invoice);
      const orderId = item.order_id;
      if (!orderId) throw new Error("order_id not found");

      const logisticsInfo = await getLogisticsInfo(sparkUrl, sparkToken, item.id);
      const sender = logisticsInfo.sender || {};
      const receiver = logisticsInfo.receiver || {};
      if (!sender?.id) throw new Error("Sender not found in logistics-info");

      const senderCityId = typeof sender.city_id === "number" ? sender.city_id : Number(sender.city_id);
      const receiverCityId = typeof receiver.city_id === "number" ? receiver.city_id : Number(receiver.city_id);
      const senderCityName = sender.city?.name || "";
      const receiverCityName = receiver.city?.name || "";

      console.log(`[${VERSION}] ${invoice}: sender city="${senderCityName}" (${senderCityId}), receiver city="${receiverCityName}" (${receiverCityId})`);

      // 3. Smart comparison: determine which side to change
      let changeSender = false;
      let changeReceiver = false;
      let senderTargetCityId = senderCityId;
      let senderTargetCityName = senderCityName;
      let receiverTargetCityId = receiverCityId;
      let receiverTargetCityName = receiverCityName;

      if (city1Match && city2Match) {
        // We have a city pair — compare both sides
        // Check if city1 matches sender and city2 matches receiver (or vice versa)
        const c1MatchesSender = senderCityId === city1Match.id;
        const c1MatchesReceiver = receiverCityId === city1Match.id;
        const c2MatchesSender = senderCityId === city2Match.id;
        const c2MatchesReceiver = receiverCityId === city2Match.id;

        console.log(`[${VERSION}] Comparison: c1(${city1Match.id})↔sender(${senderCityId})=${c1MatchesSender}, c1↔receiver(${receiverCityId})=${c1MatchesReceiver}, c2(${city2Match.id})↔sender=${c2MatchesSender}, c2↔receiver=${c2MatchesReceiver}`);

        if (c1MatchesSender && c2MatchesReceiver) {
          // Direction already matches
          results.push({ invoice, success: true, message: "Направление уже соответствует" });
          continue;
        }


        // Determine which interpretation makes more sense
        // Interpretation A: city1=sender, city2=receiver
        // Interpretation B: city1=receiver, city2=sender
        const matchesA = (c1MatchesSender ? 1 : 0) + (c2MatchesReceiver ? 1 : 0);
        const matchesB = (c2MatchesSender ? 1 : 0) + (c1MatchesReceiver ? 1 : 0);

        if (matchesA >= matchesB) {
          // Interpretation A: city1=sender, city2=receiver
          if (!c1MatchesSender) {
            changeSender = true;
            senderTargetCityId = city1Match.id;
            senderTargetCityName = city1Match.name;
          }
          if (!c2MatchesReceiver) {
            changeReceiver = true;
            receiverTargetCityId = city2Match.id;
            receiverTargetCityName = city2Match.name;
          }
        } else {
          // Interpretation B: city2=sender, city1=receiver
          if (!c2MatchesSender) {
            changeSender = true;
            senderTargetCityId = city2Match.id;
            senderTargetCityName = city2Match.name;
          }
          if (!c1MatchesReceiver) {
            changeReceiver = true;
            receiverTargetCityId = city1Match.id;
            receiverTargetCityName = city1Match.name;
          }
        }
      } else {
        // Single city — change sender to that city
        const singleCity = city2Match || city1Match!;
        if (senderCityId !== singleCity.id) {
          changeSender = true;
          senderTargetCityId = singleCity.id;
          senderTargetCityName = singleCity.name;
        } else {
          results.push({ invoice, success: true, message: "Город отправителя уже соответствует" });
          continue;
        }
      }

      await supabase.from("execution_logs").insert({
        task_id: taskId, action: "change_sender_direction", step: "direction_analysis",
        request_data: { sender_city: senderCityName, sender_city_id: senderCityId, receiver_city: receiverCityName, receiver_city_id: receiverCityId },
        response_data: { change_sender: changeSender, change_receiver: changeReceiver, sender_target: senderTargetCityName, receiver_target: receiverTargetCityName },
        success: true,
      });

      const newAddress = aiResult.address;
      const newSenderData = aiResult.sender;

      // ---- CHANGE SENDER if needed ----
      if (changeSender) {
        let currentStreet = newAddress?.street || stripCityFromAddress(sender.street || "", allCities);
        const currentHouse = newAddress?.house || sender.house || "";
        let newFullAddress = newAddress?.full_address || stripCityFromAddress(sender.full_address || "", allCities);
        let newLatitude = sender.latitude != null ? Number(sender.latitude) : null;
        let newLongitude = sender.longitude != null ? Number(sender.longitude) : null;

        // Geocode in new city
        const yandexApiKey = settings.yandex_geocoder_api_key;
        if (yandexApiKey && (currentStreet || currentHouse)) {
          const geoQuery = `${senderTargetCityName}, ${currentStreet} ${currentHouse}`.trim();
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
          } catch (geoErr: any) {
            console.warn(`[${VERSION}] Sender geocoding failed: ${geoErr.message}`);
          }
        }

        // Fallback: city center
        if (newLatitude == null || newLongitude == null) {
          if (yandexApiKey) {
            try {
              const cityGeoResp = await fetch(
                `https://geocode-maps.yandex.ru/1.x?apikey=${encodeURIComponent(yandexApiKey)}&lang=ru_RU&format=json&geocode=${encodeURIComponent(senderTargetCityName)}`
              );
              const cityGeoData = await cityGeoResp.json();
              const cityPos = cityGeoData?.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject?.Point?.pos;
              if (cityPos) {
                const [lon, lat] = cityPos.split(" ").map(Number);
                newLatitude = lat;
                newLongitude = lon;
              }
            } catch (_) {}
          }
        }

        const senderTitle = newSenderData?.full_name || sender.title;
        const senderEntity = newSenderData?.entity || newSenderData?.full_name || sender.entity || sender.title;
        const senderFullName = newSenderData?.full_name || sender.full_name;
        const senderPhone = newSenderData?.phone ? normalizePhone(newSenderData.phone) : sender.phone;
        const senderAdditionalPhone = newSenderData?.additional_phone ? normalizePhone(newSenderData.additional_phone) : (sender.additional_phone || null);

        const updatePayload: any = {
          title: senderTitle, entity: senderEntity, full_name: senderFullName,
          phone: senderPhone, additional_phone: senderAdditionalPhone,
          city_id: Number(senderTargetCityId),
          latitude: newLatitude, longitude: newLongitude,
          street: currentStreet, house: currentHouse, full_address: newFullAddress,
          comment: sender.comment || null, office: sender.office || null,
          index: sender.index ? String(sender.index).substring(0, 10) : null,
          company_id: sender.company_id || null, id: sender.id,
          warehouse_id: null,
        };

        await supabase.from("execution_logs").insert({
          task_id: taskId, action: "change_sender_direction", step: "sender_before_after",
          request_data: { before_city: senderCityName, before_city_id: senderCityId },
          response_data: { after_city: senderTargetCityName, after_city_id: senderTargetCityId, after_address: newFullAddress },
          success: true,
        });

        if (!dryRun) {
          console.log(`[${VERSION}] PUT /senders/${sender.id} sender direction: city_id=${senderTargetCityId} (${senderTargetCityName})`);
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
            task_id: taskId, action: "change_sender_direction", step: "update_sender_api",
            request_data: { endpoint: `PUT ${sparkUrl}/senders/${sender.id}`, body: updatePayload },
            response_data: { status: updateResp.status }, success: true,
          });
        }
      }

      // ---- CHANGE RECEIVER if needed ----
      if (changeReceiver && receiver?.id) {
        let recStreet = stripCityFromAddress(receiver.street || "", allCities);
        const recHouse = receiver.house || "";
        let recFullAddress = stripCityFromAddress(receiver.full_address || "", allCities);
        let recLat = receiver.latitude != null ? Number(receiver.latitude) : null;
        let recLon = receiver.longitude != null ? Number(receiver.longitude) : null;

        const yandexApiKey = settings.yandex_geocoder_api_key;
        if (yandexApiKey && (recStreet || recHouse)) {
          const geoQuery = `${receiverTargetCityName}, ${recStreet} ${recHouse}`.trim();
          try {
            const geoResp = await fetch(
              `https://geocode-maps.yandex.ru/1.x?apikey=${encodeURIComponent(yandexApiKey)}&lang=ru_RU&format=json&geocode=${encodeURIComponent(geoQuery)}`
            );
            const geoData = await geoResp.json();
            const geoMember = geoData?.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject;
            const pos = geoMember?.Point?.pos;
            if (pos) {
              const [lon, lat] = pos.split(" ").map(Number);
              recLat = lat;
              recLon = lon;
              const formattedAddr = geoMember?.metaDataProperty?.GeocoderMetaData?.text || "";
              if (formattedAddr) recFullAddress = formattedAddr;
            }
          } catch (_) {}
        }

        if (recLat == null || recLon == null) {
          if (yandexApiKey) {
            try {
              const cityGeoResp = await fetch(
                `https://geocode-maps.yandex.ru/1.x?apikey=${encodeURIComponent(yandexApiKey)}&lang=ru_RU&format=json&geocode=${encodeURIComponent(receiverTargetCityName)}`
              );
              const cityGeoData = await cityGeoResp.json();
              const cityPos = cityGeoData?.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject?.Point?.pos;
              if (cityPos) {
                const [lon, lat] = cityPos.split(" ").map(Number);
                recLat = lat;
                recLon = lon;
              }
            } catch (_) {}
          }
        }

        const receiverPayload: any = {
          title: receiver.title, entity: receiver.entity || receiver.title,
          full_name: receiver.full_name, phone: receiver.phone,
          additional_phone: receiver.additional_phone || null,
          city_id: Number(receiverTargetCityId),
          latitude: recLat, longitude: recLon,
          street: recStreet, house: recHouse, full_address: recFullAddress,
          flat: receiver.flat || "", comment: receiver.comment || null,
          office: receiver.office || null, index: receiver.index ? String(receiver.index).substring(0, 10) : null,
          company_id: receiver.company_id || null, id: receiver.id,
          sender_id: receiver.sender_id || null, warehouse_id: receiver.warehouse_id || null,
        };

        await supabase.from("execution_logs").insert({
          task_id: taskId, action: "change_sender_direction", step: "receiver_before_after",
          request_data: { before_city: receiverCityName, before_city_id: receiverCityId },
          response_data: { after_city: receiverTargetCityName, after_city_id: receiverTargetCityId },
          success: true,
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
            task_id: taskId, action: "change_sender_direction", step: "update_receiver_api",
            request_data: { endpoint: `PUT ${sparkUrl}/receivers/${receiver.id}`, body: receiverPayload },
            response_data: { status: updateResp.status }, success: true,
          });
        }
      }

      const changedParts: string[] = [];
      if (changeSender) changedParts.push(`отправитель→${senderTargetCityName}`);
      if (changeReceiver) changedParts.push(`получатель→${receiverTargetCityName}`);

      results.push({
        invoice, success: true, dry_run: dryRun || undefined,
        changed: changedParts.join(", ") || "nothing",
        before: { sender_city: senderCityName, receiver_city: receiverCityName },
        after: { sender_city: changeSender ? senderTargetCityName : senderCityName, receiver_city: changeReceiver ? receiverTargetCityName : receiverCityName },
      });
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
