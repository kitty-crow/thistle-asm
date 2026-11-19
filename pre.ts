import { requireValue } from "./checked.js";
import { absolute } from "./expr.js";
import { clean, parts, quote } from "./syn.js";

export interface Line {
  text: string;
  file: string;
  line: number;
}

export interface Inc {
  src: string;
  file: string;
}

export type IncFn = (name: string, from: string) => Inc;

interface Param { name: string; def: string; rest: boolean; }
interface Mac { p: Param[]; body: Line[]; }
interface Cond { parent: boolean; hit: boolean; on: boolean; }

export class PreErr extends Error {
  constructor(readonly loc: Line, msg: string) { super(`${loc.file}:${loc.line}: ${msg}`); this.name = "PreErr"; }
}

const currentCondition = (stack: Cond[], loc: Line, name: string): Cond => {
  const top = (stack.at(-1) ?? null);
  if (!top) throw new PreErr(loc, `${name} without .if`);
  return top;
};

const compareStrings = (directive: string, source: string, loc: Line): boolean => {
  const a = parts(source);
  if (a.length !== 2) throw new PreErr(loc, `.${directive} needs two strings`);
  return (a[0] ?? null) === (a[1] ?? null);
};

export class Pre {
  readonly defs = new Map<string, bigint>();
  readonly mac = new Map<string, Mac>();
  private seq = 0;
  private made = 0;
  private readonly stack: string[] = [];

  constructor(private readonly inc: IncFn | null = null, defs: Record<string, bigint | number | string> = {}) {
    for (const [k, v] of Object.entries(defs)) this.defs.set(k, typeof v === "bigint" ? v : BigInt(v));
  }

  run(src: string, file = "<stdin>"): Line[] {
    this.stack.length = 0;
    return this.file(src, file, 0);
  }

  private file(src: string, file: string, dep: number): Line[] {
    if (dep > 32) throw new Error("include nesting exceeds 32 files");
    if (this.stack.includes(file)) throw new Error(`recursive include: ${[...this.stack, file].join(" -> ")}`);
    this.stack.push(file);
    try {
      const ls = src.replace(/\\\r?\n/g, "").split(/\r?\n/).map((text, i) => ({ text, file, line: i + 1 }));
      return this.walk(ls, dep);
    } finally { this.stack.pop(); }
  }

  private walk(ls: Line[], dep: number): Line[] {
    // Consume complete macro and repeat bodies even in inactive branches so inner directives cannot affect the enclosing conditional stack.
    const out: Line[] = [], cs: Cond[] = [];
    const active = (): boolean => cs.every(x => x.on);
    for (let i = 0; i < ls.length; i++) {
      const l = requireValue((ls[i] ?? null), "ls[i]"), s = clean(l.text);
      if (!s) continue;
      if (this.conditional(s, cs, l)) continue;

      const mm = /^\.macro\s+([A-Za-z_.$][\w.$]*)(?:\s+(.*))?$/i.exec(s);
      if (mm) {
        const [body, end] = this.grab(ls, i + 1, /^\.macro\b/i, /^\.endm\b/i, l);
        i = end;
        this.registerMacro(mm, body, l, active());
        continue;
      }
      const rr = /^\.rept\s+(.+)$/i.exec(s);
      if (rr) {
        const [body, end] = this.grab(ls, i + 1, /^\.rept\b/i, /^\.endr\b/i, l); i = end;
        out.push(...this.repeat(rr, body, l, dep, active()));
        continue;
      }
      if (!active()) continue;

      out.push(...this.activeLine(s, l, dep));
    }
    if (cs.length) throw new PreErr(ls.at(-1) ?? { text: "", file: "<input>", line: 1 }, "missing .endif");
    return out;
  }

