import { describe, expect, test } from "@jest/globals";
import {
  createErrorMailOptions,
  ERROR_ALERT_COOLDOWN_HOURS,
  ERROR_ALERT_THRESHOLD,
  errorState,
  isTransientError,
  recordFailure,
  recordSuccess,
  VERSION,
} from "./index";

describe("index exports", () => {
  test("resolves package version correctly", () => {
    expect(VERSION).toBeDefined();
    expect(VERSION).not.toBe("unknown");
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("re-exports error tracking utilities", () => {
    expect(ERROR_ALERT_THRESHOLD).toBeDefined();
    expect(ERROR_ALERT_COOLDOWN_HOURS).toBeDefined();
    expect(errorState).toBeDefined();
    expect(typeof isTransientError).toBe("function");
    expect(typeof recordFailure).toBe("function");
    expect(typeof recordSuccess).toBe("function");
    expect(typeof createErrorMailOptions).toBe("function");
  });
});
