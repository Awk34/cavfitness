import { describe, expect, test } from "@jest/globals";
import { VERSION } from "./index";

describe("version", () => {
  test("resolves package version correctly", () => {
    expect(VERSION).toBeDefined();
    expect(VERSION).not.toBe("unknown");
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
