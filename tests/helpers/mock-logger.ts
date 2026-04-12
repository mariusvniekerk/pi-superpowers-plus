/**
 * Shared logger mock factory for tests that need to assert on log calls.
 *
 * Usage in test files:
 *
 * ```ts
 * import { vi } from "vitest";
 * import { createMockLogger } from "../../helpers/mock-logger.js";
 *
 * vi.mock("../../../extensions/logging.js", async (importOriginal) => {
 *   const actual = await importOriginal<typeof import("../../../extensions/logging.js")>();
 *   return { ...actual, log: createMockLogger() };
 * });
 * ```
 *
 * Note: vi.mock is hoisted, so the mock call must remain in each test file.
 * This helper eliminates the duplicated mock object literal.
 */
import { vi } from "vitest";
import type { Logger } from "../../extensions/logging.js";

export type MockLogger = Logger & {
  info: ReturnType<typeof vi.fn<(message: string) => void>>;
  warn: ReturnType<typeof vi.fn<(message: string) => void>>;
  error: ReturnType<typeof vi.fn<(message: string, err?: unknown) => void>>;
  debug: ReturnType<typeof vi.fn<(message: string) => void>>;
};

export function createMockLogger(): MockLogger {
  return {
    info: vi.fn<(message: string) => void>(),
    warn: vi.fn<(message: string) => void>(),
    error: vi.fn<(message: string, err?: unknown) => void>(),
    debug: vi.fn<(message: string) => void>(),
  } as MockLogger;
}
