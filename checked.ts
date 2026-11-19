/** Check an indexed value or a lookup whose presence is required by the caller. */
export const requireValue = <T>(value: T, source: string): NonNullable<T> => {
  if (value == null) throw new Error(`missing assembler value: ${source}`);
  return value;
};
