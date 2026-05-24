import { describe, expect, it, vi } from "vitest";
import {
  ACTIVE_SIDEPANEL_SESSION_ID_KEY,
  clearActiveSidepanelSessionId,
  getActiveSidepanelSessionId,
  saveActiveSidepanelSessionId,
} from "@/lib/sessionContinuity";

describe("sidepanel session continuity", () => {
  it("persists and loads active sidepanel session id from chrome storage", async () => {
    vi.mocked(chrome.storage.local.get).mockImplementation((keys, callback) => {
      expect(keys).toEqual([ACTIVE_SIDEPANEL_SESSION_ID_KEY]);
      callback({ [ACTIVE_SIDEPANEL_SESSION_ID_KEY]: " session-1 " });
    });

    await saveActiveSidepanelSessionId("session-1");
    await expect(getActiveSidepanelSessionId()).resolves.toBe("session-1");

    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      { [ACTIVE_SIDEPANEL_SESSION_ID_KEY]: "session-1" },
      expect.any(Function),
    );
  });

  it("clears active sidepanel session id without deleting backend session", async () => {
    await clearActiveSidepanelSessionId();

    expect(chrome.storage.local.remove).toHaveBeenCalledWith(
      ACTIVE_SIDEPANEL_SESSION_ID_KEY,
      expect.any(Function),
    );
  });
});
