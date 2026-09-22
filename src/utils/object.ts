/**
 * Removes keys whose value is `undefined` from a shallow object. Zod's
 * `.optional()` fields parse to `key?: T | undefined`, which can carry the
 * key with an explicit `undefined` value — fine for our own interfaces
 * (which intentionally type optional fields as `T | undefined` to accept
 * that), but not for external SDKs whose types use plain `key?: T` under
 * `exactOptionalPropertyTypes`. Call this at the boundary when forwarding
 * a Zod-parsed object into one of those SDKs.
 */
type WithoutUndefinedValues<T> = { [K in keyof T]: Exclude<T[K], undefined> };

export function stripUndefined<T extends object>(obj: T): WithoutUndefinedValues<T> {
  const out = {} as WithoutUndefinedValues<T>;
  for (const key of Object.keys(obj) as (keyof T)[]) {
    const value = obj[key];
    if (value !== undefined) {
      out[key] = value as WithoutUndefinedValues<T>[typeof key];
    }
  }
  return out;
}
