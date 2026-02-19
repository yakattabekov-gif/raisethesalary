import { VERSION, extractTextFromADF } from "./helpers.ts";

export async function fetchJiraComments(settings: Record<string, string>, auth: string, issueKey: string): Promise<string> {
  try {
    const baseUrl = settings.jira_base_url.replace(/\/+$/, "");
    const resp = await fetch(`${baseUrl}/rest/api/3/issue/${issueKey}/comment`, {
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    });
    if (!resp.ok) {
      console.error(`[${VERSION}] Failed to fetch comments for ${issueKey}: ${resp.status}`);
      return "";
    }
    const data = await resp.json();
    const comments = data.comments || [];
    const commentTexts: string[] = [];
    for (const comment of comments) {
      const body = comment.body;
      let text = "";
      if (typeof body === "string") {
        text = body;
      } else if (body?.content) {
        text = body.content.map((block: any) => extractTextFromADF(block)).filter(Boolean).join("\n");
      }
      // Skip bot comments
      if (text.includes("✅") || text.includes("❌") || text.includes("⚠️") || text.includes("🔸") || text.includes("🔄")) continue;
      if (text.trim()) commentTexts.push(text.trim());
    }
    return commentTexts.join("\n");
  } catch (e: any) {
    console.error(`[${VERSION}] Error fetching comments for ${issueKey}:`, e.message);
    return "";
  }
}

export async function addJiraComment(settings: Record<string, string>, auth: string, issueKey: string, commentText: string) {
  try {
    const baseUrl = settings.jira_base_url.replace(/\/+$/, "");
    const resp = await fetch(`${baseUrl}/rest/api/3/issue/${issueKey}/comment`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        body: {
          type: "doc", version: 1,
          content: [{ type: "paragraph", content: [{ type: "text", text: commentText }] }],
        },
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[${VERSION}] Failed to add comment to ${issueKey}: ${resp.status} - ${errText}`);
    } else {
      console.log(`[${VERSION}] Comment added to ${issueKey}`);
    }
  } catch (e: any) {
    console.error(`[${VERSION}] Error adding comment to ${issueKey}:`, e.message);
  }
}

export async function transitionJiraIssue(settings: Record<string, string>, auth: string, issueKey: string) {
  try {
    const baseUrl = settings.jira_base_url.replace(/\/+$/, "");
    const url = `${baseUrl}/rest/api/3/issue/${issueKey}/transitions`;
    const transResp = await fetch(url, {
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    });
    if (!transResp.ok) {
      console.error(`[${VERSION}] Failed to get transitions for ${issueKey}: ${transResp.status}`);
      return;
    }
    const transData = await transResp.json();
    console.log(`[${VERSION}] Available transitions for ${issueKey}:`, JSON.stringify(transData.transitions?.map((t: any) => ({ id: t.id, name: t.name }))));

    const doneTransition = transData.transitions?.find(
      (t: any) => {
        const name = t.name.toLowerCase();
        return name.includes("done") || name.includes("готово") || name.includes("закрыт") || name.includes("выполнен") || name.includes("resolved");
      }
    );

    if (doneTransition) {
      console.log(`[${VERSION}] Transitioning ${issueKey} to "${doneTransition.name}" (id: ${doneTransition.id})`);
      const postResp = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
        body: JSON.stringify({ transition: { id: doneTransition.id } }),
      });
      if (!postResp.ok) {
        const errText = await postResp.text();
        console.error(`[${VERSION}] Transition POST failed: ${postResp.status} - ${errText}`);
      } else {
        console.log(`[${VERSION}] Transition successful for ${issueKey}`);
      }
    } else {
      console.error(`[${VERSION}] No "done" transition found for ${issueKey}. Available: ${JSON.stringify(transData.transitions?.map((t: any) => t.name))}`);
    }
  } catch (e) {
    console.error(`[${VERSION}] Failed to transition Jira issue ${issueKey}:`, e);
  }
}
