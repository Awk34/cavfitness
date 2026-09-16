import { access, appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { DB_FILE, DKIM_PRIVATE_KEY_FILE, IS_DRY_RUN, IS_PRODUCTION } from "./config";

const FULL_DATE_REGEXP = /^\d{2}\/\d{2}\/\d{4}$/;

/**
 * Ensures the parent directory of a file exists.
 */
export async function ensureDirForFile(filePath: string): Promise<void> {
  const dir = path.dirname(filePath);
  if (dir && dir !== ".") {
    await mkdir(dir, { recursive: true });
  }
}

/**
 * Initialize the database file if it does not already exist.
 */
export async function initDbFile(
  dbPath: string = DB_FILE,
  isProduction: boolean = IS_PRODUCTION,
  isDryRun: boolean = IS_DRY_RUN,
): Promise<void> {
  try {
    await access(dbPath);
  } catch {
    if (!isProduction) {
      console.log("Not production, will not create DB file");
      return;
    }
    if (isDryRun) {
      console.log("Dry run, will not create DB file");
      return;
    }

    try {
      await ensureDirForFile(dbPath);
      await writeFile(dbPath, "");
      console.log(`Created database file at ${dbPath}`);
    } catch (err) {
      console.error(`Failed to create database file at ${dbPath}:`, err);
      throw err;
    }
  }
}

/**
 * Get the last date in the DB file.
 * Returns the last date, undefined if empty or not found, or throws if invalid.
 */
export async function getLastMissionDate(
  dbPath: string = DB_FILE,
): Promise<string | undefined> {
  let fileContent: string;
  try {
    fileContent = await readFile(dbPath, { encoding: "utf8" });
  } catch (err: any) {
    if (err && err.code === "ENOENT") {
      return undefined;
    }
    throw err;
  }

  const lines = fileContent
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return undefined;
  }

  const lastDate = lines[lines.length - 1];
  if (FULL_DATE_REGEXP.test(lastDate)) {
    return lastDate;
  }

  throw new Error(`Last date in ${dbPath} is not valid: "${lastDate}"`);
}

/**
 * Append the new mission start date to the DB file.
 */
export async function recordMissionDate(
  missionMondayFullDate: string,
  dbPath: string = DB_FILE,
): Promise<void> {
  await ensureDirForFile(dbPath);
  await appendFile(dbPath, `${missionMondayFullDate}\n`);
}

/**
 * Read the DKIM private key file.
 */
export async function readDkimKeyFile(
  filePath: string = DKIM_PRIVATE_KEY_FILE,
): Promise<string> {
  const content = await readFile(filePath, { encoding: "utf8" });
  return content.trim();
}