  private activeLine(s: string, l: Line, dep: number): Line[] {
    const im = /^\.include\s+(.+)$/i.exec(s);
    if (im) {
      return this.include(im, l, dep);
    }
    const dm = /^\.define\s+([A-Za-z_.$][\w.$]*)(?:\s+(.+))?$/i.exec(s);
    if (dm) { this.defs.set(requireValue((dm[1] ?? null), "dm[1]"), (dm[2] ?? null) ? BigInt(this.abs(requireValue(dm[2] ?? null, "dm[2]"), l)) : 1n); return []; }
    const um = /^\.undef\s+([A-Za-z_.$][\w.$]*)$/i.exec(s);
    if (um) { this.defs.delete(requireValue((um[1] ?? null), "um[1]")); return []; }
    const eq = /^\.(?:equ|set)\s+([A-Za-z_.$][\w.$]*)\s*,\s*(.+)$/i.exec(s);
    if (eq) this.recordEqu(eq, l);

    const call = /^([A-Za-z_.$][\w.$]*)(?:\s+(.*))?$/.exec(s);
    const m = call ? (this.mac.get(requireValue((call[1] ?? null), "call[1]")) ?? null) : null;
    if (call && m) {
      return this.expand(call, m, l, dep);
    }
    return [{ ...l, text: s }];
  }

  private conditional(s: string, cs: Cond[], l: Line): boolean {
    // Only evaluate expressions in active parent branches; skipped branches may refer to undefined symbols.
    const active = (): boolean => cs.every(x => x.on);
    const cm = /^\.(if|ifdef|ifndef|ifc|ifnc)\b\s*(.*)$/i.exec(s);
    if (cm) {
      const par = active();
      const hit = par && this.cond(requireValue((cm[1] ?? null), "cm[1]").toLowerCase(), requireValue((cm[2] ?? null), "cm[2]"), l);
      cs.push({ parent: par, hit, on: par && hit });
      return true;
    }
    const ei = /^\.(elseif|elif)\b\s*(.*)$/i.exec(s);
    if (ei) {
      const c = currentCondition(cs, l, ".elseif");
      c.on = c.parent && !c.hit && this.cond("if", requireValue((ei[2] ?? null), "ei[2]"), l); c.hit ||= c.on;
      return true;
    }
    if (/^\.else\b/i.test(s)) {
      const c = currentCondition(cs, l, ".else");
      c.on = c.parent && !c.hit; c.hit = true; return true;
    }
    if (/^\.endif\b/i.test(s)) { currentCondition(cs, l, ".endif"); cs.pop(); return true; }

    return false;
  }

  private registerMacro(match: RegExpExecArray, body: Line[], loc: Line, active: boolean): void {
    if (!active) return;
    this.mac.set(requireValue((match[1] ?? null), "macro name"), { p: this.params(match[2] ?? "", loc), body });
  }

  private repeat(match: RegExpExecArray, body: Line[], loc: Line, depth: number, active: boolean): Line[] {
    if (!active) return [];
    const n = this.abs(requireValue((match[1] ?? null), "repeat count"), loc);
    if (n < 0 || n > 1_000_000) throw new PreErr(loc, "bad .rept count");
    const out: Line[] = [];
    for (let i = 0; i < n; i++) out.push(...this.walk(body.map(x => ({ ...x, text: x.text.replace(/\\@/g, String(this.seq++)) })), depth));
    return out;
  }

  private include(match: RegExpExecArray, l: Line, dep: number): Line[] {
    if (!this.inc) throw new PreErr(l, ".include has no resolver");
    let name: string;
    try { name = quote(requireValue((match[1] ?? null), "im[1]")); } catch (e) { throw new PreErr(l, e instanceof Error ? e.message : (typeof e === "string" ? e : "non-Error exception")); }
    let q: Inc;
    try { q = this.inc(name, l.file); } catch (e) { throw new PreErr(l, e instanceof Error ? e.message : (typeof e === "string" ? e : "non-Error exception")); }
    return this.file(q.src, q.file, dep + 1);
  }

