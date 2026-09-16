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

export interface FailureRecordResult {
  shouldAlert: boolean;
  consecutiveFailures: number;
  errorKind: ErrorKind;
}

export class ErrorTracker {
  public readonly state: ErrorTrackingState;
  private readonly threshold: number;
  private readonly cooldownHours: number;

  constructor(
    threshold: number = ERROR_ALERT_THRESHOLD,
    cooldownHours: number = ERROR_ALERT_COOLDOWN_HOURS,
    initialState?: Partial<ErrorTrackingState>,
  ) {
    this.threshold = threshold;
    this.cooldownHours = cooldownHours;
    this.state = {
      consecutiveFailures: 0,
      consecutiveTransientFailures: 0,
      lastErrorKind: null,
      lastErrorName: null,
      lastErrorMessage: null,
      firstFailureDate: null,
      lastFailureDate: null,
      lastAlertDate: null,
      ...initialState,
    };
  }

  public recordFailure(
    error: unknown,
    now: Date = new Date(),
  ): FailureRecordResult {
    const errorKind = getErrorKind(error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorName = error instanceof Error ? error.name : typeof error;

    this.state.consecutiveFailures += 1;
    this.state.lastErrorKind = errorKind;
    this.state.lastErrorName = errorName;
    this.state.lastErrorMessage = errorMessage;
    this.state.lastFailureDate = now;
    if (!this.state.firstFailureDate) {
      this.state.firstFailureDate = now;
    }

    if (errorKind === "transient") {
      this.state.consecutiveTransientFailures += 1;
    } else {
      this.state.consecutiveTransientFailures = 0;
    }

    const requiredThreshold =
      errorKind === "transient" ? this.threshold : 1;
    const countForThreshold =
      errorKind === "transient"
        ? this.state.consecutiveTransientFailures
        : this.state.consecutiveFailures;

    if (countForThreshold < requiredThreshold) {
      console.log(
        `Scraper failed with transient error (${countForThreshold}/${requiredThreshold} consecutive). Suppressing email alert until errors pile up.`,
      );
      return {
        shouldAlert: false,
        consecutiveFailures: this.state.consecutiveFailures,
        errorKind,
      };
    }

    if (this.state.lastAlertDate) {
      const hoursSinceLastAlert =
        (now.getTime() - this.state.lastAlertDate.getTime()) / (1000 * 60 * 60);
      if (hoursSinceLastAlert < this.cooldownHours) {
        console.log(
          `Scraper failed (${errorKind}, ${this.state.consecutiveFailures} consecutive failures). Alert suppressed due to cooldown (${hoursSinceLastAlert.toFixed(1)}h < ${this.cooldownHours}h).`,
        );
        return {
          shouldAlert: false,
          consecutiveFailures: this.state.consecutiveFailures,
          errorKind,
        };
      }
    }

    this.state.lastAlertDate = now;
    return {
      shouldAlert: true,
      consecutiveFailures: this.state.consecutiveFailures,
      errorKind,
    };
  }

  public recordSuccess(): void {
    if (this.state.consecutiveFailures > 0) {
      console.log(
        `Scraper succeeded after ${this.state.consecutiveFailures} consecutive failure(s). Resetting error tracking.`,
      );
    }
    this.state.consecutiveFailures = 0;
    this.state.consecutiveTransientFailures = 0;
    this.state.lastErrorKind = null;
    this.state.lastErrorName = null;
    this.state.lastErrorMessage = null;
    this.state.firstFailureDate = null;
    this.state.lastFailureDate = null;
    this.state.lastAlertDate = null;
  }
}

export const defaultErrorTracker = new ErrorTracker();
export const errorState = defaultErrorTracker.state;

export function recordFailure(
  error: unknown,
  now: Date = new Date(),
): FailureRecordResult {
  return defaultErrorTracker.recordFailure(error, now);
}

export function recordSuccess(): void {
  defaultErrorTracker.recordSuccess();
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
  firstFailureDate: Date | null = errorState.firstFailureDate,
): SendMailOptions {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : "";
  const firstFailure = firstFailureDate
    ? firstFailureDate.toISOString()
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
