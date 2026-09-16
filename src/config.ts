import * as fs from "node:fs";
import * as path from "node:path";
import "dotenv/config";

export const CAV_MIDDLETOWN_URL = "https://thecavfitness.com/middletown/";
export const IS_PRODUCTION = process.env.NODE_ENV === "production";
export const IS_HEADLESS = IS_PRODUCTION;
export const IS_DRY_RUN =
  process.env.DRY_RUN === "false" ? false : Boolean(process.env.DRY_RUN);
export const IS_KEEPALIVE = Boolean(process.env.KEEPALIVE);
export const KEEPALIVE_INTERVAL_MINUTES =
  parseInt(process.env.KEEPALIVE_INTERVAL_MINUTES || "15", 10) || 15;

export const DB_FILE = "./data/db.txt";
export const MISSION_IMAGE_FILE = "./data/mission.png";
export const DKIM_PRIVATE_KEY_FILE = "./data/dkim.txt";

// Obfuscated to avoid automated regex / base64 GH scrapers
export const deobfuscate = (codes: number[]): string =>
  String.fromCharCode(...codes.map((c) => c ^ 42));

export const MY_EMAIL = deobfuscate([
  65, 69, 88, 69, 70, 95, 65, 75, 106, 77, 71, 75, 67, 70, 4, 73, 69, 71,
]);

export const FROM_EMAIL = deobfuscate([
  75, 68, 78, 88, 79, 93, 106, 75, 68, 78, 88, 79, 93, 65, 4, 71, 79,
]);

export function resolvePackageVersion(): string {
  const candidates = [
    path.join(__dirname, "package.json"),
    path.join(__dirname, "../package.json"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        const raw = fs.readFileSync(candidate, "utf8");
        const parsed = JSON.parse(raw) as { version?: string };
        if (parsed.version) {
          return parsed.version;
        }
      } catch {
        // Continue checking other candidates
      }
    }
  }
  return "unknown";
}

export const VERSION = resolvePackageVersion();
