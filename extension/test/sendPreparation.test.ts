import { describe, expect, it, vi } from "vitest";
import { isChartLikePage, type ChartScreenshot } from "@/lib/chartVision";
import type { TabContext } from "@/lib/tabContextShared";
import { prepareOutboundMessage } from "@/sidepanel/sendPreparation";

function tabContext(overrides: Partial<TabContext> = {}): TabContext {
  return {
    title: "BTCUSD chart",
    url: "https://www.tradingview.com/chart/BTCUSD",
    selectedText: "",
    pageTextExcerpt: "BTCUSD candlestick chart volume RSI MACD",
    marketMetadata: {
      symbol: "BTCUSD",
      timeframe: "1h",
      price: "$71,000",
      source: "page",
      capturedAt: "2026-05-25T00:00:00.000Z",
    },
    ...overrides,
  };
}

function screenshot(): ChartScreenshot {
  return {
    dataUrl: "data:image/jpeg;base64,QUJD",
    mimeType: "image/jpeg",
    label: "visible chart screenshot",
    title: "BTCUSD chart",
    url: "https://www.tradingview.com/chart/BTCUSD",
    capturedAt: "2026-05-24T00:00:00.000Z",
  };
}

describe("chart-like detection", () => {
  it("detects TradingView and common chart pages", () => {
    expect(isChartLikePage(tabContext())).toBe(true);
    expect(isChartLikePage(tabContext({
      title: "AAPL market trade",
      url: "https://broker.example.com/trade?symbol=AAPL",
      pageTextExcerpt: "candlestick chart volume indicator",
    }))).toBe(true);
  });

  it("does not mark normal article pages as chart-like", () => {
    expect(isChartLikePage(tabContext({
      title: "Company earnings transcript",
      url: "https://example.com/news/earnings",
      pageTextExcerpt: "Revenue grew year over year with margin commentary.",
    }))).toBe(false);
  });
});

