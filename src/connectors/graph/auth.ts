const TOKEN_URL = "https://login.microsoftonline.com/organizations/oauth2/v2.0/token";
const DEVICE_URL = "https://login.microsoftonline.com/organizations/oauth2/v2.0/devicecode";
const SCOPE = "offline_access Mail.Read";

export interface DeviceCodeInfo { verificationUri: string; userCode: string; }

export async function runDeviceCodeFlow(clientId: string, onCode: (info: DeviceCodeInfo) => void, fetchFn: typeof fetch = fetch) {
  let res = await fetchFn(DEVICE_URL, { method: "POST", body: new URLSearchParams({ client_id: clientId, scope: SCOPE }) });
  const dc = (await res.json()) as { device_code: string; user_code: string; verification_uri: string; interval?: number; error?: string };
  if (!dc.device_code) throw new Error(`devicecode failed: ${JSON.stringify(dc)}`);
  onCode({ verificationUri: dc.verification_uri, userCode: dc.user_code });
  for (;;) {
    await new Promise((r) => setTimeout(r, (dc.interval ?? 5) * 1000));
    res = await fetchFn(TOKEN_URL, {
      method: "POST",
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", client_id: clientId, device_code: dc.device_code }),
    });
    const tok = (await res.json()) as { access_token?: string; refresh_token?: string; error?: string; error_description?: string };
    if (tok.access_token) return { accessToken: tok.access_token, refreshToken: tok.refresh_token ?? "" };
    if (tok.error !== "authorization_pending") throw new Error(`${tok.error}: ${tok.error_description}`);
  }
}

export async function refreshAccessToken(clientId: string, refreshToken: string, fetchFn: typeof fetch = fetch) {
  const res = await fetchFn(TOKEN_URL, {
    method: "POST",
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, refresh_token: refreshToken, scope: SCOPE }),
  });
  const tok = (await res.json()) as { access_token?: string; refresh_token?: string; error?: string; error_description?: string };
  if (!tok.access_token) throw new Error(`${tok.error}: ${tok.error_description}`);
  return { accessToken: tok.access_token, refreshToken: tok.refresh_token ?? refreshToken };
}
