import { Browser, Page, PuppeteerLaunchOptions } from "puppeteer";
import { PuppeteerExtra } from "puppeteer-extra";
import * as sharp from "sharp";
import * as nodemailer from "nodemailer";
import {access} from "node:fs/promises";
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
    await page.goto(CAV_MIDDLETOWN_URL);

    await page.addStyleTag({content: CSS});

    if (!HEADLESS) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // const content = await page.content();

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
    );

    console.log(weeklyMissionText);

    const weekText = weeklyMissionText!.split('\n')[1];
    const weekTextRegexp = /\((\d{2}\/\d{2}) - (\d{2}\/\d{2})\)/;
    const execResult = weekTextRegexp.exec(weekText)!;
    const weekStart = execResult[1];
    const currentYear = new Date().getFullYear();
    const missionMondayFullDate = `${weekStart}/${currentYear}`;
    console.log(missionMondayFullDate);

    const image = sharp(await weeklyMissionDiv.screenshot());
    const metadata = await image.metadata();

    const resizedImage = image
        .extract({left: 0, top: 15, width: metadata.width!, height: metadata.height! - 15})
        .extend({top: 0, left: 0, bottom: 20, right: 20, background: '#141414'});
    await resizedImage.toFile('./mission.png');

    if (!HEADLESS) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    if (process.env.NODE_ENV == "production") {
      await access(DB_FILE);
    }

    const mailOptions = {
      from: 'andrew@andrewk.me',
      to: 'koroluka@gmail.com',
      subject: "nodemailer test",
      text: weeklyMissionText,
      attachments: [{
        path: 'mission.png',
      }],
    };

    if (process.env.NODE_ENV == 'production') {
      const response = await mailTransporter.sendMail(mailOptions);
      console.log(response);
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
