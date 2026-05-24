import { describe, expect, it } from "vitest";
import { BACKEND_MESSAGE_CHAR_LIMIT, formatTabContextPromptWithinBudget } from "@/lib/promptBudget";
import type { TabContext } from "@/lib/tabContextShared";

function context(overrides: Partial<TabContext> = {}): TabContext {
  return {
    title: "BTCUSD chart",
    url: "https://www.tradingview.com/chart/BTCUSD",
    selectedText: "selected signal",
    pageTextExcerpt: "market body",
    ...overrides,
  };
}

describe("tab context prompt budget", () => {
  it("keeps outbound prompt under backend message limit", () => {
    const prompt = formatTabContextPromptWithinBudget("What is the setup?", context({
      selectedText: "selected ".repeat(1000),
      pageTextExcerpt: "chart volume candle rsi macd ".repeat(1000),
    }));

    expect(prompt.length).toBeLessThanOrEqual(BACKEND_MESSAGE_CHAR_LIMIT);
    expect(prompt).toContain("User question:\nWhat is the setup?");
  });

  it("trims page text before user question", () => {
    const question = "Preserve my exact question with ticker BTCUSD and entry trigger?";
    const prompt = formatTabContextPromptWithinBudget(question, context({
      selectedText: "selected text",
      pageTextExcerpt: "x".repeat(7000),
    }));

    expect(prompt).toContain(`User question:\n${question}`);
    expect(prompt.length).toBeLessThanOrEqual(BACKEND_MESSAGE_CHAR_LIMIT);
  });

  it("keeps normal-sized question even when title and URL are oversized", () => {
    const question = "Keep this user question exactly.";
    const prompt = formatTabContextPromptWithinBudget(question, context({
      title: "title".repeat(1200),
      url: `https://example.com/${"path".repeat(1200)}`,
      selectedText: "selected".repeat(1200),
      pageTextExcerpt: "page".repeat(1200),
    }));

    expect(prompt).toContain(`User question:\n${question}`);
    expect(prompt.length).toBeLessThanOrEqual(BACKEND_MESSAGE_CHAR_LIMIT);
  });

  it("drops context instead of trimming a question that fits by itself", () => {
    const question = "x".repeat(BACKEND_MESSAGE_CHAR_LIMIT - 4);
    const prompt = formatTabContextPromptWithinBudget(question, context({
      title: "title".repeat(1200),
      url: `https://example.com/${"path".repeat(1200)}`,
    }));

    expect(prompt).toBe(question);
  });
});
