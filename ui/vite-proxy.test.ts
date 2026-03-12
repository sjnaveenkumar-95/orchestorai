// @vitest-environment node
import { describe, expect, it } from "vitest";

import { DEFAULT_API_PROXY_TARGET, resolveApiProxyTarget } from "./vite-proxy";

describe("resolveApiProxyTarget", () => {
  it("prefers an explicit VITE_API_PROXY_TARGET", () => {
    expect(
      resolveApiProxyTarget({
        VITE_API_PROXY_TARGET: "http://127.0.0.1:3200",
        ORCHESTORAI_API_URL: "http://127.0.0.1:3101",
      }),
    ).toBe("http://127.0.0.1:3200");
  });

  it("falls back to ORCHESTORAI_API_URL when no explicit proxy target is set", () => {
    expect(
      resolveApiProxyTarget({
        ORCHESTORAI_API_URL: "http://127.0.0.1:3101",
      }),
    ).toBe("http://127.0.0.1:3101");
  });

  it("uses the default target when the configured value is blank", () => {
    expect(resolveApiProxyTarget({ ORCHESTORAI_API_URL: "   " })).toBe(DEFAULT_API_PROXY_TARGET);
  });
});
