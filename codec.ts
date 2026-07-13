const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const enc = (value: string): Uint8Array => encoder.encode(value);
export const dec = (value: Uint8Array): string => decoder.decode(value);
