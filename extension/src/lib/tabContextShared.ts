import type {
  TabPermissionMode,
  TabCaptureErrorCode,
  TabPermissionState,
} from "@/lib/permissionModes";

export const PAGE_TEXT_EXCERPT_LIMIT = 11000;
export const SELECTED_TEXT_LIMIT = 4000;

export {
  DEFAULT_TAB_PERMISSION_MODE,
  DEFAULT_TAB_PERMISSION_STATE,
  TAB_PERMISSION_MODE_STORAGE_KEY,
  createTabPermissionState,
  getPreferredTabPermissionMode,
  getTabPermissionState,
  type GetPermissionStateRequest,
  type GetPermissionStateResponse,
  type TabCaptureErrorCode,
  type TabPermissionOriginPattern,
  type TabPermissionMode,
  type TabPermissionState,
  normalizeTabPermissionMode,
  setPreferredTabPermissionMode,
} from "@/lib/permissionModes";


export interface ChartScreenshot {
  dataUrl: string;
  mimeType: "image/jpeg";
  label: string;
  title: string;
  url: string;
  capturedAt: string;
}

export interface MarketMetadata {
  symbol?: string;
  timeframe?: string;
  price?: string;
  source?: string;
  capturedAt?: string;
}

export interface CaptureVisibleChartRequest {
  type: "capture-visible-chart";
}

export type CaptureVisibleChartResponse =
  | { ok: true; screenshot: ChartScreenshot }
  | { ok: false; error: string };
export interface TabContext {
  title: string;
  url: string;
  selectedText: string;
  pageTextExcerpt: string;
  marketMetadata?: MarketMetadata;
}

export interface PageExtractionResult {
  title: string;
  selectedText: string;
  pageTextExcerpt: string;
  marketMetadata?: MarketMetadata;
}

function currentTimestamp(): string {
  return new Date().toISOString();
}

function normalizeMetadataValue(value: string | null | undefined): string | undefined {
  const nextValue = value?.trim();
  return nextValue ? nextValue : undefined;
}

function extractLabeledValue(text: string, labels: string[], valuePattern: RegExp): string | undefined {
  const labelPattern = new RegExp(`\\b(?:${labels.join("|")})\\b\\s*[:=]?\\s*(${valuePattern.source})`, valuePattern.flags.includes("i") ? valuePattern.flags : `${valuePattern.flags}i`);
  const match = text.match(labelPattern);
  return normalizeMetadataValue(match?.[1] ?? undefined);
}

function isTradingViewLike(title: string, url: string, bodyText: string): boolean {
  const combined = `${title}\n${url}\n${bodyText}`.toLowerCase();
  return combined.includes("tradingview")
    || /\/chart\//i.test(url)
    || /\b(?:chart|candlestick|candles|timeframe|interval|price|ticker|symbol|pair)\b/i.test(combined);
}

function extractQueryParamValue(pageUrl: string | undefined, keys: string[]): string | undefined {
  if (!pageUrl) return undefined;

  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return undefined;
  }

  for (const key of keys) {
    const value = normalizeMetadataValue(url.searchParams.get(key));
    if (value) return value;
  }

  return undefined;
}

function extractTradingViewSymbol(title: string, url: string, bodyText: string): string | undefined {
  const querySymbol = extractQueryParamValue(url, ["symbol", "ticker", "pair"]);
  if (querySymbol) return querySymbol.toUpperCase();

  const pathMatch = url.match(/\/chart\/([A-Za-z0-9._/-]{2,40})/i) ?? url.match(/\/symbols\/([A-Za-z0-9._/-]{2,40})/i);
  if (pathMatch) return pathMatch[1].toUpperCase();

  if (!isTradingViewLike(title, url, bodyText)) return undefined;

  const labelSymbol = extractLabeledValue(`${title}\n${bodyText}`, ["symbol", "ticker", "pair"], /[A-Za-z0-9._/-]{2,40}/);
  if (labelSymbol) return labelSymbol.toUpperCase();

  const titleMatch = title.match(/^([A-Za-z0-9._/-]{2,20})(?:\s+(?:[1-9]\d?(?:[smhdw]|min|mins|minute|minutes|hour|hours|day|days|week|weeks|month|months)?|D|W|M))?\s+(?:chart|price|candlestick|market|tradingview)\b/i)
    ?? title.match(/\b([A-Za-z0-9._/-]{2,20})(?:\s*[-—–|:])?\s+(?:chart|price|candlestick|market|tradingview)\b/i);
  return titleMatch ? titleMatch[1].toUpperCase() : undefined;
}

function extractTradingViewTimeframe(title: string, bodyText: string): string | undefined {
  const labeledTimeframe = extractLabeledValue(`${title}\n${bodyText}`, ["timeframe", "interval", "tf"], /[1-9]\d?(?:[smhdw]|min|mins|minute|minutes|hour|hours|day|days|week|weeks|month|months)?|D|W|M/);
  if (labeledTimeframe) return labeledTimeframe;

  if (!isTradingViewLike(title, "", bodyText)) return undefined;

  const inlineTimeframe = `${title}\n${bodyText}`.match(/\b([1-9]\d?(?:[smhdw]))\b/i);
  return inlineTimeframe ? inlineTimeframe[1] : undefined;
}