  private recordEqu(match: RegExpExecArray, loc: Line): void {
    try {
      this.defs.set(requireValue((match[1] ?? null), "definition name"), BigInt(this.abs(requireValue((match[2] ?? null), "definition expression"), loc)));
    } catch (error) {
      // The assembler resolves labels after preprocessing, including expressions that are not yet absolute.
      if (error instanceof PreErr) return;
      if (error instanceof Error) throw error;
      throw new Error(typeof error === "string" ? error : "non-Error exception");
    }
  }

  private expand(call: RegExpExecArray, m: Mac, l: Line, dep: number): Line[] {
    if (++this.made > 1_000_000) throw new PreErr(l, "macro expansion is too large");
    const av = parts(call[2] ?? ""), vs = new Map<string, string>();
    let ai = 0;
    for (let pi = 0; pi < m.p.length; pi++) {
      const p = requireValue((m.p[pi] ?? null), "m.p[pi]");
      const v = p.rest ? av.slice(ai).join(", ") : av[ai++] ?? p.def;
      if (!v && !p.def && !p.rest) throw new PreErr(l, `macro ${(call[1] ?? null)} needs argument ${p.name}`);
      vs.set(p.name, v); vs.set(String(pi + 1), v);
    }
    if (ai < av.length && !m.p.some(x => x.rest)) throw new PreErr(l, `too many arguments for macro ${(call[1] ?? null)}`);
    const id = String(this.seq++);
    const body = m.body.map(x => ({ ...x, file: l.file, line: l.line, text: this.sub(x.text, vs, id) }));
    return this.walk(body, dep);
  }

  private grab(ls: Line[], at: number, open: RegExp, shut: RegExp, loc: Line): [Line[], number] {
    let dep = 1;
    for (let i = at; i < ls.length; i++) {
      const s = clean(requireValue((ls[i] ?? null), "ls[i]").text);
      if (open.test(s)) dep++;
      if (shut.test(s) && --dep === 0) return [ls.slice(at, i), i];
    }
    throw new PreErr(loc, `unterminated ${clean(loc.text).split(/\s/)[0] ?? ""}`);
  }

  private params(s: string, l: Line): Param[] {
    if (!s.trim()) return [];
    return parts(s).map(x => {
      const m = /^([A-Za-z_.$][\w.$]*)(?::(vararg))?(?:=(.*))?$/.exec(x);
      if (!m) throw new PreErr(l, `bad macro parameter '${x}'`);
      return { name: requireValue((m[1] ?? null), "m[1]"), rest: !!(m[2] ?? null), def: m[3] ?? "" };
    });
  }

  private sub(s: string, v: Map<string, string>, id: string): string {
    let out = s.replace(/\\@/g, id);
    out = out.replace(/\\([A-Za-z_.$][\w.$]*|\d+)/g, (m, k: string) => v.has(k) ? requireValue((v.get(k) ?? null), "v.get(k)") : m);
    return out.replace(/\\\(\)/g, "");
  }

  private cond(k: string, s: string, l: Line): boolean {
    if (k === "ifdef" || k === "ifndef") {
      const hit = this.defs.has(s.trim()) || this.mac.has(s.trim()); return k === "ifdef" ? hit : !hit;
    }
    if (k === "ifc" || k === "ifnc") {
      const hit = compareStrings(k, s, l); return k === "ifc" ? hit : !hit;
    }
    const q = s.replace(/defined\s*\(\s*([A-Za-z_.$][\w.$]*)\s*\)/g, (_m, x: string) => this.defs.has(x) || this.mac.has(x) ? "1" : "0");
    return this.abs(q, l) !== 0;
  }

  private abs(s: string, l: Line): number {
    try {
      const n = absolute(s, k => this.defs.get(k) ?? null);
      const z = Number(n); if (!Number.isSafeInteger(z)) throw new Error("expression exceeds the safe integer range");
      return z;
    } catch (e) { throw new PreErr(l, e instanceof Error ? e.message : (typeof e === "string" ? e : "non-Error exception")); }
  }
}
