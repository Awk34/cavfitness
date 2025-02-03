import { Browser, Page, PuppeteerLaunchOptions } from "puppeteer";
import { PuppeteerExtra } from "puppeteer-extra";
import * as sharp from "sharp";
import * as nodemailer from "nodemailer";
import {access, appendFile, readFile, writeFile} from "node:fs/promises";
require('dotenv').config();

const CAV_MIDDLETOWN_URL = "https://thecavfitness.com/middletown/";
const HEADLESS = process.env.NODE_ENV === "production";
const DB_FILE = "db.txt";

const CSS = `
.elementor-column, .elementor-widget-wrap, .elementor-widget-heading, body, .entry-content h2 {
  background: #141414 !important;
  box-shadow: none !important;
}
.elementor-widget-heading > div > h2 {
  color: white;
}
`;

const mailTransporter = nodemailer.createTransport({
  host: 'mail.privateemail.com',
  port: 465,
  secure: true,
  auth: {
    user: 'andrew@andrewk.me',
    pass: process.env.EMAIL_PASSWORD,
  },
  dkim: process.env.DKIM_PRIVATE_KEY ? {
    domainName: 'andrewk.me',
    keySelector: 'default',
    privateKey: process.env.DKIM_PRIVATE_KEY,
  } : undefined,
  logger: true, // Enable logging
  debug: true // Enable debug output
});

export const handler = async (): Promise<any> => {
  try {
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
    const weekTextRegexp = /\((\d{2}\/\d{2}) - (\d{2}\/\d{2})\)/;
    const execResult = weekTextRegexp.exec(weekText)!;
    const weekStart = execResult[1];
    const currentYear = new Date().getFullYear();
    const missionMondayFullDate = `${weekStart}/${currentYear}`;
    console.log(`Mission's full start date: ${missionMondayFullDate}`);

    const image = sharp(await weeklyMissionDiv.screenshot());
    const metadata = await image.metadata();

    const resizedImage = image
        .extract({left: 0, top: 15, width: metadata.width!, height: metadata.height! - 15})
        .extend({top: 0, left: 0, bottom: 20, right: 20, background: '#141414'});
    await resizedImage.toFile('./mission.png');

    const mailOptions: nodemailer.SendMailOptions = {
      from: 'andrew@andrewk.me',
      subject: `The Cav Middletown weekly mission ${missionMondayFullDate}`,
      // text: weeklyMissionText,
      html: `<img src="cid:mission"/><br><br>${weeklyMissionText.replaceAll(/\n/g, '<br>')}`,
      attachments: [{
        path: 'mission.png',
        cid: 'mission',
      }],
    };
    if (process.env.EMAIL_ADDRESSES) {
      // comma separated or array
      mailOptions.bcc = process.env.EMAIL_ADDRESSES;
    } else {
      mailOptions.to = 'koroluka@gmail.com';
    }

    if (process.env.NODE_ENV == 'production') {
      try {
        // Try to access file
        console.log(`Access ${DB_FILE}`);
        await access(DB_FILE);
      } catch (err) {
        // if can't access file try to create it (empty)
        try {
          console.log(`Couldn't access ${DB_FILE}, try to write it`);
          await writeFile(DB_FILE, '');
        } catch (err) {
          // if can't create it SOMETHING HAS GONE TERRIBLY WRONG
          console.log(`Couldn't write ${DB_FILE}, I will now die`);
          console.error(err);
          process.exit(1);
        }
      }

      // Read lines from DB file
      const file = await readFile(DB_FILE, { encoding: 'utf8' });
      const lines = file.split('\n');

      // If the last line in the DB file is different from the mission the script just grabbed
      let missionIsDifferent: boolean;

      // DB file has data
      if (lines.length > 1) {
        // last line of file should be empty line
        const lastDate = lines[lines.length - 2];
        const fullDateRegexp = /\d{2}\/\d{2}\/\d{4}/;
        const lastDateValid = fullDateRegexp.test(lastDate);

        // Make sure the last date pulled is properly formatted
        if (lastDateValid) {
          // Whether the last line in the DB file is different from the mission the script just grabbed
          missionIsDifferent = lastDate !== missionMondayFullDate;
          console.log(`Compare ${lastDate} to ${missionMondayFullDate}. Result: ${missionIsDifferent ? 'different' : 'same'}`);
        } else {
          console.error(`Last date in ${DB_FILE} is not valid, continuing...`);
          missionIsDifferent = false;
        }
      } else {
        // else DB file has no data, mission is always different from null
        console.log(`${DB_FILE} is empty`);
        missionIsDifferent = true;
      }

      if (missionIsDifferent) {
        // New mission, send email

        try {
          const response = await mailTransporter.sendMail(mailOptions);
          console.log(response);

          console.log(`Email sending success, appending current mission start date to ${DB_FILE}`);
          await appendFile(DB_FILE, missionMondayFullDate + '\n');
        } catch (e) {
          console.error(e);
        }
      }
    }

    if (!HEADLESS) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    await browser.close();
  } catch (e) {
    console.log("Error in Lambda Handler:", e);
    return e;
  }
};

// Test - npx ts-node index.ts
(async () => {
  try {
    await handler();
  } catch (e) {
    console.log("Error in handler:", e);
  }
})();
