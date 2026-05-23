chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Vibe-Trading sidebar setup failed", message);
  });