function extractTradingViewPrice(title: string, bodyText: string): string | undefined {
  const combined = `${title}\n${bodyText}`;
  const labeledPrice = extractLabeledValue(combined, ["last", "price", "mark", "close"], /[$€£¥]?\d[\d,]*(?:\.\d+)?(?:\s*(?:USD|USDT|BTC|ETH))?/);
  if (labeledPrice) return labeledPrice;

  if (!isTradingViewLike(title, "", bodyText)) return undefined;

  const priceMatch = combined.match(/\b([$€£¥]?\d[\d,]*(?:\.\d+)?(?:\s*(?:USD|USDT|BTC|ETH))?)\b(?=\s*(?:price|last|mark|close)\b)/i);
  return priceMatch ? priceMatch[1] : undefined;
}

export function extractMarketMetadata(source: string, title: string, bodyText: string, pageUrl?: string): MarketMetadata | undefined {
  const symbol = extractTradingViewSymbol(title, pageUrl ?? "", bodyText);
  const timeframe = extractQueryParamValue(pageUrl, ["timeframe", "interval", "tf"]) ?? extractTradingViewTimeframe(title, bodyText);
  const price = extractQueryParamValue(pageUrl, ["price", "last", "mark", "close"]) ?? extractTradingViewPrice(title, bodyText);

  if (!symbol && !timeframe && !price) return undefined;

  return {
    symbol,
    timeframe,
    price,
    source,
    capturedAt: currentTimestamp(),
  };
}

export interface CaptureCurrentTabRequest {
  type: "capture-current-tab";
  preferredMode?: TabPermissionMode;
}

export type CaptureCurrentTabResponse =
  | { ok: true; context: TabContext; mode: TabPermissionMode; state: TabPermissionState }
  | { ok: false; error: string; code: TabCaptureErrorCode; mode: TabPermissionMode; state: TabPermissionState };

export function cleanTabText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[\t\r\n]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function extractPageContext(excerptLimit: number, selectedTextLimit: number): PageExtractionResult {
  const normalize = (value: string) => value
    .replace(/\u00a0/g, " ")
    .replace(/[\t\r\n]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  const selection = window.getSelection()?.toString() ?? "";
  const bodyText = document.body?.innerText ?? document.documentElement?.textContent ?? "";
  const title = normalize(document.title);
  const selectedText = normalize(selection).slice(0, selectedTextLimit);
  const pageTextExcerpt = normalize(bodyText).slice(0, excerptLimit);
  const pageUrl = window.location.href;

  return {
    title,
    selectedText,
    pageTextExcerpt,
    marketMetadata: extractMarketMetadata("page", title, `${selectedText}\n${pageTextExcerpt}`, pageUrl),
  };
}

export function isUnsupportedTabUrl(url: string): boolean {
  return [
    "about:",
    "brave://",
    "chrome://",
    "chrome-extension://",
    "devtools://",
    "edge://",
    "view-source:",
  ].some((prefix) => url.startsWith(prefix));
}

export function tabCaptureInjectionErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/cannot access|extensions gallery|chrome:\/\/|chrome-extension:\/\//i.test(message)) {
    return "Chrome does not allow tab context on this page. Try a regular website tab.";
  }
  return "Could not capture this tab. You can still send the message without browser context.";
}

export function formatTabContextPrompt(question: string, context: TabContext): string {
  const selectedTextBlock = context.selectedText
    ? `Selected text:\n${context.selectedText}\n\n`
    : "Selected text: None\n\n";
  const marketMetadata = context.marketMetadata;
  const marketMetadataBlock = marketMetadata
    ? `Market metadata:\n${marketMetadata.symbol ? `- Symbol: ${marketMetadata.symbol}\n` : ""}${marketMetadata.timeframe ? `- Timeframe: ${marketMetadata.timeframe}\n` : ""}${marketMetadata.price ? `- Price: ${marketMetadata.price}\n` : ""}${marketMetadata.source ? `- Source: ${marketMetadata.source}\n` : ""}${marketMetadata.capturedAt ? `- Captured at: ${marketMetadata.capturedAt}\n` : ""}\n`
    : "";

  return `--- Current browser tab ---\nTitle: ${context.title}\nURL: ${context.url}\n\n${marketMetadataBlock}${selectedTextBlock}Page text excerpt:\n${context.pageTextExcerpt || "No readable page text."}\n--- End current browser tab ---\n\nUser question:\n${question}`;
}

export function tabContextLabel(context: TabContext): string {
  const host = new URL(context.url).hostname || context.url;
  const textLength = context.pageTextExcerpt.length;
  return `${context.title} - ${host} - ${textLength.toLocaleString()} chars`;
}

