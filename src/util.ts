export function assertExists<T>(arg: T|null|undefined): asserts arg is NonNullable<T> {
    if (arg == null) {
        throw new Error("assertExists failed");
    }
}
