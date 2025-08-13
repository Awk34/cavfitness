import {Browser, Page, PuppeteerLaunchOptions} from "puppeteer";
import {PuppeteerExtra} from "puppeteer-extra";
import * as sharp from "sharp";
import * as nodemailer from "nodemailer";
import {access, appendFile, readFile, writeFile} from "node:fs/promises";
import {weekTextToWeek} from "./dates";
import {assertExists} from "./util";
require('dotenv').config();

const CAV_MIDDLETOWN_URL = "https://thecavfitness.com/middletown/";
const PRODUCTION = process.env.NODE_ENV === "production";
const HEADLESS = PRODUCTION;
const DB_FILE = "./data/db.txt";
const MISSION_IMAGE_FILE = "./data/mission.png";
const DKIM_PRIVATE_KEY_FILE = "./data/dkim.txt";

// encode in b64 to try to avoid getting scraped on GH
const MY_EMAIL = Buffer.from("a29yb2x1a2FAZ21haWwuY29t", 'base64').toString('ascii');
const FROM_EMAIL = Buffer.from("YW5kcmV3QGFuZHJld2subWU=", 'base64').toString('ascii');

const DRY_RUN = process.env.DRY_RUN === "false"
    ? false
    : !!process.env.DRY_RUN;
const KEEPALIVE = !!process.env.KEEPALIVE;
const KEEPALIVE_INTERVAL_MINUTES = parseInt(process.env.KEEPALIVE_INTERVAL_MINUTES || '15', 10) || 15;

const VERSION = require("../package.json").version;
console.info(`cavfitness version number ${VERSION}`);

async function setupPuppeteer(): Promise<{ browser: Browser, page: Page }> {
    const puppeteer: PuppeteerExtra = require("puppeteer-extra");
    const stealthPlugin = require("puppeteer-extra-plugin-stealth");
    puppeteer.use(stealthPlugin());

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

    if (!HEADLESS) {
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return {browser, page};
}

async function getDkimPrivateKey(): Promise<string | undefined> {
    let dkimPrivateKey = process.env.DKIM_PRIVATE_KEY;
    if (!dkimPrivateKey) {
        try {
            dkimPrivateKey = await readDkimKeyFile();
        } catch (err) {
            console.error('Couldn\'t read from DKIM key file');
        }
    }
    return dkimPrivateKey;
}

async function setupMailTransporter(dkimPrivateKey: string | undefined): Promise<nodemailer.Transporter> {
    return nodemailer.createTransport({
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
        debug: !PRODUCTION // Enable debug output
    });
}

async function extractMissionDetails(page: Page): Promise<{ weeklyMissionText: string, missionMondayFullDate: string }> {
    const missionTextSelector = await page
        .locator('text/THE WEEK’S MISSION')
        .waitHandle();
    await missionTextSelector.tap();

    const divs = await page
        .$$('.elementor-column.elementor-col-25.elementor-top-column.elementor-element');
    const weeklyMissionDiv = divs[divs.length - 1];

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

    return {weeklyMissionText, missionMondayFullDate};
}

function createMailOptions(weeklyMissionText: string, missionMondayFullDate: string): nodemailer.SendMailOptions {
    const mailOptions: nodemailer.SendMailOptions = {
        from: FROM_EMAIL,
        subject: `The Cav Middletown weekly mission ${missionMondayFullDate}`,
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
        // Default to just my email
        mailOptions.to = MY_EMAIL;
    }
    return mailOptions;
}

async function checkAndSendEmail(mailTransporter: nodemailer.Transporter, mailOptions: nodemailer.SendMailOptions, missionMondayFullDate: string): Promise<void> {
    await dbFileInit();

    let missionIsDifferent: boolean;

    try {
        const dbFileLastDate = await getDbFileLastDate();

        if (!dbFileLastDate) {
            missionIsDifferent = true;
        } else {
            missionIsDifferent = dbFileLastDate !== missionMondayFullDate;
            console.log(`Compare ${dbFileLastDate} to ${missionMondayFullDate}. Result: ${missionIsDifferent ? 'different' : 'same'}`);
        }
    } catch (e) {
        console.error(`Last date in ${DB_FILE} is not valid, continuing...`);
        missionIsDifferent = false;
    }

    if (missionIsDifferent) {
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
}

export const handler = async (): Promise<any> => {
    let browser: Browser | undefined;
    try {
        const {browser: b, page} = await setupPuppeteer();
        browser = b;

        const dkimPrivateKey = await getDkimPrivateKey();
        const mailTransporter = await setupMailTransporter(dkimPrivateKey);

        await page.goto(CAV_MIDDLETOWN_URL);
        const CSS = await readFile('./src/styles.css', 'utf8');
        await page.addStyleTag({content: CSS});

        const {weeklyMissionText, missionMondayFullDate} = await extractMissionDetails(page);

        const mailOptions = createMailOptions(weeklyMissionText, missionMondayFullDate);

        await checkAndSendEmail(mailTransporter, mailOptions, missionMondayFullDate);

    } catch (e) {
        console.log("Error:", e);
        return e;
    } finally {
        if (browser) {
            if (!HEADLESS) {
                await new Promise((resolve) => setTimeout(resolve, 5000));
            }
            await browser.close();
        }
    }
};

async function dbFileInit() {
    try {
        console.log(`Access ${DB_FILE}`);
        await access(DB_FILE);
    } catch (err) {
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
            // If we can't create it SOMETHING HAS GONE TERRIBLY WRONG
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
        const lastDate = lines[lines.length - 2];
        const fullDateRegexp = /\d{2}\/\d{2}\/\d{4}/;
        const lastDateValid = fullDateRegexp.test(lastDate);

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

async function main() {
    try {
        await handler();
    } catch (e) {
        console.log("Error in handler:", e);
    }
}

if (KEEPALIVE) {
    log(`Keepalive true. Rerunning every ${KEEPALIVE_INTERVAL_MINUTES} minutes.`);
    main().then(() => {
        setInterval((async () => {
            await main();
        }), KEEPALIVE_INTERVAL_MINUTES * (60 * 1000));
    });
} else {
    main();
}
