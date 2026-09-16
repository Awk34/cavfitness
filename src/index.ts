import { Browser } from "puppeteer";
import * as nodemailer from "nodemailer";
import {
  CAV_MIDDLETOWN_URL,
  IS_DRY_RUN,
  IS_HEADLESS,
  IS_KEEPALIVE,
  IS_PRODUCTION,
  KEEPALIVE_INTERVAL_MINUTES,
  VERSION,
} from "./config";
import {
  createErrorMailOptions,
  ERROR_ALERT_COOLDOWN_HOURS,
  ERROR_ALERT_THRESHOLD,
  ErrorKind,
  errorState,
  ErrorTrackingState,
  getErrorKind,
  isTransientError,
  recordFailure,
  recordSuccess,
} from "./errors";
import {
  createMissionMailOptions,
  getDkimPrivateKey,
  sendErrorEmail,
  sendMissionEmail,
  setupMailTransporter,
} from "./mailer";
import {
  extractMissionDetails,
  injectCustomStyles,
  navigateWithRetry,
  setupPuppeteer,
} from "./scraper";
import {
  getLastMissionDate,
  initDbFile,
  recordMissionDate,
} from "./storage";
import { sleep } from "./util";

export {
  createErrorMailOptions,
  ERROR_ALERT_COOLDOWN_HOURS,
  ERROR_ALERT_THRESHOLD,
  ErrorKind,
  errorState,
  ErrorTrackingState,
  getErrorKind,
  isTransientError,
  recordFailure,
  recordSuccess,
  VERSION,
};

function formatTimestamp(): string {
  return new Date().toISOString().replace(/T/, " ").replace(/\..+/, "");
}

export function log(message?: unknown, ...args: unknown[]): void {
  console.log(`[${formatTimestamp()}]`, message, ...args);
}

async function checkAndSendEmail(
  mailTransporter: nodemailer.Transporter,
  mailOptions: nodemailer.SendMailOptions,
  missionMondayFullDate: string,
): Promise<void> {
  await initDbFile();

  let missionIsDifferent = false;
  try {
    const dbFileLastDate = await getLastMissionDate();

    if (!dbFileLastDate) {
      missionIsDifferent = true;
    } else {
      missionIsDifferent = dbFileLastDate !== missionMondayFullDate;
      console.log(
        `Compare ${dbFileLastDate} to ${missionMondayFullDate}. Result: ${missionIsDifferent ? "different" : "same"}`,
      );
    }
  } catch (error) {
    console.error("Failed to read last date from database, treating as unchanged:", error);
    missionIsDifferent = false;
  }

  if (missionIsDifferent) {
    if (!IS_PRODUCTION) {
      console.log("Not production, will not send email");
      return;
    }
    if (IS_DRY_RUN) {
      console.log("Dry run, will not send email");
      return;
    }

    await sendMissionEmail(mailTransporter, mailOptions);
    await recordMissionDate(missionMondayFullDate);
  }
}

export const handler = async (): Promise<any> => {
  let browser: Browser | undefined;
  let mailTransporter: nodemailer.Transporter | undefined;

  try {
    const dkimPrivateKey = await getDkimPrivateKey();
    mailTransporter = await setupMailTransporter(dkimPrivateKey);

    const puppeteerSession = await setupPuppeteer(IS_HEADLESS);
    browser = puppeteerSession.browser;
    const { page } = puppeteerSession;

    await navigateWithRetry(page, CAV_MIDDLETOWN_URL);
    await injectCustomStyles(page);

    const { weeklyMissionText, missionMondayFullDate } =
      await extractMissionDetails(page);

    const mailOptions = createMissionMailOptions(
      weeklyMissionText,
      missionMondayFullDate,
    );

    await checkAndSendEmail(
      mailTransporter,
      mailOptions,
      missionMondayFullDate,
    );

    recordSuccess();
    return { success: true, missionDate: missionMondayFullDate };
  } catch (error) {
    console.log("Error:", error);
    const { shouldAlert, consecutiveFailures, errorKind } = recordFailure(error);
    if (shouldAlert) {
      await sendErrorEmail(error, consecutiveFailures, errorKind, mailTransporter);
    }
    return error;
  } finally {
    if (browser) {
      if (!IS_HEADLESS) {
        await sleep(5000);
      }
      await browser.close();
    }
  }
};

async function main(): Promise<void> {
  try {
    const result = await handler();
    if (result instanceof Error) {
      throw result;
    }
  } catch (error) {
    console.log("Error in handler:", error);
    if (!IS_KEEPALIVE) {
      process.exit(1);
    }
  }
}

async function runKeepaliveLoop(intervalMinutes: number): Promise<void> {
  log(`Keepalive true. Rerunning every ${intervalMinutes} minutes.`);
  while (true) {
    await main();
    await sleep(intervalMinutes * 60 * 1000);
  }
}

if (require.main === module) {
  console.info(`cavfitness version number ${VERSION}`);
  if (IS_KEEPALIVE) {
    runKeepaliveLoop(KEEPALIVE_INTERVAL_MINUTES);
  } else {
    main();
  }
}
