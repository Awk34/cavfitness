import {Browser, Page, PuppeteerLaunchOptions} from "puppeteer";
import {PuppeteerExtra} from "puppeteer-extra";
import * as sharp from "sharp";
import * as nodemailer from "nodemailer";
import {access, appendFile, readFile, writeFile} from "node:fs/promises";
require('dotenv').config();

const CAV_MIDDLETOWN_URL = "https://thecavfitness.com/middletown/";
const HEADLESS = process.env.NODE_ENV === "production";
const DB_FILE = "./data/db.txt";
const MISSION_IMAGE_FILE = "./data/mission.png";
const DKIM_PRIVATE_KEY_FILE = "./data/dkim.txt";
const MY_EMAIL = "koroluka@gmail.com";
const FROM_EMAIL = "andrew@andrewk.me";
const DRY_RUN = process.env.DRY_RUN === "false"
    ? false
    : !!process.env.DRY_RUN;
const KEEPALIVE = !!process.env.KEEPALIVE;
const KEEPALIVE_INTERVAL_MINUTES = parseInt(process.env.KEEPALIVE_INTERVAL_MINUTES || '15', 10) || 15;

const VERSION = require("./package.json").version;
console.info(`cavfitness version number ${VERSION}`);

const CSS = `
.elementor-column, .elementor-widget-wrap, .elementor-widget-heading, body, .entry-content h2, * {
  background: #141414 !important;
  box-shadow: none !important;
}
.elementor-widget-heading > div > h2 {
  color: white;
}
.elementor-location-header {
  visibility: hidden;
}
`;

// Convert text month name to text month number
const monthMap = new Map([
  ["Jan", "01"],
  ["Feb", "02"],
  ["Mar", "03"],
  ["Apr", "04"],
  ["May", "05"],
  ["Jun", "06"],
  ["Jul", "07"],
  ["Aug", "08"],
  ["Sep", "09"],
  ["Oct", "10"],
  ["Nov", "11"],
  ["Dec", "12"],
  ["January", "01"],
  ["February", "02"],
  ["March", "03"],
  ["April", "04"],
  ["June", "06"],
  ["July", "07"],
  ["August", "08"],
  ["September", "09"],
  ["October", "10"],
  ["November", "11"],
  ["December", "12"],
]);