describe("automatic send preparation", () => {
  it("attaches one screenshot on chart-like pages", async () => {
    const captureChartScreenshot = vi.fn(async () => screenshot());

    const prepared = await prepareOutboundMessage("Analyze this setup", {
      captureTabContext: async () => tabContext(),
      captureChartScreenshot,
    });

    expect(captureChartScreenshot).toHaveBeenCalledTimes(1);
    expect(prepared.imageAttachments).toEqual([
      { data_url: "data:image/jpeg;base64,QUJD", mime_type: "image/jpeg", label: "visible chart screenshot" },
    ]);
    expect(prepared.content).toContain("User question:\nAnalyze this setup");
    expect(prepared.content).toContain("Market metadata:");
  });

  it("does not capture screenshot on non-chart pages", async () => {
    const captureChartScreenshot = vi.fn(async () => screenshot());

    const prepared = await prepareOutboundMessage("Summarize this", {
      captureTabContext: async () => tabContext({
        title: "Research article",
        url: "https://example.com/article",
        pageTextExcerpt: "Long-form macro commentary without trading interface.",
      }),
      captureChartScreenshot,
    });

    expect(captureChartScreenshot).not.toHaveBeenCalled();
    expect(prepared.imageAttachments).toBeUndefined();
  });

  it("captures screenshot on explicit visual request even on non-chart pages", async () => {
    const captureChartScreenshot = vi.fn(async () => screenshot());

    const prepared = await prepareOutboundMessage("Pakai text + screenshot untuk analisa", {
      captureTabContext: async () => tabContext({
        title: "Research article",
        url: "https://example.com/article",
        pageTextExcerpt: "Long-form macro commentary without trading interface.",
      }),
      captureChartScreenshot,
    });

    expect(captureChartScreenshot).toHaveBeenCalledTimes(1);
    expect(prepared.imageAttachments).toEqual([
      { data_url: "data:image/jpeg;base64,QUJD", mime_type: "image/jpeg", label: "visible chart screenshot" },
    ]);
  });

  it("captures screenshot on explicit visual request even when tab capture fails", async () => {
    const captureChartScreenshot = vi.fn(async () => screenshot());

    const prepared = await prepareOutboundMessage("Please include a screenshot of the screen", {
      captureTabContext: async () => {
        throw new Error("tab blocked");
      },
      captureChartScreenshot,
    });

    expect(captureChartScreenshot).toHaveBeenCalledTimes(1);
    expect(prepared.content).toBe("Please include a screenshot of the screen");
    expect(prepared.tabContextWarning).toBe("Screenshot attached; tab text unavailable.");
    expect(prepared.imageAttachments).toEqual([
      { data_url: "data:image/jpeg;base64,QUJD", mime_type: "image/jpeg", label: "visible chart screenshot" },
    ]);
  });

  it("captures screenshot for current tab prompt on non-chart page", async () => {
    const captureChartScreenshot = vi.fn(async () => screenshot());

    const prepared = await prepareOutboundMessage("Coba cek tab ini sekarang", {
      captureTabContext: async () => tabContext({
        title: "Research article",
        url: "https://example.com/article",
        pageTextExcerpt: "Long-form macro commentary without trading interface.",
      }),
      captureChartScreenshot,
    });

    expect(captureChartScreenshot).toHaveBeenCalledTimes(1);
    expect(prepared.imageAttachments).toEqual([
      { data_url: "data:image/jpeg;base64,QUJD", mime_type: "image/jpeg", label: "visible chart screenshot" },
    ]);
  });

  it("captures screenshot for current page prompt even when tab capture fails and softens warning", async () => {
    const captureChartScreenshot = vi.fn(async () => screenshot());

    const prepared = await prepareOutboundMessage("Gimana kalo tab ini? Tau gak tab apa?", {
      captureTabContext: async () => {
        throw new Error("tab blocked");
      },
      captureChartScreenshot,
    });

    expect(captureChartScreenshot).toHaveBeenCalledTimes(1);
    expect(prepared.content).toBe("Gimana kalo tab ini? Tau gak tab apa?");
    expect(prepared.tabContextWarning).toBe("Screenshot attached; tab text unavailable.");
    expect(prepared.imageAttachments).toEqual([
      { data_url: "data:image/jpeg;base64,QUJD", mime_type: "image/jpeg", label: "visible chart screenshot" },
    ]);
  });

  it("keeps text send non-blocking when chart capture fails", async () => {
    const prepared = await prepareOutboundMessage("Analyze this setup", {
      captureTabContext: async () => tabContext(),
      captureChartScreenshot: async () => {
        throw new Error("capture failed");
      },
    });

    expect(prepared.imageAttachments).toBeUndefined();
    expect(prepared.chartScreenshotWarning).toBe("capture failed");
    expect(prepared.content).toContain("User question:\nAnalyze this setup");
  });

  it("sends original content when tab context capture fails", async () => {
    const captureChartScreenshot = vi.fn(async () => screenshot());

    const prepared = await prepareOutboundMessage("Plain question", {
      captureTabContext: async () => {
        throw new Error("tab blocked");
      },
      captureChartScreenshot,
    });

    expect(prepared.content).toBe("Plain question");
    expect(prepared.tabContextWarning).toBe("Could not attach current tab context. Sending normal chat still works.");
    expect(captureChartScreenshot).not.toHaveBeenCalled();
  });

  it("keeps plain questions from forcing screenshot", async () => {
    const captureChartScreenshot = vi.fn(async () => screenshot());

    const prepared = await prepareOutboundMessage("Plain question", {
      captureTabContext: async () => tabContext({
        title: "Research article",
        url: "https://example.com/article",
        pageTextExcerpt: "Long-form macro commentary without trading interface.",
      }),
      captureChartScreenshot,
    });

    expect(captureChartScreenshot).not.toHaveBeenCalled();
    expect(prepared.imageAttachments).toBeUndefined();
  });
});
