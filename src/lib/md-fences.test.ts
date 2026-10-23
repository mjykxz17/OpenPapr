import { describe, expect, it } from "vitest";
import { fenceRoles } from "./md-fences";

const roles = (md: string) => fenceRoles(md.split("\n"));

describe("fenceRoles", () => {
  it("reads a plain fence", () => {
    expect(roles("a\n```js\nx\n```\nb").roles).toEqual(["text", "open", "code", "close", "text"]);
  });

  it("keeps a ``` shown inside a longer fence as code", () => {
    const r = roles("````markdown\n```mermaid\ngraph TD\n```\n````\nafter");
    expect(r.roles).toEqual(["open", "code", "code", "code", "close", "text"]);
    expect(r.open).toBeNull();
  });

  it("does not let a line with an info string close a fence", () => {
    expect(roles("```\nx\n```python\ny\n```").roles).toEqual(["open", "code", "code", "code", "close"]);
  });

  it("reads tilde fences, and backticks inside them are code", () => {
    expect(roles("~~~\n```\n~~~").roles).toEqual(["open", "code", "close"]);
  });

  it("reads indented fences in list items", () => {
    expect(roles("- step\n   ```bash\n   ls\n   ```\n- next").roles).toEqual(["text", "open", "code", "close", "text"]);
  });

  it("does not take inline code at the start of a line for a fence", () => {
    expect(roles("```a``` is inline\nmore").roles).toEqual(["text", "text"]);
  });

  it("reports a fence left open", () => {
    expect(roles("```js\nx").open).toEqual({ char: "`", len: 3, indent: "" });
  });
});
