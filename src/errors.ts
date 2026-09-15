import type { SendMailOptions } from "nodemailer";

export const ERROR_ALERT_THRESHOLD =
  parseInt(process.env.ERROR_ALERT_THRESHOLD || "5", 10) || 5;
export const ERROR_ALERT_COOLDOWN_HOURS =
  parseInt(process.env.ERROR_ALERT_COOLDOWN_HOURS || "12", 10) || 12;

export type ErrorKind = "transient" | "critical";

export function isTransientError(error: unknown): boolean {
  if (!error) return false;
  const name = error instanceof Error ? error.name : "";
  const msg = error instanceof Error ? error.message : String(error);
  return (
    name === "TimeoutError" ||
    /timeout/i.test(name) ||
    /timeout/i.test(msg) ||
    /net::ERR_/i.test(msg) ||
    /\b(ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|ECONNREFUSED)\b/i.test(msg)
  );
}

export function getErrorKind(error: unknown): ErrorKind {
  return isTransientError(error) ? "transient" : "critical";
}

export interface ErrorTrackingState {
  consecutiveFailures: number;
  consecutiveTransientFailures: number;
  lastErrorKind: ErrorKind | null;
  lastErrorName: string | null;
  lastErrorMessage: string | null;
  firstFailureDate: Date | null;
  lastFailureDate: Date | null;
  lastAlertDate: Date | null;
}

export const errorState: ErrorTrackingState = {
  consecutiveFailures: 0,
  consecutiveTransientFailures: 0,
  lastErrorKind: null,
  lastErrorName: null,
  lastErrorMessage: null,
  firstFailureDate: null,
  lastFailureDate: null,
  lastAlertDate: null,
};

export function recordFailure(
  error: unknown,
  now: Date = new Date(),
): {
  shouldAlert: boolean;
  consecutiveFailures: number;
  errorKind: ErrorKind;
} {
  const errorKind = getErrorKind(error);
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorName = error instanceof Error ? error.name : typeof error;

  errorState.consecutiveFailures += 1;
  errorState.lastErrorKind = errorKind;
  errorState.lastErrorName = errorName;
  errorState.lastErrorMessage = errorMessage;
  errorState.lastFailureDate = now;
  if (!errorState.firstFailureDate) {
    errorState.firstFailureDate = now;
  }

  if (errorKind === "transient") {
    errorState.consecutiveTransientFailures += 1;
  } else {
    errorState.consecutiveTransientFailures = 0;
  }

  const threshold = errorKind === "transient" ? ERROR_ALERT_THRESHOLD : 1;
  const countForThreshold =
    errorKind === "transient"
      ? errorState.consecutiveTransientFailures
      : errorState.consecutiveFailures;

  if (countForThreshold < threshold) {
    console.log(
      `Scraper failed with transient error (${countForThreshold}/${threshold} consecutive). Suppressing email alert until errors pile up.`,
    );
    return {
      shouldAlert: false,
      consecutiveFailures: errorState.consecutiveFailures,
      errorKind,
    };
  }

  if (errorState.lastAlertDate) {
    const hoursSinceLastAlert =
      (now.getTime() - errorState.lastAlertDate.getTime()) / (1000 * 60 * 60);
    if (hoursSinceLastAlert < ERROR_ALERT_COOLDOWN_HOURS) {
      console.log(
        `Scraper failed (${errorKind}, ${errorState.consecutiveFailures} consecutive failures). Alert suppressed due to cooldown (${hoursSinceLastAlert.toFixed(1)}h < ${ERROR_ALERT_COOLDOWN_HOURS}h).`,
      );
      return {
        shouldAlert: false,
        consecutiveFailures: errorState.consecutiveFailures,
        errorKind,
      };
    }
  }

  errorState.lastAlertDate = now;
  return {
    shouldAlert: true,
    consecutiveFailures: errorState.consecutiveFailures,
    errorKind,
  };
}

export function recordSuccess(): void {
  if (errorState.consecutiveFailures > 0) {
    console.log(
      `Scraper succeeded after ${errorState.consecutiveFailures} consecutive failure(s). Resetting error tracking.`,
    );
  }
  errorState.consecutiveFailures = 0;
  errorState.consecutiveTransientFailures = 0;
  errorState.lastErrorKind = null;
  errorState.lastErrorName = null;
  errorState.lastErrorMessage = null;
  errorState.firstFailureDate = null;
  errorState.lastFailureDate = null;
  errorState.lastAlertDate = null;
}

export interface ErrorMailAddresses {
  from?: string;
  to?: string;
}

export function createErrorMailOptions(
  error: unknown,
  consecutiveFailures: number = 1,
  errorKind: ErrorKind = "critical",
  addresses?: ErrorMailAddresses,
): SendMailOptions {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : "";
  const firstFailure = errorState.firstFailureDate
    ? errorState.firstFailureDate.toISOString()
    : new Date().toISOString();

  const countText =
    consecutiveFailures > 1
      ? ` (${consecutiveFailures} consecutive errors)`
      : "";

  return {
    from: addresses?.from,
    to: addresses?.to,
    subject: `[Cav Fitness Error] Weekly mission failed${countText} [${errorKind}] - ${errorMessage}`,
    html: `
            <h2>Cav Fitness Scraper Error</h2>
            <p><strong>Error Type:</strong> ${errorKind.toUpperCase()}</p>
            <p><strong>Consecutive Failures:</strong> ${consecutiveFailures}</p>
            <p><strong>Streak Started:</strong> ${firstFailure}</p>
            <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
            <p><strong>Error:</strong> ${errorMessage}</p>
            ${errorStack ? `<pre style="background: #f4f4f4; padding: 12px; border-radius: 4px; overflow-x: auto; font-family: monospace;">${errorStack}</pre>` : ""}
        `,
  };
}

