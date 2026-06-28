/**
 * A vue-i18n translate function, narrowed to the shape our helpers actually
 * use: a key plus optional named params, returning a string. The real
 * `Composer['t']` is assignable to this, but depending on its full overload
 * set (including the plural-number form) makes call sites and test mocks
 * needlessly brittle. Helpers that only resolve keys should take this instead.
 */
export type TranslateFn = (key: string, named?: Record<string, unknown>) => string;
