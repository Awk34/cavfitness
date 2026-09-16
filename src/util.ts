export function assertExists<T>(
  arg: T | null | undefined,
  message = "assertExists failed",
): asserts arg is NonNullable<T> {
  if (arg == null) {
    throw new Error(message);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
