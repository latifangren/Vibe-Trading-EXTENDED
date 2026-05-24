import { vi } from "vitest";

type ChromeMockOverrides = Partial<ReturnType<typeof createChromeMock>>;

export function createChromeMock(overrides: ChromeMockOverrides = {}) {
  const runtimeMessage = vi.fn(async () => undefined);
  const permissionsRequest = vi.fn(async () => true);
  const permissionsContains = vi.fn(async () => false);
  const permissionsRemove = vi.fn(async () => true);
  const tabsCaptureVisibleTab = vi.fn(async () => "data:image/jpeg;base64,QUJD");
  const tabsQuery = vi.fn((queryInfo: chrome.tabs.QueryInfo, callback: (tabs: chrome.tabs.Tab[]) => void) => {
    void queryInfo;
    callback([]);
  });
  const scriptingExecuteScript = vi.fn(async () => [] as chrome.scripting.InjectionResult[]);
  const storageGet = vi.fn((keys: string | string[] | Record<string, unknown>, callback: (items: Record<string, unknown>) => void) => {
    void keys;
    callback({});
  });
  const storageSet = vi.fn((values: Record<string, unknown>, callback?: () => void) => {
    void values;
    callback?.();
  });
  const storageRemove = vi.fn((keys: string | string[], callback?: () => void) => {
    void keys;
    callback?.();
  });
  const sidePanelSetPanelBehavior = vi.fn(async () => undefined);

  const chromeMock = {
    permissions: {
      request: permissionsRequest,
      contains: permissionsContains,
      remove: permissionsRemove,
    },
    tabs: {
      query: tabsQuery,
      captureVisibleTab: tabsCaptureVisibleTab,
    },
    scripting: {
      executeScript: scriptingExecuteScript,
    },
    runtime: {
      lastError: undefined as chrome.runtime.LastError | undefined,
      sendMessage: runtimeMessage,
      onMessage: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
        hasListener: vi.fn(() => false),
      },
    },
    storage: {
      local: {
        get: storageGet,
        set: storageSet,
        remove: storageRemove,
      },
    },
    sidePanel: {
      setPanelBehavior: sidePanelSetPanelBehavior,
    },
  };

  return { ...chromeMock, ...overrides };
}

