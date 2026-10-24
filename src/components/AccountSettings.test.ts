import { describe, expect, it, vi } from "vitest";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, refresh() {} }) }));

const { AccountSettings } = await import("./AccountSettings");

type Props = ComponentProps<typeof AccountSettings>;
const base: Props = {
  welcome: false,
  canvasBaseUrl: "https://canvas.example.edu",
  canvas: { name: "Alex Tan", tokenHint: null, verifiedAt: null, failedAt: null },
  llm: null,
  fallback: null,
  sharedModel: null,
  usage: { calls: 12, sharedCalls: 12, limit: 300 },
  calendarUrl: null, mcpKeyAt: null,
  signIn: { username: null, hasPassword: false },
  about: {
    major: null, studyYear: null, styleLearning: true, profile: null, style: null, historyCount: 0,
    status: { builtAt: null, pending: false, error: null }, hasModel: true,
  },
  demo: null,
};
const render = (p: Partial<Props>) => renderToStaticMarkup(createElement(AccountSettings, { ...base, ...p }))
  .replace(/<!-- -->/g, "").replace(/&#x27;/g, "'");

describe("Account page for the shared demo", () => {
  const html = render({ demo: { aiModel: "agnes-2.5-flash", dailyCalls: 150 } });

  // The demo's module headers say "Canvas · synced" and its AI calls are
  // counted, so the Account page must not claim the opposite.
  it("describes the demo's Canvas and AI as they really are", () => {
    expect(html).toContain("Sample Canvas data");
    expect(html).toContain("The demo uses this server's AI (agnes-2.5-flash)");
    expect(html).toContain("12 of 150 calls used today");
    expect(html).not.toContain("Not linked");
    expect(html).not.toContain("Not set up");
  });

  // The server refuses every change to the demo, so no form should invite one.
  it("offers none of the forms the server would refuse", () => {
    for (const s of ["Replace token", "Test and save", "Base URL", "Change password", "Save sign-in", "Sign out everywhere", "Delete my account", "Make my calendar link"]) {
      expect(html).not.toContain(s);
    }
    expect(html).toContain("settings are read-only");
    expect(html).toMatch(/<fieldset disabled=""/);
    // The export refuses the demo (it would hand out other visitors' typing),
    // so the page says why instead of linking to a bare 403.
    expect(html).not.toContain("/api/account/export");
    expect(html).not.toContain("delete your account");
    expect(html).toContain("nothing to download");
  });

  it("says so when the server has no AI for the demo", () => {
    expect(render({ demo: { aiModel: null, dailyCalls: 150 } })).toContain("Off on this server");
  });
});

describe("Account page for a student", () => {
  it("keeps the forms, and offers to sign out everywhere", () => {
    const html = render({ signIn: { username: "alex", hasPassword: true } });
    for (const s of ["Replace token", "Test and save", "Change password", "Sign out everywhere", "Delete my account", "Make my calendar link", "Download my data"]) {
      expect(html).toContain(s);
    }
    expect(html).not.toContain("read-only");
    expect(html).not.toMatch(/<fieldset disabled/);
  });

  it("warns before signing out everywhere when there is no password to get back in with", () => {
    expect(render({})).toContain("Set a password above first");
    expect(render({ signIn: { username: "alex", hasPassword: true } })).not.toContain("Set a password above first");
  });
});
