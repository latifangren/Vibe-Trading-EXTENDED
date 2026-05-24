const ACTIVE_SIDEPANEL_SESSION_ID_KEY = "vibe_trading_extension_active_sidepanel_session_id";

let memorySessionId: string | null = null;

function chromeStorage(): chrome.storage.LocalStorageArea | null {
  if (typeof chrome === "undefined") return null;
  return chrome.storage?.local ?? null;
}

export async function getActiveSidepanelSessionId(): Promise<string | null> {
  const storage = chromeStorage();
  if (!storage) return memorySessionId;

  return await new Promise((resolve) => {
    storage.get([ACTIVE_SIDEPANEL_SESSION_ID_KEY], (items) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      const storedSessionId = items[ACTIVE_SIDEPANEL_SESSION_ID_KEY];
      resolve(typeof storedSessionId === "string" && storedSessionId.trim() ? storedSessionId.trim() : null);
    });
  });
}

export async function saveActiveSidepanelSessionId(sessionId: string): Promise<void> {
  const nextSessionId = sessionId.trim();
  memorySessionId = nextSessionId || null;
  const storage = chromeStorage();
  if (!storage || !nextSessionId) return;

  await new Promise<void>((resolve) => {
    storage.set({ [ACTIVE_SIDEPANEL_SESSION_ID_KEY]: nextSessionId }, () => resolve());
  });
}

export async function clearActiveSidepanelSessionId(): Promise<void> {
  memorySessionId = null;
  const storage = chromeStorage();
  if (!storage) return;

  if (typeof storage.remove === "function") {
    await new Promise<void>((resolve) => {
      storage.remove(ACTIVE_SIDEPANEL_SESSION_ID_KEY, () => resolve());
    });
    return;
  }

  await new Promise<void>((resolve) => {
    storage.set({ [ACTIVE_SIDEPANEL_SESSION_ID_KEY]: "" }, () => resolve());
  });
}

export { ACTIVE_SIDEPANEL_SESSION_ID_KEY };
