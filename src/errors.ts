import type { SendMailOptions } from "nodemailer";

export const ERROR_ALERT_THRESHOLD =
  parseInt(process.env.ERROR_ALERT_THRESHOLD || "5", 10) || 5;
export const ERROR_ALERT_COOLDOWN_HOURS =
  parseInt(process.env.ERROR_ALERT_COOLDOWN_HOURS || "12", 10) || 12;

export type ErrorKind = "transient" | "critical";

const DOM_OR_PARSE_ERROR_PATTERN =
  /\b(Locator\.|waitHandle|waitForSelector|Waiting for selector|Failed to locate|Cannot find selector|Weekly mission column element|Failed to parse|Neither date scheme matched)\b/i;

function getErrorChainText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error) {
      parts.push(`${current.name}: ${current.message}`);
      if (current.stack) {
        parts.push(current.stack);
      }
      current = (current as Error & { cause?: unknown }).cause;
    } else {
      parts.push(String(current));
      break;
    }
  }
  return parts.join("\n");
}

function extractFirstAppFunction(stack?: string): string | null {
  if (!stack) return null;
  for (const line of stack.split("\n")) {
    if (line.includes("node_modules") || line.includes("node:internal")) {
      continue;
    }
    const match = /at\s+(?:async\s+)?([A-Za-z0-9_.$]+)\s+\(/.exec(line);
    if (match && match[1]) {
      return match[1];
    }
  }
  return null;
}

export function describeError(error: unknown): string {
  if (!error) return "Unknown error";
  if (!(error instanceof Error)) return String(error);

  const baseMessage = error.message || error.name || "Error";
  const cause = (error as Error & { cause?: unknown }).cause;
  if (!cause) {
    return baseMessage;
  }

  const causeMessage =
    cause instanceof Error ? cause.message || cause.name : String(cause);
  const appFn =
    (cause instanceof Error && extractFirstAppFunction(cause.stack)) ||
    extractFirstAppFunction(error.stack);

  if (causeMessage && !baseMessage.includes(causeMessage)) {
    const locationSuffix = appFn ? ` in ${appFn}` : "";
    return `${baseMessage} (caused by: ${causeMessage}${locationSuffix})`;
  }

  if (appFn && !baseMessage.includes(appFn)) {
    return `${baseMessage} (in ${appFn})`;
  }

  return baseMessage;
}

export function getErrorDiagnosis(error: unknown): string {
  if (!error) return "An unknown error occurred during scraping.";
  const chainText = getErrorChainText(error);

  if (
    /\b(Failed to parse|Neither date scheme matched)\b/i.test(chainText)
  ) {
    return "The weekly mission text was extracted, but its date range could not be parsed. The date format on the website may have changed.";
  }

  if (DOM_OR_PARSE_ERROR_PATTERN.test(chainText)) {
    return "DOM element or selector was not found on the page. The website layout or wording may have changed.";
  }

  if (isTransientError(error)) {
    return "Page navigation or network connection timed out while reaching the website.";
  }

  return "An unexpected application error occurred during scraping.";
}

export function formatErrorStack(error: unknown): string {
  const blocks: string[] = [];
  let current: unknown = error;
  const seen = new Set<unknown>();
  let isFirst = true;

  while (current && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error) {
      const text = current.stack || `${current.name}: ${current.message}`;
      blocks.push(isFirst ? text : `Caused by: ${text}`);
      current = (current as Error & { cause?: unknown }).cause;
    } else {
      blocks.push(isFirst ? String(current) : `Caused by: ${String(current)}`);
      break;
    }
    isFirst = false;
  }

  return blocks.join("\n\n");
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function isTransientError(error: unknown): boolean {
  if (!error) return false;
  const chainText = getErrorChainText(error);
  if (DOM_OR_PARSE_ERROR_PATTERN.test(chainText)) {
    return false;
  }

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
    const errorMessage = describeError(error);
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
  const errorMessage = describeError(error);
  const diagnosis = getErrorDiagnosis(error);
  const errorStack = error instanceof Error ? formatErrorStack(error) : "";
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
            <p><strong>Summary:</strong> ${escapeHtml(diagnosis)}</p>
            <p><strong>Consecutive Failures:</strong> ${consecutiveFailures}</p>
            <p><strong>Streak Started:</strong> ${firstFailure}</p>
            <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
            <p><strong>Error:</strong> ${escapeHtml(errorMessage)}</p>
            ${errorStack ? `<pre style="background: #f4f4f4; padding: 12px; border-radius: 4px; overflow-x: auto; font-family: monospace;">${escapeHtml(errorStack)}</pre>` : ""}
        `,
  };
}
