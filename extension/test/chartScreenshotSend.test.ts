import { describe, expect, it, vi } from "vitest";
import { sendMessageWithChartScreenshot } from "@/sidepanel/App";
import type { ImageAttachmentPayload } from "@/lib/backendClient";
import type { ChartScreenshot } from "@/lib/chartVision";

function screenshot(label = "visible chart screenshot"): ChartScreenshot {
  return {
    dataUrl: `data:image/jpeg;base64,${label}`,
    mimeType: "image/jpeg",
    label,
    title: "BTCUSD chart",
    url: "https://example.com/chart",
    capturedAt: "2026-05-24T00:00:00.000Z",
  };
}

describe("sidepanel chart screenshot send behavior", () => {
  it("sends captured screenshot once after a successful send and not again until recaptured", async () => {
    let attachedScreenshot: ChartScreenshot | null = screenshot("first chart");
    const clearScreenshot = vi.fn(() => {
      attachedScreenshot = null;
    });
    const sendMessage = vi.fn<(
      sessionId: string,
      content: string,
      imageAttachments?: ImageAttachmentPayload[],
    ) => Promise<unknown>>(async () => ({ message_id: "message", attempt_id: "attempt" }));

    await sendMessageWithChartScreenshot("session-1", "First prompt", attachedScreenshot, sendMessage, clearScreenshot);
    await sendMessageWithChartScreenshot("session-1", "Second prompt", attachedScreenshot, sendMessage, clearScreenshot);
    attachedScreenshot = screenshot("second chart");
    await sendMessageWithChartScreenshot("session-1", "Third prompt", attachedScreenshot, sendMessage, clearScreenshot);

    expect(sendMessage).toHaveBeenNthCalledWith(1, "session-1", "First prompt", [
      { data_url: "data:image/jpeg;base64,first chart", mime_type: "image/jpeg", label: "first chart" },
    ]);
    expect(sendMessage).toHaveBeenNthCalledWith(2, "session-1", "Second prompt", undefined);
    expect(sendMessage).toHaveBeenNthCalledWith(3, "session-1", "Third prompt", [
      { data_url: "data:image/jpeg;base64,second chart", mime_type: "image/jpeg", label: "second chart" },
    ]);
    expect(clearScreenshot).toHaveBeenCalledTimes(2);
  });

  it("keeps captured screenshot available when backend send fails", async () => {
    let attachedScreenshot: ChartScreenshot | null = screenshot();
    const clearScreenshot = vi.fn(() => {
      attachedScreenshot = null;
    });
    const sendMessage = vi.fn<(
      sessionId: string,
      content: string,
      imageAttachments?: ImageAttachmentPayload[],
    ) => Promise<unknown>>(async () => {
      throw new Error("send failed");
    });

    await expect(
      sendMessageWithChartScreenshot("session-1", "Retryable prompt", attachedScreenshot, sendMessage, clearScreenshot),
    ).rejects.toThrow("send failed");

    expect(sendMessage).toHaveBeenCalledWith("session-1", "Retryable prompt", [
      { data_url: "data:image/jpeg;base64,visible chart screenshot", mime_type: "image/jpeg", label: "visible chart screenshot" },
    ]);
    expect(clearScreenshot).not.toHaveBeenCalled();
    expect(attachedScreenshot).toMatchObject({ label: "visible chart screenshot" });
  });
});
