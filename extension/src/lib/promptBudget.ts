import { formatTabContextPrompt, type TabContext } from "@/lib/tabContextShared";

export const BACKEND_MESSAGE_CHAR_LIMIT = 5000;

function truncateToBudget(value: string, budget: number): string {
  if (budget <= 0) return "";
  return value.length <= budget ? value : value.slice(0, budget);
}

export function formatTabContextPromptWithinBudget(
  question: string,
  context: TabContext,
  maxLength = BACKEND_MESSAGE_CHAR_LIMIT,
): string {
  const nextContext = { ...context };
  let prompt = formatTabContextPrompt(question, nextContext);
  const trimOrder: Array<"pageTextExcerpt" | "selectedText" | "url" | "title"> = [
    "pageTextExcerpt",
    "selectedText",
    "url",
    "title",
  ];

  for (const field of trimOrder) {
    if (prompt.length <= maxLength) return prompt;
    const overflow = prompt.length - maxLength;
    nextContext[field] = truncateToBudget(nextContext[field], nextContext[field].length - overflow);
    prompt = formatTabContextPrompt(question, nextContext);
  }

  if (prompt.length <= maxLength) return prompt;
  return question.length <= maxLength ? question : truncateToBudget(question, maxLength);
}
