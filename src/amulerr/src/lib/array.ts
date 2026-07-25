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

export const countBy = <T, TKey extends string>(
  array: T[],
  predicate: (value: T, index: number, array: T[]) => TKey,
) =>
  array.reduce(
    (acc, value, index, arr) => {
      acc[predicate(value, index, arr)] ||= 0
      ++acc[predicate(value, index, arr)]
      return acc
    },
    {} as Record<TKey, number>,
  )

export function toEntries<TKey extends string, TValue>(
  e: Record<TKey, TValue>,
) {
  return Object.entries(e) as [TKey, TValue][]
}

export function fromEntries<TKey extends string, TValue>(e: [TKey, TValue][]) {
  return Object.fromEntries(e) as Record<TKey, TValue>
}

export function skipFalsy<T>(v: T): v is NonNullable<T> {
  return !!v
}

export function splitIntoChunks<T>(array: T[], chunkSize: number) {
  return array.flatMap((_, i) =>
    i % chunkSize === 0 ? [array.slice(i, i + chunkSize)] : [],
  )
}
