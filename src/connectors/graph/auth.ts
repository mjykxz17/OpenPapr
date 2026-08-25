const TOKEN_URL = "https://login.microsoftonline.com/organizations/oauth2/v2.0/token";
const DEVICE_URL = "https://login.microsoftonline.com/organizations/oauth2/v2.0/devicecode";
const SCOPE = "offline_access Mail.Read";

export interface DeviceCodeInfo { verificationUri: string; userCode: string; }

export interface DeviceCodeStart extends DeviceCodeInfo {
  deviceCode: string;
  intervalMs: number;
  expiresInMs: number;
}

export type DeviceCodePoll =
  | { status: "pending" }
  | { status: "slow_down" }
  | { status: "ok"; accessToken: string; refreshToken: string }
  | { status: "error"; error: string };

// Split from the blocking loop below so an HTTP handler can start the flow,
// hand the code to the browser, and poll on later requests. Microsoft's device
// code flow needs no redirect URI, which is why it works from a web UI without
// registering one in the app registration.
export async function startDeviceCode(clientId: string, fetchFn: typeof fetch = fetch): Promise<DeviceCodeStart> {
  const res = await fetchFn(DEVICE_URL, { method: "POST", body: new URLSearchParams({ client_id: clientId, scope: SCOPE }) });
  const dc = (await res.json()) as {
    device_code?: string; user_code?: string; verification_uri?: string;
    interval?: number; expires_in?: number; error?: string; error_description?: string;
  };
  if (!dc.device_code || !dc.user_code || !dc.verification_uri) {
    throw new Error(`devicecode failed: ${dc.error ?? "unknown"} ${dc.error_description ?? ""}`.trim());
  }
  return {
    deviceCode: dc.device_code,
    userCode: dc.user_code,
    verificationUri: dc.verification_uri,
    intervalMs: (dc.interval ?? 5) * 1000,
    expiresInMs: (dc.expires_in ?? 900) * 1000,
  };
}

export async function pollDeviceCode(clientId: string, deviceCode: string, fetchFn: typeof fetch = fetch): Promise<DeviceCodePoll> {
  const res = await fetchFn(TOKEN_URL, {
    method: "POST",
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", client_id: clientId, device_code: deviceCode }),
  });
  const tok = (await res.json()) as { access_token?: string; refresh_token?: string; error?: string; error_description?: string };
  if (tok.access_token) return { status: "ok", accessToken: tok.access_token, refreshToken: tok.refresh_token ?? "" };
  if (tok.error === "authorization_pending") return { status: "pending" };
  if (tok.error === "slow_down") return { status: "slow_down" };
  return { status: "error", error: tok.error_description ?? tok.error ?? "unknown error" };
}

export async function runDeviceCodeFlow(clientId: string, onCode: (info: DeviceCodeInfo) => void, fetchFn: typeof fetch = fetch) {
  const start = await startDeviceCode(clientId, fetchFn);
  onCode({ verificationUri: start.verificationUri, userCode: start.userCode });
  let waitMs = start.intervalMs;
  for (;;) {
    await new Promise((r) => setTimeout(r, waitMs));
    const poll = await pollDeviceCode(clientId, start.deviceCode, fetchFn);
    if (poll.status === "ok") return { accessToken: poll.accessToken, refreshToken: poll.refreshToken };
    if (poll.status === "error") throw new Error(poll.error);
    if (poll.status === "slow_down") waitMs += 5000;
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
