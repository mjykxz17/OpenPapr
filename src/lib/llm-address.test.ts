import { afterEach, describe, expect, it } from "vitest";
import { checkBaseUrlAddress, isPrivateAddress, privateUrlsAllowed, setAddressLookup } from "./llm-address";

const resolvesTo = (...addresses: string[]) => setAddressLookup(async () => addresses.map((address) => ({ address })));

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.10", "169.254.169.254",
    "100.64.0.1", "100.127.255.255", "0.0.0.0", "224.0.0.1", "255.255.255.255",
    "::", "::1", "::ffff:10.0.0.1", "::ffff:a00:1", "::ffff:8.8.8.8", "::10.0.0.1",
    "fc00::1", "fd12:3456::1", "fdaa:0:1::3", "fe80::1%eth0", "ff02::1", "[::1]",
    "64:ff9b::10.0.0.1", "2002:a00:1::1", "not an address",
  ])("refuses %s", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });
  it.each(["8.8.8.8", "104.18.2.1", "172.32.0.1", "100.128.0.1", "2606:4700::1111", "2a00:1450:4001::200e", "64:ff9b::8.8.8.8"])("allows %s", (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
});

describe("checkBaseUrlAddress", () => {
  afterEach(() => setAddressLookup(null));

  it("passes a host whose every answer is public", async () => {
    resolvesTo("104.18.2.1", "2606:4700::1111");
    expect(await checkBaseUrlAddress("https://api.example.com/v1", false)).toEqual({ ok: true });
  });
  it("refuses a public name that resolves to a private address", async () => {
    resolvesTo("127.0.0.1");
    expect(await checkBaseUrlAddress("https://127.0.0.1.nip.io/v1", false))
      .toEqual({ ok: false, error: "that base URL points at a private network address" });
  });
  it("refuses when any one answer is private", async () => {
    resolvesTo("104.18.2.1", "fdaa:0:1::3");
    expect((await checkBaseUrlAddress("https://mixed.example/v1", false)).ok).toBe(false);
  });
  it("refuses the cloud metadata address and private names without a lookup", async () => {
    setAddressLookup(async () => { throw new Error("should not look up"); });
    expect((await checkBaseUrlAddress("https://169.254.169.254/latest", false)).ok).toBe(false);
    expect((await checkBaseUrlAddress("https://[::ffff:a9fe:a9fe]/latest", false)).ok).toBe(false);
    expect((await checkBaseUrlAddress("https://openpapr.internal/v1", false)).ok).toBe(false);
  });
  it("reports a host that does not resolve", async () => {
    setAddressLookup(async () => { throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }); });
    expect(await checkBaseUrlAddress("https://nowhere.example/v1", false))
      .toEqual({ ok: false, error: "could not reach that base URL", unreachable: true });
  });

  it("lets a self-hoster who opted in reach a local model, over plain HTTP too", async () => {
    resolvesTo("127.0.0.1");
    expect(await checkBaseUrlAddress("http://localhost:11434/v1", true)).toEqual({ ok: true });
    expect(await checkBaseUrlAddress("https://10.0.0.5/v1", true)).toEqual({ ok: true });
  });
  it("still wants HTTPS for a public address, even when opted in", async () => {
    resolvesTo("104.18.2.1");
    expect(await checkBaseUrlAddress("http://api.example.com/v1", true))
      .toEqual({ ok: false, error: "the base URL must start with https://" });
  });
});

describe("privateUrlsAllowed", () => {
  it("is on only when the flag is exactly 1", () => {
    expect(privateUrlsAllowed({ ALLOW_PRIVATE_LLM_URLS: "1" })).toBe(true);
    expect(privateUrlsAllowed({ ALLOW_PRIVATE_LLM_URLS: "true" })).toBe(false);
    expect(privateUrlsAllowed({})).toBe(false);
  });
});
