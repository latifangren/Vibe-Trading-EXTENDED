import { describe, expect, it } from "vitest";
import {
  formatTabContextPrompt,
  type CaptureCurrentTabRequest,
  type CaptureCurrentTabResponse,
  type GetPermissionStateRequest,
  type GetPermissionStateResponse,
  type TabContext,
} from "@/lib/tabContextShared";

describe("tab context shared contracts", () => {
  it("keeps capture request shape compatible", () => {
    const request: CaptureCurrentTabRequest = { type: "capture-current-tab", preferredMode: "safe" };
    expect(request.type).toBe("capture-current-tab");
    expect(request.preferredMode).toBe("safe");
  });

  it("keeps get-permission-state request shape", () => {
    const request: GetPermissionStateRequest = { type: "get-permission-state" };
    expect(request.type).toBe("get-permission-state");
  });

  it("formats prompt unchanged", () => {
    const context: TabContext = {
      title: "Example",
      url: "https://example.com",
      selectedText: "Hello",
      pageTextExcerpt: "Page body",
    };

    expect(formatTabContextPrompt("What now?", context)).toContain("User question:\nWhat now?");
  });

  it("models capture and permission responses", () => {
    const success: CaptureCurrentTabResponse = {
      ok: true,
      context: {
        title: "Example",
        url: "https://example.com",
        selectedText: "Hello",
        pageTextExcerpt: "Body",
      },
      mode: "safe",
      state: { mode: "safe", preferredMode: "safe" },
    };
    const failure: GetPermissionStateResponse = { ok: false, error: "Nope" };

    expect(success.ok).toBe(true);
    expect(failure.ok).toBe(false);
  });
});
