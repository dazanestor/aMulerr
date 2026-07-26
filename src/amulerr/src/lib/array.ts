export const groupBy = <T, TKey extends string>(
  array: T[],
  predicate: (value: T, index: number, array: T[]) => TKey,
) =>
  array.reduce(
    (acc, value, index, arr) => {
      // The `||= []` relies on the accumulator's value being `undefined`
      // for keys not yet seen — Record<TKey, T[]> claims otherwise, but
      // that's an intentional white lie for a plain-object accumulator.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      ;(acc[predicate(value, index, arr)] ||= []).push(value)
      return acc
    },
    {} as Record<TKey, T[]>,
  )

export function toEntries<TKey extends string, TValue>(
  e: Record<TKey, TValue>,
) {
  return Object.entries(e) as [TKey, TValue][]
}

export function skipFalsy<T>(v: T): v is NonNullable<T> {
  return !!v
}
