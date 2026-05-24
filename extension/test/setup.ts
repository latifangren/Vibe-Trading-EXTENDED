import { afterEach, vi } from "vitest";
import { createChromeMock } from "./chromeMock";

vi.stubGlobal("chrome", createChromeMock());

afterEach(() => {
  vi.clearAllMocks();
});
