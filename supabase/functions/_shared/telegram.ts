import { VERSION, TELEGRAM_CHAT_ID } from "./helpers.ts";

export async function sendTelegramNotification(
  issueKey: string, jiraBaseUrl: string, allResults: any[], allCommentLines: string[],
  jiraSummary?: string, jiraDescription?: string
) {
  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!botToken) {
    console.log(`[${VERSION}] TELEGRAM_BOT_TOKEN not set, skipping notification`);
    return;
  }
  try {
    const jiraLink = jiraBaseUrl ? `${jiraBaseUrl.replace(/\/$/, "")}/browse/${issueKey}` : issueKey;

    const changesLines: string[] = [];
    for (const r of allResults) {
      if (!r.success) continue;
      const inv = r.invoice || r.act_number || "";
      if (r.before && r.after) {
        const before = r.before;
        const after = r.after;
        const fields: string[] = [];
        for (const key of Object.keys(after)) {
          const bVal = before[key] !== undefined ? String(before[key]) : "—";
          const aVal = String(after[key]);
          if (bVal !== aVal) {
            fields.push(`  • <b>${key}</b>: <code>${bVal}</code> → <code>${aVal}</code>`);
          }
        }
        if (fields.length > 0) {
          changesLines.push(`📦 ${inv}\n${fields.join("\n")}`);
        }
      } else if (r.changed) {
        changesLines.push(`📦 ${inv}: ${r.changed}`);
      }
    }

    const successLines = allCommentLines.filter(l => l.startsWith("✅"));

    let text = `✅ <b>Задача выполнена: ${issueKey}</b>\n`;
    text += `🔗 <a href="${jiraLink}">${issueKey}</a>\n\n`;
    if (jiraSummary) text += `📋 <b>Запрос:</b> ${jiraSummary}\n`;
    if (jiraDescription) {
      const shortDesc = jiraDescription.length > 300 ? jiraDescription.substring(0, 300) + "..." : jiraDescription;
      text += `📝 ${shortDesc}\n\n`;
    } else {
      text += `\n`;
    }
    if (changesLines.length > 0) {
      text += `<b>Изменения (До → После):</b>\n${changesLines.join("\n\n")}\n\n`;
    }
    if (successLines.length > 0) {
      text += `<b>Результат:</b>\n${successLines.join("\n")}`;
    }
    if (text.length > 4000) text = text.substring(0, 4000) + "\n...";

    const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "HTML", disable_web_page_preview: true,
      }),
    });
    const respData = await resp.json();
    if (!resp.ok) {
      console.error(`[${VERSION}] Telegram send failed:`, JSON.stringify(respData));
    } else {
      console.log(`[${VERSION}] Telegram notification sent for ${issueKey}`);
    }
  } catch (e: any) {
    console.error(`[${VERSION}] Telegram notification error:`, e.message);
  }
}