export const handler = async (): Promise<any> => {
  try {
    const puppeteer: PuppeteerExtra = require("puppeteer-extra");
    const stealthPlugin = require("puppeteer-extra-plugin-stealth");
    puppeteer.use(stealthPlugin());

    let dkimPrivateKey = process.env.DKIM_PRIVATE_KEY;
    if (!dkimPrivateKey) {
      try {
        dkimPrivateKey = await readDkimKeyFile();
      } catch (err) {
        console.error('Couldn\'t read from DKIM key file');
      }
    }

    const mailTransporter = nodemailer.createTransport({
      host: 'mail.privateemail.com',
      port: 465,
      secure: true,
      auth: {
        user: 'andrew@andrewk.me',
        pass: process.env.EMAIL_PASSWORD,
      },
      dkim: dkimPrivateKey ? {
        domainName: 'andrewk.me',
        keySelector: 'default',
        privateKey: dkimPrivateKey,
      } : undefined,
      logger: true, // Enable logging
      debug: true // Enable debug output
    });

    const launchOptions: PuppeteerLaunchOptions = HEADLESS
      ? {
          headless: true,
          executablePath: puppeteer.executablePath(),
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            // "--single-process",
            "--incognito",
            "--disable-client-side-phishing-detection",
            "--disable-software-rasterizer",
          ],
        }
      : {
          headless: false,
          executablePath: puppeteer.executablePath(),
        };

    const browser: Browser = await puppeteer.launch(launchOptions);
    const page: Page = await browser.newPage();
    await page.setViewport({width: 1920, height: 1080});
    await page.emulateMediaFeatures([
      {name: 'prefers-color-scheme', value: 'dark'},
    ]);
    await page.goto(CAV_MIDDLETOWN_URL);

    // Dark mode, man
    await page.addStyleTag({content: CSS});

    if (!HEADLESS) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const missionTextSelector = await page
        .locator('text/THE WEEK’S MISSION')
        .waitHandle();
    // Scroll to weekly mission
    await missionTextSelector.tap();

    const divs = await page
        .$$('.elementor-column.elementor-col-25.elementor-top-column.elementor-element');
    const weeklyMissionDiv = divs[divs.length - 1]

    const weeklyMissionText = await weeklyMissionDiv.evaluate(el =>
        el.textContent?.trim()
            .replaceAll(/[ \t]+/g, ' ')
            .replaceAll(/(\n +)+/g, '\n')
    ) || '';
    console.log(weeklyMissionText);

    const weekText = weeklyMissionText!.split('\n')[1];
    const week = weekTextToWeek(weekText);

    const currentYear = new Date().getFullYear();
    const missionMondayFullDate = `${week.getStartDateString()}/${currentYear}`;
    console.log(`Mission's full start date: ${missionMondayFullDate}`);

    const image = sharp(await weeklyMissionDiv.screenshot({
      omitBackground: true,
      optimizeForSpeed: true,
      captureBeyondViewport: true,
    }));
    const metadata = await image.metadata();

    const resizedImage = image
        .extract({left: 0, top: 15, width: metadata.width!, height: metadata.height! - 15})
        .extend({top: 20, left: 0, bottom: 20, right: 20, background: '#141414'});
    await resizedImage.toFile(MISSION_IMAGE_FILE);

    const mailOptions: nodemailer.SendMailOptions = {
      from: FROM_EMAIL,
      subject: `The Cav Middletown weekly mission ${missionMondayFullDate}`,
      // text: weeklyMissionText,
      html: `<img src="cid:mission" alt="weekly mission"/><br><br>${weeklyMissionText.replaceAll(/\n/g, '<br>')}`,
      attachments: [{
        path: MISSION_IMAGE_FILE,
        cid: 'mission',
      }],
    };
    if (process.env.EMAIL_ADDRESSES) {
      // comma separated or array
      mailOptions.bcc = process.env.EMAIL_ADDRESSES;
    } else {
      mailOptions.to = MY_EMAIL;
    }

    await dbFileInit();

    // If the last line in the DB file is different from the mission the script just grabbed
    let missionIsDifferent: boolean;

    try {
      const dbFileLastDate = await getDbFileLastDate();

      if (!dbFileLastDate) {
        // DB file last line had parse error, treat date as different
        missionIsDifferent = true;
      } else {
        // Whether the last line in the DB file is different from the mission the script just grabbed
        missionIsDifferent = dbFileLastDate !== missionMondayFullDate;
        console.log(`Compare ${dbFileLastDate} to ${missionMondayFullDate}. Result: ${missionIsDifferent ? 'different' : 'same'}`);
      }
    } catch (e) {
      console.error(`Last date in ${DB_FILE} is not valid, continuing...`);
      missionIsDifferent = false;
    }

    if (missionIsDifferent) {
      // New mission, send email

      if (process.env.NODE_ENV !== 'production') {
        console.log('Not production, will not send email');
        return;
      }
      if (DRY_RUN) {
        console.log('Dry run, will not send email');
        return;
      }

      try {
        await sendEmail(mailTransporter, mailOptions);

        await updateDbFile(missionMondayFullDate);
      } catch (e) {
        console.error(e);
      }
    }

    if (!HEADLESS) {
      // If not running headless, show the browser for 5s before closing
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    await browser.close();
  } catch (e) {
    console.log("Error:", e);
    return e;
  }
};

async function dbFileInit() {
  try {
    // Try to access file
    console.log(`Access ${DB_FILE}`);
    await access(DB_FILE);
  } catch (err) {
    // if can't access file try to create it (empty)
    console.log(`Couldn't access ${DB_FILE}, try to write it`);

    if (process.env.NODE_ENV !== 'production') {
      console.log('Not production, will not write to DB file');
      return;
    }
    if (DRY_RUN) {
      console.log('Dry run, will not write to DB file');
      return;
    }

    try {
      await writeFile(DB_FILE, '');
      console.log('Wrote log file');
    } catch (err) {
      // if can't create it SOMETHING HAS GONE TERRIBLY WRONG
      console.log(`Couldn't write ${DB_FILE}, I will now die`);
      console.error(err);
      process.exit(1);
    }
  }
}

/**
 * Get the last date in the DB file
 * @returns the last date in the file
 *   OR undefined if the file is empty
 *   OR throws if the last date in the file has a parsing error
 */
async function getDbFileLastDate() {
  // Read lines from DB file
  const file = await readFile(DB_FILE, { encoding: 'utf8' });
  const lines = file.split('\n');

  // DB file has data
  if (lines.length > 1) {
    // last line of file should be empty line
    const lastDate = lines[lines.length - 2];
    const fullDateRegexp = /\d{2}\/\d{2}\/\d{4}/;
    const lastDateValid = fullDateRegexp.test(lastDate);

    // Make sure the last date pulled is properly formatted
    if (lastDateValid) {
      return lastDate;
    } else {
      throw new Error(`Last date in ${DB_FILE} is not valid`);
    }
  } else {
    // else DB file has no data, mission is always different from null
    console.log(`${DB_FILE} is empty`);
  }
}

/**
 * Get the DKIM private key from a file if present
 */
async function readDkimKeyFile() {
  // Read lines from DB file
  console.log(`Read content of ${DKIM_PRIVATE_KEY_FILE}`);
  return (await readFile(DKIM_PRIVATE_KEY_FILE, {encoding: 'utf8'})).trim();
}

