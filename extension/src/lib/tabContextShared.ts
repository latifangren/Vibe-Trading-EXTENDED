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
}

export interface PageExtractionResult {
  title: string;
  selectedText: string;
  pageTextExcerpt: string;
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

  return {
    title: normalize(document.title),
    selectedText: normalize(selection).slice(0, selectedTextLimit),
    pageTextExcerpt: normalize(bodyText).slice(0, excerptLimit),
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

  return `--- Current browser tab ---\nTitle: ${context.title}\nURL: ${context.url}\n\n${selectedTextBlock}Page text excerpt:\n${context.pageTextExcerpt || "No readable page text."}\n--- End current browser tab ---\n\nUser question:\n${question}`;
}

export function tabContextLabel(context: TabContext): string {
  const host = new URL(context.url).hostname || context.url;
  const textLength = context.pageTextExcerpt.length;
  return `${context.title} - ${host} - ${textLength.toLocaleString()} chars`;
}

