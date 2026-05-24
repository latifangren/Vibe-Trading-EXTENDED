export type TabPermissionMode = "safe" | "enhanced";
export type TabPermissionOriginPattern = "http://*/*" | "https://*/*";
export type TabCaptureErrorCode =
  | "no-active-tab"
  | "empty-url"
  | "unsupported-url"
  | "script-injection-failed"
  | "empty-capture-result";

export const DEFAULT_TAB_PERMISSION_MODE: TabPermissionMode = "safe";
export const TAB_PERMISSION_MODE_STORAGE_KEY = "vibe_trading_extension_tab_permission_mode";
export const DEFAULT_TAB_PERMISSION_STATE: TabPermissionState = {
  mode: DEFAULT_TAB_PERMISSION_MODE,
  preferredMode: DEFAULT_TAB_PERMISSION_MODE,
};

export interface TabPermissionState {
  mode: TabPermissionMode;
  preferredMode: TabPermissionMode;
  enhancedHostAccess?: boolean;
  originPattern?: TabPermissionOriginPattern;
  warning?: string;
}

export interface GetPermissionStateRequest {
  type: "get-permission-state";
}

export type GetPermissionStateResponse =
  | { ok: true; state: TabPermissionState }
  | { ok: false; error: string };

export function isTabPermissionMode(value: string): value is TabPermissionMode {
  return value === "safe" || value === "enhanced";
}

export function normalizeTabPermissionMode(value: string | null | undefined): TabPermissionMode {
  const candidate = value ?? "";
  return isTabPermissionMode(candidate) ? candidate : DEFAULT_TAB_PERMISSION_MODE;
}

export function createTabPermissionState(preferredMode?: string | null): TabPermissionState {
  const mode = normalizeTabPermissionMode(preferredMode);
  return {
    mode,
    preferredMode: mode,
  };
}

function chromeStorage(): chrome.storage.LocalStorageArea | null {
  if (typeof chrome === "undefined") return null;
  return chrome.storage?.local ?? null;
}

export async function getPreferredTabPermissionMode(): Promise<TabPermissionMode> {
  const storage = chromeStorage();
  if (!storage) return DEFAULT_TAB_PERMISSION_MODE;

  return await new Promise((resolve) => {
    storage.get([TAB_PERMISSION_MODE_STORAGE_KEY], (items) => {
      if (chrome.runtime.lastError) {
        resolve(DEFAULT_TAB_PERMISSION_MODE);
        return;
      }
      const storedMode = items[TAB_PERMISSION_MODE_STORAGE_KEY];
      resolve(normalizeTabPermissionMode(typeof storedMode === "string" ? storedMode : undefined));
    });
  });
}

export async function getTabPermissionState(): Promise<TabPermissionState> {
  const mode = await getPreferredTabPermissionMode();
  return createTabPermissionState(mode);
}

export async function setPreferredTabPermissionMode(mode: TabPermissionMode): Promise<TabPermissionState> {
  const storage = chromeStorage();
  const nextState = createTabPermissionState(mode);
  if (!storage) return nextState;

  await new Promise<void>((resolve) => {
    storage.set({ [TAB_PERMISSION_MODE_STORAGE_KEY]: nextState.preferredMode }, () => resolve());
  });
  return nextState;
}
