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
