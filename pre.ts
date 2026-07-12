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

export class Pre {
  readonly defs = new Map<string, bigint>();
  readonly mac = new Map<string, Mac>();
  private seq = 0;
  private made = 0;
  private readonly stack: string[] = [];

  constructor(private readonly inc?: IncFn, defs: Record<string, bigint | number | string> = {}) {
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
    const out: Line[] = [], cs: Cond[] = [];
    const active = (): boolean => cs.every(x => x.on);
    for (let i = 0; i < ls.length; i++) {
      const l = ls[i]!, s = clean(l.text);
      if (!s) continue;
      const cm = /^\.(if|ifdef|ifndef|ifc|ifnc)\b\s*(.*)$/i.exec(s);
      if (cm) {
        const par = active();
        let hit = false;
        if (par) hit = this.cond(cm[1]!.toLowerCase(), cm[2]!, l);
        cs.push({ parent: par, hit, on: par && hit });
        continue;
      }
      const ei = /^\.(elseif|elif)\b\s*(.*)$/i.exec(s);
      if (ei) {
        const c = cs.at(-1); if (!c) throw new PreErr(l, ".elseif without .if");
        c.on = c.parent && !c.hit && this.cond("if", ei[2]!, l); c.hit ||= c.on;
        continue;
      }
      if (/^\.else\b/i.test(s)) {
        const c = cs.at(-1); if (!c) throw new PreErr(l, ".else without .if");
        c.on = c.parent && !c.hit; c.hit = true; continue;
      }
      if (/^\.endif\b/i.test(s)) { if (!cs.pop()) throw new PreErr(l, ".endif without .if"); continue; }

      const mm = /^\.macro\s+([A-Za-z_.$][\w.$]*)(?:\s+(.*))?$/i.exec(s);
      if (mm) {
        const [body, end] = this.grab(ls, i + 1, /^\.macro\b/i, /^\.endm\b/i, l);
        i = end;
        if (active()) this.mac.set(mm[1]!, { p: this.params(mm[2] ?? "", l), body });
        continue;
      }
      const rr = /^\.rept\s+(.+)$/i.exec(s);
      if (rr) {
        const [body, end] = this.grab(ls, i + 1, /^\.rept\b/i, /^\.endr\b/i, l); i = end;
        if (active()) {
          const n = this.abs(rr[1]!, l);
          if (n < 0 || n > 1_000_000) throw new PreErr(l, "bad .rept count");
          for (let q = 0; q < n; q++) out.push(...this.walk(body.map(x => ({ ...x, text: x.text.replace(/\\@/g, String(this.seq++)) })), dep));
        }
        continue;
      }
      if (!active()) continue;

      const im = /^\.include\s+(.+)$/i.exec(s);
      if (im) {
        if (!this.inc) throw new PreErr(l, ".include has no resolver");
        let name: string;
        try { name = quote(im[1]!); } catch (e) { throw new PreErr(l, e instanceof Error ? e.message : String(e)); }
        let q: Inc;
        try { q = this.inc(name, l.file); } catch (e) { throw new PreErr(l, e instanceof Error ? e.message : String(e)); }
        out.push(...this.file(q.src, q.file, dep + 1)); continue;
      }
      const dm = /^\.define\s+([A-Za-z_.$][\w.$]*)(?:\s+(.+))?$/i.exec(s);
      if (dm) { this.defs.set(dm[1]!, dm[2] ? BigInt(this.abs(dm[2]!, l)) : 1n); continue; }
      const um = /^\.undef\s+([A-Za-z_.$][\w.$]*)$/i.exec(s);
      if (um) { this.defs.delete(um[1]!); continue; }
      const eq = /^\.(?:equ|set)\s+([A-Za-z_.$][\w.$]*)\s*,\s*(.+)$/i.exec(s);
      if (eq) { try { this.defs.set(eq[1]!, BigInt(this.abs(eq[2]!, l))); } catch { /* Labels are the assembler's business. */ } }

      const call = /^([A-Za-z_.$][\w.$]*)(?:\s+(.*))?$/.exec(s);
      const m = call ? this.mac.get(call[1]!) : undefined;
      if (call && m) {
        if (++this.made > 1_000_000) throw new PreErr(l, "macro expansion is too large");
        const av = parts(call[2] ?? ""), vs = new Map<string, string>();
        let ai = 0;
        for (let pi = 0; pi < m.p.length; pi++) {
          const p = m.p[pi]!;
          const v = p.rest ? av.slice(ai).join(", ") : av[ai++] ?? p.def;
          if (!v && !p.def && !p.rest) throw new PreErr(l, `macro ${call[1]} needs argument ${p.name}`);
          vs.set(p.name, v); vs.set(String(pi + 1), v);
        }
        if (ai < av.length && !m.p.some(x => x.rest)) throw new PreErr(l, `too many arguments for macro ${call[1]}`);
        const id = String(this.seq++);
        const body = m.body.map(x => ({ ...x, file: l.file, line: l.line, text: this.sub(x.text, vs, id) }));
        out.push(...this.walk(body, dep)); continue;
      }
      out.push({ ...l, text: s });
    }
    if (cs.length) throw new PreErr(ls.at(-1) ?? { text: "", file: "<input>", line: 1 }, "missing .endif");
    return out;
  }

  private grab(ls: Line[], at: number, open: RegExp, shut: RegExp, loc: Line): [Line[], number] {
    let dep = 1;
    for (let i = at; i < ls.length; i++) {
      const s = clean(ls[i]!.text);
      if (open.test(s)) dep++;
      if (shut.test(s) && --dep === 0) return [ls.slice(at, i), i];
    }
    throw new PreErr(loc, `unterminated ${clean(loc.text).split(/\s/)[0]}`);
  }

  private params(s: string, l: Line): Param[] {
    if (!s.trim()) return [];
    return parts(s).map(x => {
      const m = /^([A-Za-z_.$][\w.$]*)(?::(vararg))?(?:=(.*))?$/.exec(x);
      if (!m) throw new PreErr(l, `bad macro parameter '${x}'`);
      return { name: m[1]!, rest: !!m[2], def: m[3] ?? "" };
    });
  }

  private sub(s: string, v: Map<string, string>, id: string): string {
    let out = s.replace(/\\@/g, id);
    out = out.replace(/\\([A-Za-z_.$][\w.$]*|\d+)/g, (m, k: string) => v.has(k) ? v.get(k)! : m);
    return out.replace(/\\\(\)/g, "");
  }

  private cond(k: string, s: string, l: Line): boolean {
    if (k === "ifdef" || k === "ifndef") {
      const hit = this.defs.has(s.trim()) || this.mac.has(s.trim()); return k === "ifdef" ? hit : !hit;
    }
    if (k === "ifc" || k === "ifnc") {
      const a = parts(s); if (a.length !== 2) throw new PreErr(l, `.${k} needs two strings`);
      const hit = a[0] === a[1]; return k === "ifc" ? hit : !hit;
    }
    const q = s.replace(/defined\s*\(\s*([A-Za-z_.$][\w.$]*)\s*\)/g, (_m, x: string) => this.defs.has(x) || this.mac.has(x) ? "1" : "0");
    return this.abs(q, l) !== 0;
  }

  private abs(s: string, l: Line): number {
    try {
      const n = absolute(s, k => this.defs.get(k));
      const z = Number(n); if (!Number.isSafeInteger(z)) throw new Error("expression exceeds the safe integer range");
      return z;
    } catch (e) { throw new PreErr(l, e instanceof Error ? e.message : String(e)); }
  }
}
