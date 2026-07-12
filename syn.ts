export const parts = (s: string, sep = ","): string[] => {
  const out: string[] = [];
  let q = "", esc = false, dep = 0, at = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (q) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === q) q = "";
    } else if (c === "'" || c === "\"") q = c;
    else if (c === "[" || c === "(") dep++;
    else if (c === "]" || c === ")") dep--;
    else if (c === sep && dep === 0) { out.push(s.slice(at, i).trim()); at = i + 1; }
  }
  out.push(s.slice(at).trim());
  return out.filter(x => x.length > 0);
};

export const clean = (s: string): string => {
  let q = "", esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!, n = s[i + 1];
    if (q) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === q) q = "";
      continue;
    }
    if (c === "'" || c === "\"") { q = c; continue; }
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
  if (q.length < 2 || !["'", "\""].includes(q[0]!) || q.at(-1) !== q[0]) throw new Error("quoted string expected");
  let out = "";
  for (let i = 1; i < q.length - 1; i++) {
    const c = q[i]!;
    if (c !== "\\") { out += c; continue; }
    const n = q[++i];
    if (n === undefined) throw new Error("unfinished string escape");
    const m: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", "0": "\0", "\\": "\\", "'": "'", "\"": "\"" };
    if (n === "x") { let z; [z, i] = hx(q, i + 1, 2); out += z; i--; }
    else if (n === "u") { let z; [z, i] = hx(q, i + 1, 4); out += z; i--; }
    else if (/[0-7]/.test(n)) {
      const x = new RegExp(`^[0-7]{1,3}`).exec(q.slice(i))![0];
      out += String.fromCharCode(Number.parseInt(x, 8)); i += x.length - 1;
    } else out += m[n] ?? n;
  }
  return out;
};

export const align = (n: number, a: number): number => Math.ceil(n / a) * a;
export const hex = (n: number, w = 8): string => (n < 0 ? n >>> 0 : Math.trunc(n)).toString(16).padStart(w, "0");
