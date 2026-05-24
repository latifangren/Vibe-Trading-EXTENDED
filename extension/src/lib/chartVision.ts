export interface ChartScreenshot {
  dataUrl: string;
  mimeType: "image/jpeg";
  label: string;
  title: string;
  url: string;
  capturedAt: string;
}

export interface CaptureVisibleChartRequest {
  type: "capture-visible-chart";
}

export type CaptureVisibleChartResponse =
  | { ok: true; screenshot: ChartScreenshot }
  | { ok: false; error: string };

export class ChartScreenshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChartScreenshotError";
  }
}

function chromeApiAvailable(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.runtime?.sendMessage);
}

export async function captureVisibleChartScreenshot(): Promise<ChartScreenshot> {
  if (!chromeApiAvailable()) {
    throw new ChartScreenshotError("Chart screenshots are available only inside the Chrome extension.");
  }

  const response = await chrome.runtime.sendMessage<CaptureVisibleChartRequest, CaptureVisibleChartResponse>({
    type: "capture-visible-chart",
  });
  if (!response) {
    throw new ChartScreenshotError("Could not capture the visible chart. You can still send without a screenshot.");
  }
  if (!response.ok) {
    throw new ChartScreenshotError(response.error);
  }
  return response.screenshot;
}

export function chartScreenshotLabel(screenshot: ChartScreenshot): string {
  const host = new URL(screenshot.url).hostname || screenshot.url;
  return `${screenshot.title || "Visible chart"} - ${host}`;
}

export interface ChartLikePageContext {
  title: string;
  url: string;
  selectedText?: string;
  pageTextExcerpt?: string;
}

const chartHostHints = [
  "tradingview.com",
  "binance.com",
  "coinbase.com",
  "okx.com",
  "bybit.com",
  "koyfin.com",
  "finviz.com",
  "stockcharts.com",
  "marketscreener.com",
  "investing.com",
  "thinkorswim.com",
  "webull.com",
];

const chartTextHints = [
  "chart",
  "candlestick",
  "candle",
  "ohlc",
  "volume",
  "order book",
  "watchlist",
  "timeframe",
  "indicator",
  "rsi",
  "macd",
  "ema",
  "sma",
  "bollinger",
  "fibonacci",
  "support",
  "resistance",
  "tradingview",
];

export function isChartLikePage(context: ChartLikePageContext): boolean {
  const url = context.url.toLowerCase();
  const pageText = `${context.selectedText ?? ""} ${context.pageTextExcerpt ?? ""}`.toLowerCase();
  const hostMatches = chartHostHints.some((hint) => url.includes(hint));
  const urlMatches = /\/chart|\/markets|\/trade|\/trading|\/symbols|symbol=|ticker=|pair=/i.test(context.url);
  const titleMatches = /chart|tradingview|candlestick|market|ohlc|ticker|trade/i.test(context.title);
  const hintMatches = chartTextHints.reduce((count, hint) => count + (pageText.includes(hint) ? 1 : 0), 0);

  return hostMatches || (urlMatches && titleMatches) || hintMatches >= 2 || (titleMatches && hintMatches >= 1);
}
