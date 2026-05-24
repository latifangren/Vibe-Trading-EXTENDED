import { describe, expect, it } from "vitest";
import {
  formatTabContextPrompt,
  extractMarketMetadata,
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

  it("includes market metadata block when present", () => {
    const context: TabContext = {
      title: "BTCUSD chart",
      url: "https://www.tradingview.com/chart/BTCUSD",
      selectedText: "",
      pageTextExcerpt: "Price 71000",
      marketMetadata: {
        symbol: "BTCUSD",
        timeframe: "1h",
        price: "$71,000",
        source: "page",
        capturedAt: "2026-05-25T00:00:00.000Z",
      },
    };

    const prompt = formatTabContextPrompt("What now?", context);

    expect(prompt).toContain("Market metadata:");
    expect(prompt).toContain("- Symbol: BTCUSD");
    expect(prompt).toContain("- Timeframe: 1h");
    expect(prompt).toContain("- Price: $71,000");
    expect(prompt).toContain("- Source: page");
    expect(prompt).toContain("- Captured at: 2026-05-25T00:00:00.000Z");
  });

  it("extracts market metadata from page text when available", () => {
    const metadata = extractMarketMetadata(
      "page",
      "BTCUSD 1h chart",
      "BTCUSD price 71,000 timeframe 1h",
    );

    expect(metadata).toMatchObject({
      symbol: "BTCUSD",
      timeframe: "1h",
      price: "71,000",
      source: "page",
    });
    expect(metadata?.capturedAt).toBeDefined();
  });

  it("does not create metadata from plain article text", () => {
    const metadata = extractMarketMetadata(
      "page",
      "Company earnings transcript",
      "Revenue rose. Analyst ABC noted margin expansion and 2026 guidance.",
    );

    expect(metadata).toBeUndefined();
  });

  it("extracts metadata from explicit URL query params", () => {
    const metadata = extractMarketMetadata(
      "page",
      "Chart",
      "Open chart",
      "https://www.tradingview.com/chart/?symbol=BTCUSD&timeframe=1h&price=71000",
    );

    expect(metadata).toMatchObject({
      symbol: "BTCUSD",
      timeframe: "1h",
      price: "71000",
      source: "page",
    });
  });

  it("models capture and permission responses", () => {
    const success: CaptureCurrentTabResponse = {
      ok: true,
      context: {
        title: "Example",
        url: "https://example.com",
        selectedText: "Hello",
        pageTextExcerpt: "Body",
        marketMetadata: {
          symbol: "EXAMPLE",
          source: "page",
          capturedAt: "2026-05-25T00:00:00.000Z",
        },
      },
      mode: "safe",
      state: { mode: "safe", preferredMode: "safe" },
    };
    const failure: GetPermissionStateResponse = { ok: false, error: "Nope" };

    expect(success.ok).toBe(true);
    expect(failure.ok).toBe(false);
  });
});
