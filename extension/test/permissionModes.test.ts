import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TAB_PERMISSION_MODE,
  TAB_PERMISSION_MODE_STORAGE_KEY,
  createTabPermissionState,
  getPreferredTabPermissionMode,
  normalizeTabPermissionMode,
  setPreferredTabPermissionMode,
} from "@/lib/permissionModes";

describe("permission modes", () => {
  it("defaults to safe mode", () => {
    expect(DEFAULT_TAB_PERMISSION_MODE).toBe("safe");
    expect(TAB_PERMISSION_MODE_STORAGE_KEY).toBe("vibe_trading_extension_tab_permission_mode");
  });

  it("normalizes invalid mode to safe", () => {
    expect(normalizeTabPermissionMode("invalid")).toBe("safe");
  });

  it("builds matching permission state", () => {
    expect(createTabPermissionState("enhanced")).toEqual({
      mode: "enhanced",
      preferredMode: "enhanced",
    });
  });

  it("saves and loads preferred mode from extension storage", async () => {
    vi.mocked(chrome.storage.local.get).mockImplementation((_keys, callback) => {
      callback({ [TAB_PERMISSION_MODE_STORAGE_KEY]: "enhanced" });
    });

    await expect(setPreferredTabPermissionMode("enhanced")).resolves.toEqual({
      mode: "enhanced",
      preferredMode: "enhanced",
    });
    await expect(getPreferredTabPermissionMode()).resolves.toBe("enhanced");
    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      { [TAB_PERMISSION_MODE_STORAGE_KEY]: "enhanced" },
      expect.any(Function),
    );
  });
});
