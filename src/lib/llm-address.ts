import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

// The server sends a student's key, and their course material, to whatever
// base URL they typed. These checks keep that URL from pointing back inside
// the deployment: the host is resolved and every address it answers with must
// be public. A self-hoster running a model on their own network opts in with
// ALLOW_PRIVATE_LLM_URLS=1.
//
// The check runs right before each call, not only when the URL is saved, since
// DNS can change. fetch then resolves the name again itself, so a server that
// flips its answer within that gap (DNS rebinding) could still slip past;
// redirects are refused on every call, which closes the easier route.

export const privateUrlsAllowed = (env: Record<string, string | undefined> = process.env) => env.ALLOW_PRIVATE_LLM_URLS === "1";

type Cidr = [bytes: number[], bits: number];

function v4Bytes(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const b = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return b.every((n) => n >= 0 && n <= 255) ? b : null;
}

// Expands any valid IPv6 spelling (with "::", a zone, or a dotted IPv4 tail)
// to its 16 bytes.
function v6Bytes(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0]!;
  let tail: number[] = [];
  const last = s.slice(s.lastIndexOf(":") + 1);
  if (last.includes(".")) {
    const v4 = v4Bytes(last);
    if (!v4) return null;
    tail = v4;
    s = `${s.slice(0, s.length - last.length)}0:0`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const gap = 8 - head.length - rest.length;
  if (halves.length === 1 ? gap !== 0 : gap < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? gap : 0).fill("0"), ...rest];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  const bytes = groups.flatMap((g) => { const n = parseInt(g, 16); return [n >> 8, n & 0xff]; });
  if (tail.length) bytes.splice(12, 4, ...tail);
  return bytes;
}

const cidr = (spec: string): Cidr => {
  const [ip, bits] = spec.split("/");
  return [(ip!.includes(":") ? v6Bytes(ip!) : v4Bytes(ip!))!, Number(bits)];
};

function inRange(bytes: number[], [base, bits]: Cidr): boolean {
  for (let i = 0; i < bits; i += 8) {
    const take = Math.min(8, bits - i);
    const mask = (0xff << (8 - take)) & 0xff;
    if ((bytes[i / 8]! & mask) !== (base[i / 8]! & mask)) return false;
  }
  return true;
}

const V4_BLOCKED = [
  "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12",
  "192.0.0.0/24", "192.0.2.0/24", "192.168.0.0/16", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24",
  "224.0.0.0/4", "240.0.0.0/4",
].map(cidr);

const V6_BLOCKED = [
  "::/96",          // unspecified, loopback, and IPv4-compatible
  "::ffff:0:0/96",  // IPv4-mapped
  "64:ff9b:1::/48", // local-use NAT64
  "100::/64",       // discard
  "2001:db8::/32",  // documentation
  "fc00::/7",       // unique local, which includes Fly's private network fdaa::/16
  "fe80::/10", "fec0::/10", // link- and site-local
  "ff00::/8",       // multicast
].map(cidr);

// True for anything that is not a public unicast address, including input
// that is not an address at all.
export function isPrivateAddress(ip: string): boolean {
  const host = ip.replace(/^\[|\]$/g, "");
  if (isIP(host) === 4) {
    const b = v4Bytes(host);
    return !b || V4_BLOCKED.some((r) => inRange(b, r));
  }
  const b = isIP(host.split("%")[0]!) === 6 ? v6Bytes(host) : null;
  if (!b) return true;
  if (V6_BLOCKED.some((r) => inRange(b, r))) return true;
  // NAT64 and 6to4 carry an IPv4 address inside; judge that one.
  if (inRange(b, cidr("64:ff9b::/96"))) return isPrivateAddress(b.slice(12).join("."));
  if (inRange(b, cidr("2002::/16"))) return isPrivateAddress(b.slice(2, 6).join("."));
  return false;
}

// Names that only mean something inside a network, refused before any lookup.
export const isPrivateName = (host: string) =>
  host === "localhost" || /\.(localhost|local|internal|flycast)$/.test(host);

export type Lookup = (host: string) => Promise<{ address: string }[]>;
const systemLookup: Lookup = (host) => dnsLookup(host, { all: true, verbatim: true });
let lookupFn: Lookup = systemLookup;
// Tests resolve names without the network; null restores the system resolver.
export function setAddressLookup(fn: Lookup | null): void { lookupFn = fn ?? systemLookup; }

export type AddressCheck = { ok: true } | { ok: false; error: string; unreachable?: boolean };

// Resolves the base URL's host (every A and AAAA answer, as fetch would see
// them) and refuses it when any answer is private. Plain HTTP is only ever
// allowed to a private address, and only with the opt-in.
export async function checkBaseUrlAddress(raw: string, allowPrivate = privateUrlsAllowed()): Promise<AddressCheck> {
  let u: URL;
  try { u = new URL(raw); } catch { return { ok: false, error: "that base URL is not a valid address" }; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, error: "the base URL must start with https://" };
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!allowPrivate && isPrivateName(host)) return { ok: false, error: "that base URL points at a private network address" };
  let addresses: string[];
  if (isIP(host)) addresses = [host];
  else {
    try { addresses = (await lookupFn(host)).map((a) => a.address); } catch { addresses = []; }
    if (!addresses.length) return { ok: false, error: "could not reach that base URL", unreachable: true };
  }
  const allPrivate = addresses.every(isPrivateAddress);
  if (!allowPrivate && addresses.some(isPrivateAddress)) return { ok: false, error: "that base URL points at a private network address" };
  if (u.protocol === "http:" && !(allowPrivate && allPrivate)) return { ok: false, error: "the base URL must start with https://" };
  return { ok: true };
}
