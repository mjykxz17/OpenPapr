import { htmlToText } from "../../lib/html-text";

// A lecturer's public NUS staff page, as plain text. Only https pages on an
// nus.edu.sg host are fetched, redirects included, so a pasted link can never
// point the server anywhere else.
export function isNusStaffUrl(raw: string): URL | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
    const h = u.hostname.toLowerCase();
    return h === "nus.edu.sg" || h.endsWith(".nus.edu.sg") ? u : null;
  } catch {
    return null;
  }
}

export async function fetchStaffPageText(raw: string, fetchFn: typeof fetch = fetch): Promise<string | null> {
  let url = isNusStaffUrl(raw);
  for (let hop = 0; url && hop < 4; hop++) {
    const res = await fetchFn(url.toString(), { redirect: "manual", signal: AbortSignal.timeout(15_000), headers: { Accept: "text/html" } });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      url = next ? isNusStaffUrl(new URL(next, url).toString()) : null;
      continue;
    }
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return null;
    const html = (await res.text()).slice(0, 400_000)
      .replace(/<(nav|header|footer|form|aside)\b[\s\S]*?<\/\1>/gi, " ");
    const text = htmlToText(html).replace(/\n{2,}/g, "\n").trim();
    return text ? text.slice(0, 6000) : null;
  }
  return null;
}
