import * as fs from "node:fs";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { Browser, ElementHandle, Page, PuppeteerLaunchOptions } from "puppeteer";
import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import sharp from "sharp";
import {
  CAV_MIDDLETOWN_URL,
  IS_HEADLESS,
  MISSION_IMAGE_FILE,
} from "./config";
import { weekTextToWeek } from "./dates";
import { ensureDirForFile } from "./storage";
import { assertExists, sleep } from "./util";

export interface PuppeteerSession {
  browser: Browser;
  page: Page;
}

export interface MissionDetails {
  weeklyMissionText: string;
  missionMondayFullDate: string;
}

export async function setupPuppeteer(
  headless: boolean = IS_HEADLESS,
): Promise<PuppeteerSession> {
  puppeteerExtra.use(StealthPlugin());

  const launchOptions: PuppeteerLaunchOptions = headless
    ? {
        headless: true,
        executablePath: puppeteerExtra.executablePath(),
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--incognito",
          "--disable-client-side-phishing-detection",
          "--disable-software-rasterizer",
        ],
      }
    : {
        headless: false,
        executablePath: puppeteerExtra.executablePath(),
      };

  const browser: Browser = await puppeteerExtra.launch(launchOptions);
  const page: Page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  await page.emulateMediaFeatures([
    { name: "prefers-color-scheme", value: "dark" },
  ]);

  if (!headless) {
    await sleep(500);
  }

  return { browser, page };
}

export async function navigateWithRetry(
  page: Page,
  url: string = CAV_MIDDLETOWN_URL,
  maxNavAttempts: number = 2,
  retryDelayMs: number = 5000,
): Promise<void> {
  for (let attempt = 1; attempt <= maxNavAttempts; attempt++) {
    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      return;
    } catch (navError) {
      if (attempt === maxNavAttempts) {
        throw navError;
      }
      console.warn(
        `Navigation attempt ${attempt} failed, retrying in ${retryDelayMs / 1000}s...`,
        navError instanceof Error ? navError.message : navError,
      );
      await sleep(retryDelayMs);
    }
  }
}

export async function injectCustomStyles(page: Page): Promise<void> {
  const cssPath = [
    path.join(__dirname, "styles.css"),
    path.join(__dirname, "../src/styles.css"),
    path.join(process.cwd(), "src/styles.css"),
  ].find((candidate) => candidate && fs.existsSync(candidate));

  if (cssPath) {
    const css = await readFile(cssPath, "utf8");
    if (css) {
      await page.addStyleTag({ content: css });
    }
  }
}

export async function findMissionElement(
  page: Page,
): Promise<ElementHandle<Element>> {
  try {
    const handle = await page.waitForFunction(
      () => {
        const hasWeekdays = (text: string): boolean =>
          /\bmonday\b/i.test(text) &&
          /\btuesday\b/i.test(text) &&
          /\bwednesday\b/i.test(text) &&
          /\bthursday\b/i.test(text) &&
          /\bfriday\b/i.test(text);

        const candidates = Array.from(
          document.querySelectorAll<HTMLElement>("body *"),
        ).filter((el) => hasWeekdays(el.innerText || el.textContent || ""));

        if (candidates.length === 0) {
          return null;
        }

        const withHeader = candidates.filter((el) =>
          /\b(mission|train for life)\b/i.test(
            el.innerText || el.textContent || "",
          ),
        );
        const deepest =
          withHeader.length > 0
            ? withHeader[withHeader.length - 1]
            : candidates[candidates.length - 1];

        return deepest.closest<HTMLElement>(".elementor-column") ?? deepest;
      },
      { timeout: 30000 },
    );

    const element = handle.asElement() as ElementHandle<Element> | null;
    assertExists(
      element,
      `Weekly mission container element not found on ${page.url()}`,
    );
    return element;
  } catch (error) {
    throw new Error(
      `Failed to locate weekly mission section (expected weekday schedule Monday–Friday) on ${page.url()} (page layout or content may have changed): ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

export async function extractMissionDetails(
  page: Page,
  imageOutputPath: string = MISSION_IMAGE_FILE,
): Promise<MissionDetails> {
  const weeklyMissionDiv = await findMissionElement(page);

  await weeklyMissionDiv.scrollIntoView();

  const weeklyMissionText =
    (await weeklyMissionDiv.evaluate((el) => {
      const rawText = (el as HTMLElement).innerText || el.textContent || "";
      return rawText
        .trim()
        .replaceAll(/[ \t]+/g, " ")
        .replaceAll(/(\n +)+/g, "\n");
    })) || "";
  console.log(weeklyMissionText);

  let week;
  try {
    week = weekTextToWeek(weeklyMissionText);
  } catch (error) {
    const preview = weeklyMissionText.replaceAll(/\s+/g, " ").slice(0, 200);
    throw new Error(
      `Failed to parse weekly mission date from extracted text (preview: "${preview}"): ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const currentYear = new Date().getFullYear();
  const missionMondayFullDate = `${week.getStartDateString()}/${currentYear}`;
  console.log(`Mission's full start date: ${missionMondayFullDate}`);

  await ensureDirForFile(imageOutputPath);
  const rawScreenshot = await weeklyMissionDiv.screenshot({
    omitBackground: true,
    optimizeForSpeed: true,
    captureBeyondViewport: true,
  });

  const image = sharp(rawScreenshot);
  const resizedImage = image.extend({
    top: 20,
    left: 0,
    bottom: 20,
    right: 20,
    background: "#141414",
  });
  await resizedImage.toFile(imageOutputPath);

  return { weeklyMissionText, missionMondayFullDate };
}
