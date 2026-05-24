import type { ImageAttachmentPayload } from "@/lib/backendClient";
import {
  captureCurrentTabContext,
  formatTabContextPromptWithinBudget,
  toTabContextWarning,
  type TabContext,
} from "@/lib/tabContext";
import {
  captureVisibleChartScreenshot,
  isChartLikePage,
  type ChartScreenshot,
} from "@/lib/chartVision";

export interface PreparedOutboundMessage {
  content: string;
  tabContext: TabContext | null;
  tabContextWarning: string;
  chartScreenshot: ChartScreenshot | null;
  chartScreenshotWarning: string;
  imageAttachments?: ImageAttachmentPayload[];
}

export interface PrepareOutboundMessageOptions {
  captureTabContext?: () => Promise<TabContext>;
  captureChartScreenshot?: () => Promise<ChartScreenshot>;
}

export async function prepareOutboundMessage(
  question: string,
  options: PrepareOutboundMessageOptions = {},
): Promise<PreparedOutboundMessage> {
  const captureTab = options.captureTabContext ?? captureCurrentTabContext;
  const captureChart = options.captureChartScreenshot ?? captureVisibleChartScreenshot;
  let tabContext: TabContext | null = null;
  let tabContextWarning = "";
  let content = question;

  try {
    tabContext = await captureTab();
    content = formatTabContextPromptWithinBudget(question, tabContext);
  } catch (error) {
    tabContextWarning = toTabContextWarning(error);
  }

  let chartScreenshot: ChartScreenshot | null = null;
  let chartScreenshotWarning = "";

  if (tabContext && isChartLikePage(tabContext)) {
    try {
      chartScreenshot = await captureChart();
    } catch (error) {
      chartScreenshotWarning = error instanceof Error
        ? error.message
        : "Could not attach visible chart screenshot.";
    }
  }

  const imageAttachments = chartScreenshot
    ? [{ data_url: chartScreenshot.dataUrl, mime_type: chartScreenshot.mimeType, label: chartScreenshot.label }]
    : undefined;

  return {
    content,
    tabContext,
    tabContextWarning,
    chartScreenshot,
    chartScreenshotWarning,
    imageAttachments,
  };
}
