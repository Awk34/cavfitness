import { beforeEach, describe, expect, test } from "@jest/globals";
import {
  createErrorMailOptions,
  ERROR_ALERT_COOLDOWN_HOURS,
  ERROR_ALERT_THRESHOLD,
  errorState,
  isTransientError,
  recordFailure,
  recordSuccess,
} from "./errors";

describe("isTransientError", () => {
  test("identifies timeout and network errors as transient", () => {
    const timeoutErr = new Error("Navigation timeout of 60000 ms exceeded");
    timeoutErr.name = "TimeoutError";
    expect(isTransientError(timeoutErr)).toBe(true);

    expect(isTransientError(new Error("net::ERR_CONNECTION_RESET"))).toBe(true);
    expect(isTransientError(new Error("connect ETIMEDOUT"))).toBe(true);
    expect(isTransientError(new Error("getaddrinfo ENOTFOUND"))).toBe(true);
    expect(isTransientError(new Error("connect ECONNREFUSED"))).toBe(true);
  });

  test("identifies non-transient errors as critical", () => {
    expect(isTransientError(new Error("Cannot find selector .elementor-col"))).toBe(false);
    expect(isTransientError(new Error("Failed to parse mission text"))).toBe(false);
    expect(isTransientError(new TypeError("Cannot read properties of undefined"))).toBe(false);
  });
});

describe("error tracking and alerting", () => {
  beforeEach(() => {
    recordSuccess();
  });

  test("stores error kind, name, and message in state", () => {
    const timeoutErr = new Error("Navigation timeout of 60000 ms exceeded");
    timeoutErr.name = "TimeoutError";

    recordFailure(timeoutErr);
    expect(errorState.lastErrorKind).toBe("transient");
    expect(errorState.lastErrorName).toBe("TimeoutError");
    expect(errorState.lastErrorMessage).toBe("Navigation timeout of 60000 ms exceeded");
    expect(errorState.firstFailureDate).toBeInstanceOf(Date);
    expect(errorState.lastFailureDate).toBeInstanceOf(Date);
  });

  test("suppresses alerts for transient timeout errors below threshold", () => {
    for (let i = 1; i < ERROR_ALERT_THRESHOLD; i++) {
      const timeoutErr = new Error(`Navigation timeout attempt ${i}`);
      timeoutErr.name = "TimeoutError";
      const result = recordFailure(timeoutErr);
      expect(result.shouldAlert).toBe(false);
      expect(result.errorKind).toBe("transient");
      expect(result.consecutiveFailures).toBe(i);
      expect(errorState.consecutiveTransientFailures).toBe(i);
    }
  });

  test("triggers alert when transient timeout errors reach threshold (5x in a row)", () => {
    for (let i = 1; i < ERROR_ALERT_THRESHOLD; i++) {
      const timeoutErr = new Error(`Navigation timeout attempt ${i}`);
      timeoutErr.name = "TimeoutError";
      recordFailure(timeoutErr);
    }

    const finalTimeoutErr = new Error("Navigation timeout of 60000 ms exceeded");
    finalTimeoutErr.name = "TimeoutError";
    const alertResult = recordFailure(finalTimeoutErr);

    expect(alertResult.shouldAlert).toBe(true);
    expect(alertResult.errorKind).toBe("transient");
    expect(alertResult.consecutiveFailures).toBe(ERROR_ALERT_THRESHOLD);
    expect(errorState.consecutiveTransientFailures).toBe(ERROR_ALERT_THRESHOLD);
    expect(errorState.lastAlertDate).toBeInstanceOf(Date);
  });

  test("alerts immediately on non-transient critical errors", () => {
    const criticalError = new Error("Selector not found in DOM");
    const result = recordFailure(criticalError);

    expect(result.shouldAlert).toBe(true);
    expect(result.errorKind).toBe("critical");
    expect(result.consecutiveFailures).toBe(1);
    expect(errorState.lastAlertDate).toBeInstanceOf(Date);
  });

  test("suppresses alerts during cooldown period for subsequent failures", () => {
    const baseTime = new Date("2026-09-15T04:00:00Z");
    for (let i = 1; i <= ERROR_ALERT_THRESHOLD; i++) {
      const err = new Error(`Navigation timeout ${i}`);
      err.name = "TimeoutError";
      recordFailure(err, baseTime);
    }
    expect(errorState.lastAlertDate).toEqual(baseTime);

    // Run 15 minutes later (still within cooldown)
    const laterTime = new Date(baseTime.getTime() + 15 * 60 * 1000);
    const errLater = new Error("Navigation timeout later");
    errLater.name = "TimeoutError";
    const result = recordFailure(errLater, laterTime);
    expect(result.shouldAlert).toBe(false);
    expect(result.consecutiveFailures).toBe(ERROR_ALERT_THRESHOLD + 1);
  });

  test("allows re-alerting after cooldown period expires", () => {
    const baseTime = new Date("2026-09-15T04:00:00Z");
    for (let i = 1; i <= ERROR_ALERT_THRESHOLD; i++) {
      const err = new Error(`Navigation timeout ${i}`);
      err.name = "TimeoutError";
      recordFailure(err, baseTime);
    }

    // Run after cooldown hours passed
    const afterCooldownTime = new Date(
      baseTime.getTime() + (ERROR_ALERT_COOLDOWN_HOURS + 1) * 60 * 60 * 1000,
    );
    const errAfter = new Error("Navigation timeout after cooldown");
    errAfter.name = "TimeoutError";
    const result = recordFailure(errAfter, afterCooldownTime);
    expect(result.shouldAlert).toBe(true);
  });

  test("resets failure counter and state on success", () => {
    recordFailure(new Error("Timeout error 1"));
    recordFailure(new Error("Timeout error 2"));
    expect(errorState.consecutiveFailures).toBe(2);

    recordSuccess();
    expect(errorState.consecutiveFailures).toBe(0);
    expect(errorState.consecutiveTransientFailures).toBe(0);
    expect(errorState.lastErrorKind).toBeNull();
    expect(errorState.lastErrorName).toBeNull();
    expect(errorState.lastErrorMessage).toBeNull();
    expect(errorState.firstFailureDate).toBeNull();
    expect(errorState.lastFailureDate).toBeNull();
    expect(errorState.lastAlertDate).toBeNull();
  });
});

describe("createErrorMailOptions", () => {
  test("creates mail options with proper subject, body, and addresses", () => {
    const error = new Error("Navigation timeout of 60000 ms exceeded");
    const mailOptions = createErrorMailOptions(error, 5, "transient", {
      from: "from@example.com",
      to: "to@example.com",
    });

    expect(mailOptions.from).toBe("from@example.com");
    expect(mailOptions.to).toBe("to@example.com");
    expect(mailOptions.subject).toContain("5 consecutive errors");
    expect(mailOptions.subject).toContain("[transient]");
    expect(mailOptions.subject).toContain("Navigation timeout of 60000 ms exceeded");
    expect(mailOptions.html).toContain("TRANSIENT");
    expect(mailOptions.html).toContain("5");
  });

  test("creates single failure critical mail options without consecutive count in subject", () => {
    const error = new Error("DOM element missing");
    const mailOptions = createErrorMailOptions(error, 1, "critical");

    expect(mailOptions.subject).toContain("[critical]");
    expect(mailOptions.subject).not.toContain("consecutive errors");
    expect(mailOptions.html).toContain("CRITICAL");
  });
});