async function sendEmail(mailTransporter: nodemailer.Transporter, mailOptions: nodemailer.SendMailOptions) {
  try {
    const response = await mailTransporter.sendMail(mailOptions);
    console.log(response);

    console.log('Email sending success');
  } catch (e) {
    console.error('Email sending failed');
    console.error(e);
  }
}

async function updateDbFile(missionMondayFullDate: string) {
  console.log(`Appending current mission start date to db file`);
  await appendFile(DB_FILE, missionMondayFullDate + '\n');
}

function getTimestampDate() {
  return new Date().toISOString()
      .replace(/T/, ' ')
      .replace(/\..+/, '');
}

function log(message?: any, ...args: any[]) {
  console.log(`[${getTimestampDate()}] ${message}`, ...args);
}

if (KEEPALIVE) {
  // Keep process alive and run the handler every X minutes
  log(`Keepalive true. Rerunning every ${KEEPALIVE_INTERVAL_MINUTES} minutes.`);

  // Run at startup once, then begin interval wait
  main().then(() => {
    setInterval((async () => {
      await main();
    }), KEEPALIVE_INTERVAL_MINUTES * (60 * 1000));
  });
} else {
  // Run once then exit
  main();
}

async function main() {
  try {
    await handler();
  } catch (e) {
    console.log("Error in handler:", e);
  }
}

function weekTextToWeek(weekText: string): Week {
  const weekTextRegexp = /\((\d{1,2})\/(\d{1,2}) - (\d{1,2})\/(\d{1,2})\)/;
  const weekTextRegexp2 = /([a-z]+)\s(\d{1,2})(?:th)? [-–֊־] ([a-z]+)\s(\d{1,2})(?:th)?/i;
  const weekTextExecResult = weekTextRegexp.exec(weekText)!;

  let weekStart: string;

  if (weekTextExecResult) {
    let startMonth: Month = parseInt(weekTextExecResult[1], 10) as Month;
    let startDay = parseInt(weekTextExecResult[2], 10);
    let endMonth: Month = parseInt(weekTextExecResult[3], 10) as Month;
    let endDay = parseInt(weekTextExecResult[4], 10);

    return new Week(startMonth, startDay, endMonth, endDay);
  } else {
    // 01/01 - 01/08 didn't match
    // Try May 12 - May 17 format
    const weekTextExecResult2 = weekTextRegexp2.exec(weekText);

    if (!weekTextExecResult2) {
      throw new Error(`Neither date scheme matched: "${weekText}"`);
    }

    let startMonth = monthEnumMap.get(weekTextExecResult2[1]);
    let startDay = parseInt(weekTextExecResult2[2], 10);
    let endMonth = monthEnumMap.get(weekTextExecResult2[3]);
    let endDay = parseInt(weekTextExecResult2[4], 10);

    assertExists(startMonth);
    assertExists(endMonth);

    return new Week(startMonth, startDay, endMonth, endDay);
  }
}

class Week {
  private readonly startMonth: Month;
  private readonly startDay: number;
  private readonly endMonth: Month;
  private readonly endDay: number;

  constructor(startMonth: Month, startDay: number, endMonth: Month, endDay: number) {
    this.startMonth = startMonth;
    this.startDay = startDay;
    this.endMonth = endMonth;
    this.endDay = endDay;
  }

  static getDateText(month: Month, day: number): string {
    let monthString = `${month}`.padStart(2, '0');
    let dayString = `${day}`.padStart(2, '0');
    return `${monthString}/${dayString}`;
  }

  getStartDateString(): string {
    return Week.getDateText(this.startMonth, this.startDay);
  }

  getEndDateString(): string {
    return Week.getDateText(this.endMonth, this.endDay);
  }
}

enum Month {
  January = 1,
  February = 2,
  March = 3,
  April = 4,
  May = 5,
  June = 6,
  July = 7,
  August = 8,
  September = 9,
  October = 10,
  November = 11,
  December = 12,
}

// Convert text month name to enum
const monthEnumMap = new Map([
  ["Jan", Month.January],
  ["Feb", Month.February],
  ["Mar", Month.March],
  ["Apr", Month.April],
  ["May", Month.May],
  ["Jun", Month.June],
  ["Jul", Month.July],
  ["Aug", Month.August],
  ["Sep", Month.September],
  ["Oct", Month.October],
  ["Nov", Month.November],
  ["Dec", Month.December],

  ["January", Month.January],
  ["February", Month.February],
  ["March", Month.March],
  ["April", Month.April],
  // ["May", Month.May],
  ["June", Month.June],
  ["July", Month.July],
  ["August", Month.August],
  ["September", Month.September],
  ["October", Month.October],
  ["November", Month.November],
  ["December", Month.December],
]);

function assertExists<T>(arg: T|null|undefined): asserts arg is NonNullable<T> {
  if (arg == null) {
    throw new Error("assertExists failed");
  }
}
