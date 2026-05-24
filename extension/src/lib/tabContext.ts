import {
  type CaptureCurrentTabRequest,
  type CaptureCurrentTabResponse,
  DEFAULT_TAB_PERMISSION_STATE,
  setPreferredTabPermissionMode,
  type TabContext,
  type GetPermissionStateRequest,
  type GetPermissionStateResponse,
  type TabPermissionMode,
  type TabPermissionOriginPattern,
  type TabPermissionState,
} from "@/lib/tabContextShared";

export {
  DEFAULT_TAB_PERMISSION_STATE,
  formatTabContextPrompt,
  tabContextLabel,
  type TabContext,
  type TabPermissionMode,
  type TabPermissionState,
} from "@/lib/tabContextShared";

export const ENHANCED_TAB_PERMISSION_ORIGINS: TabPermissionOriginPattern[] = ["http://*/*", "https://*/*"];

export interface CapturedTabContext {
  context: TabContext;
  mode: TabPermissionMode;
  state: TabPermissionState;
}

export class TabContextError extends Error {
  constructor(
    message: string,
    readonly state?: TabPermissionState,
    readonly mode?: TabPermissionMode,
  ) {
    super(message);
    this.name = "TabContextError";
  }
}

function chromeApiAvailable(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.runtime?.sendMessage);
}

export async function getCurrentTabPermissionState(): Promise<TabPermissionState> {
  if (!chromeApiAvailable()) return DEFAULT_TAB_PERMISSION_STATE;

  const request: GetPermissionStateRequest = { type: "get-permission-state" };
  const response = await chrome.runtime.sendMessage<GetPermissionStateRequest, GetPermissionStateResponse>(request);
  if (!response) return DEFAULT_TAB_PERMISSION_STATE;
  if (!response.ok) throw new TabContextError(response.error);
  return response.state;
}

export async function savePreferredTabPermissionMode(mode: TabPermissionMode): Promise<TabPermissionState> {
  const storedState = await setPreferredTabPermissionMode(mode);
  try {
    return await getCurrentTabPermissionState();
  } catch {
    return storedState;
  }
}

export async function captureCurrentTabContextWithState(
  preferredMode?: TabPermissionMode,
): Promise<CapturedTabContext> {
  if (!chromeApiAvailable()) {
    throw new TabContextError("Tab context is available only inside the Chrome extension.");
  }

  const request: CaptureCurrentTabRequest = preferredMode
    ? { type: "capture-current-tab", preferredMode }
    : { type: "capture-current-tab" };
  const response = await chrome.runtime.sendMessage<CaptureCurrentTabRequest, CaptureCurrentTabResponse>(request);

  if (!response) {
    throw new TabContextError("Could not capture this tab. You can still send the message without browser context.");
  }

  if (!response.ok) {
    throw new TabContextError(response.error, response.state, response.mode);
  }
  return { context: response.context, mode: response.mode, state: response.state };
}

export async function captureCurrentTabContext(preferredMode?: TabPermissionMode): Promise<TabContext> {
  const result = await captureCurrentTabContextWithState(preferredMode);
  return result.context;
}

export function toTabContextWarning(error: unknown): string {
  if (error instanceof TabContextError) return error.message;
  return "Could not attach current tab context. Sending normal chat still works.";
}
