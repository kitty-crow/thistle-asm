import { requireValue } from "./checked.js";
interface QuoteState { quote: string; escaped: boolean; }

const quoted = (state: QuoteState, c: string): boolean => {
  if (state.escaped) { state.escaped = false; return true; }
  if (state.quote && c === "\\") { state.escaped = true; return true; }
  if (state.quote && c === state.quote) { state.quote = ""; return true; }
  if (state.quote) return true;
  if (c !== "'" && c !== "\"") return false;
  state.quote = c;
  return true;
};

export const parts = (s: string, sep = ","): string[] => {
  const out: string[] = [];
  const state: QuoteState = { quote: "", escaped: false };
  let dep = 0, at = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    if (quoted(state, c)) continue;
    if (c === "[" || c === "(") { dep++; continue; }
    if (c === "]" || c === ")") { dep--; continue; }
    if (c === sep && dep === 0) { out.push(s.slice(at, i).trim()); at = i + 1; }
  }
  out.push(s.slice(at).trim());
  return out.filter(x => x.length > 0);
};

export const clean = (s: string): string => {
  const state: QuoteState = { quote: "", escaped: false };
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i), n = (s[i + 1] ?? null);
    if (quoted(state, c)) continue;
    if (c === ";" || c === "#" || c === "/" && n === "/") return s.slice(0, i).trim();
  }
  return s.trim();
};

const hx = (s: string, at: number, n: number): [string, number] => {
  const q = s.slice(at, at + n);
  if (q.length !== n || !/^[0-9a-fA-F]+$/.test(q)) throw new Error("bad hexadecimal escape");
  return [String.fromCodePoint(Number.parseInt(q, 16)), at + n];
};

export const quote = (s: string): string => {
  const q = s.trim();
  if (q.length < 2 || !["'", "\""].includes(q.charAt(0)) || (q.at(-1) ?? null) !== (q[0] ?? null)) throw new Error("quoted string expected");
  let out = "";
  for (let i = 1; i < q.length - 1; i++) {
    const c = q.charAt(i);
    if (c !== "\\") { out += c; continue; }
    const n = q.charAt(++i);
    if (!n) throw new Error("unfinished string escape");
    const m: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", "0": "\0", "\\": "\\", "'": "'", "\"": "\"" };
    if (n === "x" || n === "u") {
      const pair = hx(q, i + 1, n === "x" ? 2 : 4);
      out += pair[0]; i = pair[1] - 1; continue;
    }
    if (/[0-7]/.test(n)) {
      const x = requireValue(new RegExp(`^[0-7]{1,3}`).exec(q.slice(i)), "new RegExp(`^[0-7]{1,3}`).exec(q.slice(i))")[0];
      out += String.fromCharCode(Number.parseInt(x, 8)); i += x.length - 1;
    } else out += m[n] ?? n;
  }
  return out;
};

export const align = (n: number, a: number): number => Math.ceil(n / a) * a;
export const hex = (n: number, w = 8): string => (n < 0 ? n >>> 0 : Math.trunc(n)).toString(16).padStart(w, "0");
