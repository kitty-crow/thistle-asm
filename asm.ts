import { enc } from "./codec.js";
import { BY_NAME, I_SZ, Op, reg, word } from "./isa.js";
import type { Form } from "./isa.js";
import { BY64_NAME, I64_SZ, freg, fword64, word64, xreg } from "./isa64.js";
import type { Form64 } from "./isa64.js";
import { Obj } from "./fmt.js";
import type { Bind, Dbg, Mach, RType, SType, Sym } from "./fmt.js";
import { expr } from "./expr.js";
import type { Exp, Lin } from "./expr.js";
import { Pre } from "./pre.js";
import type { IncFn, Line } from "./pre.js";
import { align, clean, hex, parts, quote } from "./syn.js";

interface Buf {
  name: string;
  flg: string;
  align: number;
  b: number[];
  size: number;
  bss: boolean;
}

interface Def extends Sym { made: boolean; }
interface Equ { x: Exp; sec: string; off: number; loc: Line; }
interface Fix { sec: string; off: number; type: RType; x: Exp; dot: Dot; loc: Line; }
interface SFix { name: string; x: Exp; dot: Dot; loc: Line; }
interface Dot { sec: string; off: number; }
interface Ref { name: string; sec: string; val: bigint; ext: boolean; }

export interface AsmOpt {
  debug?: boolean;
  defs?: Record<string, bigint | number | string>;
  arch?: Mach;
}

export interface AsmOut {
  obj: Obj;
  list: string;
  warn: string[];
}

export class AsmErr extends Error {
  constructor(readonly loc: Line, msg: string) { super(`${loc.file}:${loc.line}: ${msg}`); this.name = "AsmErr"; }
}

const secDef = (name: string): [string, boolean] => name === ".text" ? ["ax", false] : name === ".rodata" ? ["a", false] : name === ".data" ? ["aw", false] : name === ".bss" ? ["aw", true] : ["a", false];
const id = (s: string): boolean => /^[A-Za-z_.$][A-Za-z0-9_.$]*$/.test(s);
const dotKey = (n: number): string => `\0dot${n}`;

export class Asm {
  readonly warn: string[] = [];
  private readonly pre: Pre;
  private readonly ss = new Map<string, Buf>();
  private readonly sy = new Map<string, Def>();
  private readonly eq = new Map<string, Equ>();
  private readonly fx: Fix[] = [];
  private readonly sz: SFix[] = [];
  private readonly dots = new Map<string, Dot>();
  private readonly files = new Map<number, string>();
  private readonly dbg: Dbg[] = [];
  private readonly ident: string[] = [];
  private readonly rows: string[] = [];
  private sec!: Buf;
  private prev = ".text";
  private readonly stk: string[] = [];
  private dl: { file: string; line: number; col: number } | null = null;
  private stop = false;
  private dseq = 0;
  private readonly arch: Mach;

  constructor(inc?: IncFn, private readonly opt: AsmOpt = {}) {
    this.arch = opt.arch ?? "thistle64";
    this.pre = new Pre(inc, opt.defs);
    this.setSec(".text");
  }

  run(src: string, file = "<stdin>"): AsmOut {
    let ls: Line[];
    try { ls = this.nums(this.pre.run(src, file)); }
    catch (e) { if (e instanceof AsmErr) throw e; throw new Error(e instanceof Error ? e.message : String(e)); }
    for (const l of ls) {
      if (this.stop) break;
      try { this.line(l); }
      catch (e) { if (e instanceof AsmErr) throw e; throw new AsmErr(l, e instanceof Error ? e.message : String(e)); }
    }
    const obj = this.finish();
    return { obj, list: this.rows.join("\n") + (this.rows.length ? "\n" : ""), warn: [...this.warn] };
  }

  private line(l: Line): void {
    let s = clean(l.text);
    if (!s) return;
    for (;;) {
      const m = /^([A-Za-z_.$][A-Za-z0-9_.$]*):/.exec(s);
      if (!m) break;
      this.label(m[1]!, l); s = s.slice(m[0].length).trim();
    }
    if (!s) return;
    if (s.startsWith(".")) this.dir(s, l); else this.ins(s, l);
  }

  private label(name: string, l: Line): void {
    if (this.eq.has(name)) throw new AsmErr(l, `symbol ${name} is already an absolute expression`);
    const q = this.sym(name);
    if (q.made) throw new AsmErr(l, `duplicate symbol ${name}`);
    q.sec = this.sec.name; q.val = this.at(); q.made = true;
  }

  private dir(s: string, l: Line): void {
    const m = /^(\.[A-Za-z][\w.]*)\b\s*(.*)$/.exec(s);
    if (!m) throw new AsmErr(l, `bad directive '${s}'`);
    const k = m[1]!.toLowerCase(), a = m[2]!.trim();
    if ([".text", ".data", ".rodata", ".bss"].includes(k)) { this.setSec(k); return; }
    if (k === ".section" || k === ".pushsection") {
      const p = parts(a), name = p[0]?.replace(/^"|"$/g, "");
      if (!name) throw new AsmErr(l, `${k} needs a name`);
      if (k === ".pushsection") this.stk.push(this.sec.name);
      const [df, db] = secDef(name), flg = p[1] ? quote(p[1]) : df, bss = p.some(x => /nobits/i.test(x)) || db;
      this.setSec(name, flg, bss); return;
    }
    if (k === ".popsection") { const q = this.stk.pop(); if (!q) throw new AsmErr(l, ".popsection without .pushsection"); this.setSec(q); return; }
    if (k === ".previous") { const q = this.prev; this.prev = this.sec.name; this.setSec(q, undefined, undefined, false); return; }
    if ([".align", ".balign", ".p2align"].includes(k)) { this.doAlign(k, a, l); return; }
    if ([".byte", ".u8", ".short", ".hword", ".u16", ".word", ".long", ".int", ".u32", ".i32", ".quad", ".u64", ".i64"].includes(k)) {
      const n = [".byte", ".u8"].includes(k) ? 1 : [".short", ".hword", ".u16"].includes(k) ? 2 : [".quad", ".u64", ".i64"].includes(k) ? 8 : 4;
      for (const x of parts(a)) {
        if (n === 1 && /^["']/.test(x)) this.put(enc(quote(x)), l);
        else this.emitVal(x, n, l);
      }
      return;
    }
    if ([".ascii", ".asciz", ".string", ".zstr"].includes(k)) {
      const z = k !== ".ascii";
      for (const x of parts(a)) { this.put(enc(quote(x)), l); if (z) this.put(Uint8Array.of(0), l); }
      return;
    }
    if ([".space", ".skip", ".zero"].includes(k)) {
      const p = parts(a), n = this.abs(p[0] ?? "", this.dot(), l), v = k === ".zero" ? 0 : this.abs(p[1] ?? "0", this.dot(), l);
      this.fill(n, v, l); return;
    }
    if (k === ".fill") {
      const p = parts(a), n = this.abs(p[0] ?? "", this.dot(), l), z = this.abs(p[1] ?? "1", this.dot(), l), v = this.big(p[2] ?? "0", this.dot(), l);
      if (z < 1 || z > 8) throw new AsmErr(l, ".fill item size must be 1..8");
      for (let i = 0; i < n; i++) for (let j = 0; j < z; j++) this.fill(1, Number(v >> BigInt(j * 8) & 255n), l);
      return;
    }
    if (k === ".org") {
      const p = parts(a), n = this.abs(p[0] ?? "", this.dot(), l), now = this.at();
      if (n < now) throw new AsmErr(l, ".org cannot move backwards");
      this.fill(n - now, this.abs(p[1] ?? "0", this.dot(), l), l); return;
    }
    if ([".float", ".single", ".double"].includes(k)) { this.floats(a, k === ".double" ? 8 : 4, l); return; }
    if (k === ".uleb128" || k === ".sleb128") { for (const x of parts(a)) this.leb(this.big(x, this.dot(), l), k === ".sleb128", l); return; }
    if (k === ".equ" || k === ".set" || k === ".equiv") { this.equ(k, a, l); return; }
    if (k === ".comm" || k === ".lcomm") { this.comm(k, a, l); return; }
    if ([".global", ".globl", ".weak", ".local", ".extern", ".hidden"].includes(k)) { this.attrs(k, a, l); return; }
    if (k === ".type") { this.type(a, l); return; }
    if (k === ".size") { const p = parts(a); if (p.length !== 2 || !id(p[0]!)) throw new AsmErr(l, "bad .size"); this.sz.push({ name: p[0]!, x: expr(p[1]!), dot: this.dot(), loc: l }); return; }
    if (k === ".file") { this.fileDir(a, l); return; }
    if (k === ".loc") { this.locDir(a, l); return; }
    if (k === ".ident") { this.ident.push(quote(a)); return; }
    if (k === ".arch") { if (a !== this.arch) throw new AsmErr(l, `source requests ${a}, assembler targets ${this.arch}`); return; }
    if (k === ".code32") { if (this.arch !== "thistle32") throw new AsmErr(l, ".code32 needs --32"); return; }
    if (k === ".code64") { if (this.arch !== "thistle64") throw new AsmErr(l, ".code64 needs --64"); return; }
    if (k === ".warning") { this.warn.push(`${l.file}:${l.line}: ${this.msg(a)}`); return; }
    if (k === ".error") throw new AsmErr(l, this.msg(a));
    if (k === ".end") { this.stop = true; return; }
    throw new AsmErr(l, `unknown directive ${k}`);
  }

  private ins(s: string, l: Line): void {
    if (this.arch === "thistle64") { this.ins64(s, l); return; }
    this.ins32(s, l);
  }

  private ins32(s: string, l: Line): void {
    const m = /^([A-Za-z][\w.]*)\b\s*(.*)$/.exec(s);
    if (!m) throw new AsmErr(l, `bad instruction '${s}'`);
    let n = m[1]!.toLowerCase(), a = parts(m[2]!);
    const al: Record<string, string> = { b: "jmp", beq: "je", bz: "je", bne: "jne", bnz: "jne", blt: "jl", ble: "jle", bgt: "jg", bge: "jge", blo: "jb", bls: "jbe", bhi: "ja", bhs: "jae", la: "li" };
    n = al[n] ?? n;
    if (n === "clr") { n = "li"; a = [a[0] ?? "", "0"]; }
    else if (n === "inc") { n = "addi"; a = [a[0] ?? "", a[0] ?? "", "1"]; }
    else if (n === "dec") { n = "subi"; a = [a[0] ?? "", a[0] ?? "", "1"]; }
    else if (n === "tst") { n = "test"; a = [a[0] ?? "", a[0] ?? ""]; }
    if (n === "mov" && a.length === 2 && reg(a[1]!) === null) n = "li";
    const i = BY_NAME.get(n); if (!i) throw new AsmErr(l, `unknown instruction ${n}`);
    const at = this.at(), d = (x: string | undefined): number => { const q = reg(x ?? ""); if (q === null) throw new AsmErr(l, `register expected, got '${x ?? ""}'`); return q; };
    let rd = 0, ra = 0, rb = 0, im: string | null = null;
    const need = (z: number): void => { if (a.length !== z) throw new AsmErr(l, `${n} takes ${z} operand${z === 1 ? "" : "s"}`); };
    switch (i.form as Form) {
      case "z": need(0); break;
      case "r": need(1); rd = d(a[0]); break;
      case "rr": need(2); rd = d(a[0]); ra = d(a[1]); break;
      case "rrr": need(3); rd = d(a[0]); ra = d(a[1]); rb = d(a[2]); break;
      case "ri": need(2); rd = d(a[0]); im = a[1]!; break;
      case "rri": need(3); rd = d(a[0]); ra = d(a[1]); im = a[2]!; break;
      case "cmp": need(2); ra = d(a[0]); rb = d(a[1]); break;
      case "cmpi": need(2); ra = d(a[0]); im = a[1]!; break;
      case "br": need(1); im = a[0]!; break;
      case "memr": { need(2); rd = d(a[0]); const q = this.mem(a[1]!, l); ra = q[0]; im = q[1]; break; }
      case "memw": { need(2); const q = this.mem(a[0]!, l); ra = q[0]; im = q[1]; rd = d(a[1]); break; }
      case "sys": need(1); im = a[0]!; break;
    }
    this.put(word(i.op, rd, ra, rb), l);
    if (im !== null) this.fx.push({ sec: this.sec.name, off: at + 4, type: i.form === "br" ? "rel32" : "abs32", x: expr(im), dot: { sec: this.sec.name, off: at }, loc: l });
    this.mark(at, l);
  }

  private ins64(s: string, l: Line): void {
    const m = /^([A-Za-z][\w.]*)\b\s*(.*)$/.exec(s);
    if (!m) throw new AsmErr(l, `bad instruction '${s}'`);
    let n = m[1]!.toLowerCase(), a = parts(m[2]!);
    const al: Record<string, string> = { b: "jmp", beq: "je", bz: "je", bne: "jne", bnz: "jne", blt: "jl", ble: "jle", bgt: "jg", bge: "jge", blo: "jb", bls: "jbe", bhi: "ja", bhs: "jae", la: "li", ld32: "ld32s" };
    n = al[n] ?? n;
    if (n === "clr") { n = "li"; a = [a[0] ?? "", "0"]; }
    else if (n === "inc") { n = "addi"; a = [a[0] ?? "", a[0] ?? "", "1"]; }
    else if (n === "dec") { n = "subi"; a = [a[0] ?? "", a[0] ?? "", "1"]; }
    else if (n === "tst") { n = "test"; a = [a[0] ?? "", a[0] ?? ""]; }
    if (n === "mov" && a.length === 2 && xreg(a[1]!) === null) n = "li";
    const i = BY64_NAME.get(n); if (!i) throw new AsmErr(l, `unknown thistle64 instruction ${n}`);
    const at = this.at();
    const xr = (x: string | undefined): number => { const q = xreg(x ?? ""); if (q === null) throw new AsmErr(l, `integer register expected, got '${x ?? ""}'`); return q; };
    const fr = (x: string | undefined): number => { const q = freg(x ?? ""); if (q === null) throw new AsmErr(l, `float register expected, got '${x ?? ""}'`); return q; };
    const need = (z: number): void => { if (a.length !== z) throw new AsmErr(l, `${n} takes ${z} operand${z === 1 ? "" : "s"}`); };
    let rd = 0, ra = 0, rb = 0, im: string | null = null;
    switch (i.form as Form64) {
      case "z": need(0); break;
      case "x": need(1); rd = xr(a[0]); break;
      case "xx": need(2); rd = xr(a[0]); ra = xr(a[1]); break;
      case "xxx": need(3); rd = xr(a[0]); ra = xr(a[1]); rb = xr(a[2]); break;
      case "xi": need(2); rd = xr(a[0]); im = a[1]!; break;
      case "xxi": need(3); rd = xr(a[0]); ra = xr(a[1]); im = a[2]!; break;
      case "cmp": need(2); ra = xr(a[0]); rb = xr(a[1]); break;
      case "cmpi": need(2); ra = xr(a[0]); im = a[1]!; break;
      case "br": need(1); im = a[0]!; break;
      case "memx": { need(2); rd = xr(a[0]); const q = this.mem64(a[1]!, l); ra = q[0]; im = q[1]; break; }
      case "memw": { need(2); const q = this.mem64(a[0]!, l); ra = q[0]; im = q[1]; rd = xr(a[1]); break; }
      case "sys": need(1); im = a[0]!; break;
      case "f": need(1); rd = fr(a[0]); break;
      case "ff": need(2); rd = fr(a[0]); ra = fr(a[1]); break;
      case "fff": need(3); rd = fr(a[0]); ra = fr(a[1]); rb = fr(a[2]); break;
      case "fi": {
        need(2); rd = fr(a[0]);
        const v = Number(a[1]); if (!Number.isFinite(v)) throw new AsmErr(l, `finite float expected, got '${a[1]}'`);
        this.put(fword64(i.op, rd, v), l); this.mark(at, l); return;
      }
      case "fcmp": need(2); ra = fr(a[0]); rb = fr(a[1]); break;
      case "xf": need(2); rd = xr(a[0]); ra = fr(a[1]); break;
      case "fx": need(2); rd = fr(a[0]); ra = xr(a[1]); break;
      case "xff": need(3); rd = xr(a[0]); ra = fr(a[1]); rb = fr(a[2]); break;
      case "fmemr": { need(2); rd = fr(a[0]); const q = this.mem64(a[1]!, l); ra = q[0]; im = q[1]; break; }
      case "fmemw": { need(2); const q = this.mem64(a[0]!, l); ra = q[0]; im = q[1]; rd = fr(a[1]); break; }
    }
    this.put(word64(i.op, rd, ra, rb), l);
    if (im !== null) this.fx.push({ sec: this.sec.name, off: at + 8, type: i.form === "br" ? "rel64" : "abs64", x: expr(im), dot: { sec: this.sec.name, off: at }, loc: l });
    this.mark(at, l);
  }

  private finish(): Obj {
    for (const [name, q] of this.eq) {
      const v = this.calc(q.x, { sec: q.sec, off: q.off }, q.loc, new Set([name]));
      const a = this.reduce(v, q.loc);
      if (a.ext) throw new AsmErr(q.loc, `.equ ${name} depends on undefined symbol ${a.name}`);
      const s = this.sym(name); s.made = true; s.sec = a.sec || "ABS"; s.val = Number(a.val);
    }
    for (const q of this.sz) {
      const n = this.absolute(this.calc(q.x, q.dot, q.loc), q.loc);
      if (n < 0n || n > BigInt(Number.MAX_SAFE_INTEGER)) throw new AsmErr(q.loc, "symbol size is out of range");
      this.sym(q.name).size = Number(n);
    }
    const obj = new Obj(this.arch);
    for (const q of this.fx) this.fix(q, obj);
    for (const s of this.ss.values()) obj.sec.push({ name: s.name, flg: s.flg, align: s.align, data: Uint8Array.from(s.b), size: s.size, addr: 0 });
    for (const s of this.sy.values()) {
      if (!s.made && s.bind === "local") s.bind = "global";
      if (s.made || s.bind !== "local") obj.sym.push({ name: s.name, bind: s.bind, type: s.type, vis: s.vis, sec: s.sec, val: s.val, size: s.size });
    }
    obj.dbg.push(...this.dbg); obj.ident.push(...this.ident);
    return obj;
  }

  private fix(q: Fix, obj: Obj): void {
    const v = this.calc(q.x, q.dot, q.loc), r = this.reduce(v, q.loc);
    if (!r.sec && !r.ext && q.type !== "rel32" && q.type !== "rel64") { this.patch(q, r.val); return; }
    let name = r.name;
    if (!name) {
      name = `.Lsec$${r.sec.replace(/[^A-Za-z0-9_]/g, "_")}`;
      const z = this.sym(name); if (!z.made) { z.made = true; z.sec = r.sec; z.val = 0; z.type = "section"; }
    }
    if ((q.type === "rel32" || q.type === "rel64") && !r.sec && !r.ext) {
      name = ".Labs$0"; const z = this.sym(name); if (!z.made) { z.made = true; z.sec = "ABS"; z.val = 0; }
    }
    const add = Number(r.val - (r.name && !r.ext ? BigInt(this.sy.get(r.name)?.val ?? 0) : 0n));
    if (!Number.isSafeInteger(add)) throw new AsmErr(q.loc, "relocation addend is too large");
    obj.rel.push({ sec: q.sec, off: q.off, type: q.type, sym: name, add });
  }

  private calc(x: Exp, d: Dot, l: Line, seen = new Set<string>()): Lin {
    return x.eval(k => {
      if (k === ".") { const n = dotKey(this.dseq++); this.dots.set(n, d); return { n: 0n, t: new Map([[n, 1n]]) }; }
      const q = this.eq.get(k);
      if (q) {
        if (seen.has(k)) throw new AsmErr(l, `cyclic .equ involving ${k}`);
        const z = new Set(seen); z.add(k); return this.calc(q.x, { sec: q.sec, off: q.off }, q.loc, z);
      }
      const n = this.pre.defs.get(k); return n === undefined ? undefined : { n, t: new Map() };
    });
  }

  private reduce(x: Lin, l: Line): Ref {
    let n = x.n;
    const bs = new Map<string, bigint>(), ex = new Map<string, bigint>();
    const rs: Array<{ name: string; sec: string; val: bigint; c: bigint; ext: boolean }> = [];
    for (const [name, c] of x.t) {
      const d = this.dots.get(name), s = d ? null : this.sy.get(name);
      if (d) { n += BigInt(d.off) * c; bs.set(d.sec, (bs.get(d.sec) ?? 0n) + c); rs.push({ name: "", sec: d.sec, val: BigInt(d.off), c, ext: false }); continue; }
      if (s?.made) {
        if (s.sec === "ABS") { n += BigInt(s.val) * c; continue; }
        n += BigInt(s.val) * c; bs.set(s.sec, (bs.get(s.sec) ?? 0n) + c); rs.push({ name, sec: s.sec, val: BigInt(s.val), c, ext: false });
      } else { ex.set(name, (ex.get(name) ?? 0n) + c); rs.push({ name, sec: "", val: 0n, c, ext: true }); }
    }
    for (const [k, c] of [...bs]) if (!c) bs.delete(k);
    for (const [k, c] of [...ex]) if (!c) ex.delete(k);
    if (!bs.size && !ex.size) return { name: "", sec: "", val: n, ext: false };
    if (ex.size === 1 && !bs.size) {
      const [name, c] = [...ex][0]!; if (c !== 1n) throw new AsmErr(l, "external symbol coefficient must be one");
      return { name, sec: "", val: n, ext: true };
    }
    if (!ex.size && bs.size === 1) {
      const [sec, c] = [...bs][0]!; if (c !== 1n) throw new AsmErr(l, "expression does not describe one address");
      const q = rs.find(z => !z.ext && z.sec === sec && z.name) ?? rs.find(z => !z.ext && z.sec === sec)!;
      return { name: q.name, sec, val: n, ext: false };
    }
    throw new AsmErr(l, "expression needs more than one relocation");
  }

  private absolute(x: Lin, l: Line): bigint { const q = this.reduce(x, l); if (q.sec || q.ext) throw new AsmErr(l, `absolute expression required${q.name ? ` near ${q.name}` : ""}`); return q.val; }
  private big(s: string, d: Dot, l: Line): bigint { return this.absolute(this.calc(expr(s), d, l), l); }
  private abs(s: string, d: Dot, l: Line): number { const n = Number(this.big(s, d, l)); if (!Number.isSafeInteger(n)) throw new AsmErr(l, "integer is too large"); return n; }

  private patch(q: Fix, n: bigint): void {
    const s = this.ss.get(q.sec)!;
    if (s.bss) throw new AsmErr(q.loc, "relocations cannot live in a nobits section");
    const z = q.type === "abs8" ? 1 : q.type === "abs16" ? 2 : q.type === "abs64" || q.type === "rel64" ? 8 : 4;
    const lo = -(1n << BigInt(z * 8 - 1)), hi = (1n << BigInt(z * 8)) - 1n;
    if (n < lo || n > hi) throw new AsmErr(q.loc, `${q.type} value is out of range`);
    const v = BigInt.asUintN(z * 8, n);
    for (let i = 0; i < z; i++) s.b[q.off + i] = Number(v >> BigInt(i * 8) & 255n);
  }

  private emitVal(s: string, n: number, l: Line): void {
    const at = this.at(); this.fill(n, 0, l);
    this.fx.push({ sec: this.sec.name, off: at, type: n === 1 ? "abs8" : n === 2 ? "abs16" : n === 8 ? "abs64" : "abs32", x: expr(s), dot: { sec: this.sec.name, off: at }, loc: l });
  }

  private doAlign(k: string, a: string, l: Line): void {
    const p = parts(a), x = this.abs(p[0] ?? "", this.dot(), l), n = k === ".p2align" ? 2 ** x : x;
    if (!n || n > 0x100000 || (n & (n - 1))) throw new AsmErr(l, "alignment must be a power of two up to 1 MiB");
    const pad = align(this.at(), n) - this.at(), max = p[2] ? this.abs(p[2], this.dot(), l) : -1;
    this.sec.align = Math.max(this.sec.align, n);
    if (max < 0 || pad <= max) this.fill(pad, this.abs(p[1] ?? "0", this.dot(), l), l);
  }

  private floats(a: string, n: number, l: Line): void {
    for (const x of parts(a)) {
      const v = Number(x); if (!Number.isFinite(v)) throw new AsmErr(l, `bad floating value ${x}`);
      const b = new Uint8Array(n), d = new DataView(b.buffer); if (n === 4) d.setFloat32(0, v, true); else d.setFloat64(0, v, true); this.put(b, l);
    }
  }

  private leb(n: bigint, sign: boolean, l: Line): void {
    const b: number[] = [];
    if (!sign && n < 0n) throw new AsmErr(l, "unsigned LEB128 cannot encode a negative value");
    for (;;) {
      let q = Number(n & 0x7fn), next = n >> 7n;
      const done = sign ? next === 0n && !(q & 0x40) || next === -1n && !!(q & 0x40) : next === 0n;
      if (!done) q |= 0x80; b.push(q); n = next; if (done) break;
    }
    this.put(Uint8Array.from(b), l);
  }

  private equ(k: string, a: string, l: Line): void {
    const p = parts(a); if (p.length !== 2 || !id(p[0]!)) throw new AsmErr(l, `bad ${k}`);
    const name = p[0]!;
    if (k !== ".set" && (this.eq.has(name) || this.sy.get(name)?.made)) throw new AsmErr(l, `duplicate symbol ${name}`);
    this.eq.set(name, { x: expr(p[1]!), sec: this.sec.name, off: this.at(), loc: l });
  }

  private comm(k: string, a: string, l: Line): void {
    const p = parts(a); if (p.length < 2 || !id(p[0]!)) throw new AsmErr(l, `bad ${k}`);
    const n = this.abs(p[1]!, this.dot(), l), al = this.abs(p[2] ?? (this.arch === "thistle64" ? "8" : "4"), this.dot(), l), old = this.sec.name;
    this.setSec(".bss"); this.doAlign(".align", String(al), l);
    const q = this.sym(p[0]!); if (q.made) throw new AsmErr(l, `duplicate symbol ${q.name}`);
    q.made = true; q.sec = ".bss"; q.val = this.at(); q.size = n; q.type = "object"; q.bind = k === ".comm" ? "global" : "local";
    this.fill(n, 0, l); this.setSec(old);
  }

  private attrs(k: string, a: string, l: Line): void {
    const ns = parts(a); if (!ns.length || ns.some(x => !id(x))) throw new AsmErr(l, `bad ${k}`);
    for (const n of ns) {
      const q = this.sym(n);
      if (k === ".global" || k === ".globl" || k === ".extern") q.bind = "global";
      else if (k === ".weak") q.bind = "weak";
      else if (k === ".local") q.bind = "local";
      else q.vis = "hidden";
    }
  }

  private type(a: string, l: Line): void {
    const p = parts(a); if (p.length !== 2 || !id(p[0]!)) throw new AsmErr(l, "bad .type");
    const t = p[1]!.replace(/^[@%]/, "").toLowerCase(), m: Record<string, SType> = { function: "func", func: "func", object: "object", notype: "none" };
    if (!m[t]) throw new AsmErr(l, `bad symbol type ${p[1]}`); this.sym(p[0]!).type = m[t]!;
  }

  private fileDir(a: string, l: Line): void {
    const m = /^(?:(\d+)\s+)?(.+)$/.exec(a); if (!m) throw new AsmErr(l, "bad .file");
    const n = m[1] ? Number(m[1]) : this.files.size + 1; this.files.set(n, quote(m[2]!));
  }

  private locDir(a: string, l: Line): void {
    const p = a.trim().split(/\s+/), fn = Number(p[0]), ln = Number(p[1]), col = Number(p[2] ?? 0);
    const file = this.files.get(fn); if (!file || !Number.isInteger(ln) || ln < 1 || !Number.isInteger(col) || col < 0) throw new AsmErr(l, "bad .loc");
    this.dl = { file, line: ln, col };
  }

  private mem(s: string, l: Line): [number, string] {
    let m = /^\[\s*([A-Za-z0-9]+)\s*(?:([+-])\s*(.+))?\]$/.exec(s);
    if (m) { const r = reg(m[1]!); if (r === null) throw new AsmErr(l, `bad base register ${m[1]}`); return [r, m[3] ? `${m[2] === "-" ? "-(" : "("}${m[3]})` : "0"]; }
    m = /^(.+)\(\s*([A-Za-z0-9]+)\s*\)$/.exec(s);
    if (m) { const r = reg(m[2]!); if (r === null) throw new AsmErr(l, `bad base register ${m[2]}`); return [r, m[1]!]; }
    throw new AsmErr(l, `memory operand expected, got '${s}'`);
  }

  private mem64(s: string, l: Line): [number, string] {
    let m = /^\[\s*([A-Za-z0-9]+)\s*(?:([+-])\s*(.+))?\]$/.exec(s);
    if (m) { const r = xreg(m[1]!); if (r === null) throw new AsmErr(l, `bad base register ${m[1]}`); return [r, m[3] ? `${m[2] === "-" ? "-(" : "("}${m[3]})` : "0"]; }
    m = /^(.+)\(\s*([A-Za-z0-9]+)\s*\)$/.exec(s);
    if (m) { const r = xreg(m[2]!); if (r === null) throw new AsmErr(l, `bad base register ${m[2]}`); return [r, m[1]!]; }
    throw new AsmErr(l, `memory operand expected, got '${s}'`);
  }

  private sym(name: string): Def {
    let q = this.sy.get(name);
    if (!q) { q = { name, bind: "local", type: "none", vis: "default", sec: "", val: 0, size: 0, made: false }; this.sy.set(name, q); }
    return q;
  }

  private setSec(name: string, flg?: string, bss?: boolean, remember = true): void {
    let q = this.ss.get(name);
    if (!q) { const [f, z] = secDef(name); q = { name, flg: flg ?? f, align: name === ".text" ? this.arch === "thistle64" ? I64_SZ : I_SZ : 1, b: [], size: 0, bss: bss ?? z }; this.ss.set(name, q); }
    else {
      if (flg !== undefined && q.flg !== flg) throw new Error(`section ${name} flags changed from ${q.flg} to ${flg}`);
      if (bss !== undefined && q.bss !== bss) throw new Error(`section ${name} type changed`);
    }
    if (this.sec && remember && this.sec.name !== name) this.prev = this.sec.name;
    this.sec = q;
  }

  private at(): number { return this.sec.size; }
  private dot(): Dot { return { sec: this.sec.name, off: this.at() }; }

  private put(b: Uint8Array, l: Line): void {
    if (this.sec.bss && b.some(x => x)) throw new AsmErr(l, `non-zero data in nobits section ${this.sec.name}`);
    if (!this.sec.bss) this.sec.b.push(...b);
    this.sec.size += b.length;
  }

  private fill(n: number, v: number, l: Line): void {
    if (!Number.isSafeInteger(n) || n < 0 || n > 0x40000000) throw new AsmErr(l, "bad fill size");
    if (!Number.isInteger(v) || v < -128 || v > 255) throw new AsmErr(l, "fill byte is out of range");
    this.put(new Uint8Array(n).fill(v & 255), l);
  }

  private mark(at: number, l: Line): void {
    if (this.opt.debug) { const q = this.dl ?? { file: l.file, line: l.line, col: 0 }; this.dbg.push({ sec: this.sec.name, off: at, ...q }); }
    const n = this.arch === "thistle64" ? I64_SZ : I_SZ;
    const b = this.sec.bss ? new Uint8Array(n) : Uint8Array.from(this.sec.b.slice(at, at + n));
    this.rows.push(`${this.sec.name.padEnd(10)} ${hex(at)}  ${[...b].map(x => x.toString(16).padStart(2, "0")).join(" ")}  ${l.text.trim()}`);
  }

  private msg(s: string): string { try { return quote(s); } catch { return s; } }

  private nums(ls: Line[]): Line[] {
    const ds = new Map<string, Array<{ at: number; name: string }>>(), out = ls.map(x => ({ ...x }));
    let seq = 0;
    for (let i = 0; i < out.length; i++) {
      out[i]!.text = out[i]!.text.replace(/(^|\s)([0-9]+):/g, (_m, p: string, n: string) => {
        const name = `.Ln${n}$${seq++}`; const a = ds.get(n) ?? []; a.push({ at: i, name }); ds.set(n, a); return `${p}${name}:`;
      });
    }
    for (let i = 0; i < out.length; i++) out[i]!.text = out[i]!.text.replace(/\b([0-9]+)([fb])\b/g, (_m, n: string, d: string) => {
      const a = ds.get(n) ?? [], q = d === "b" ? [...a].reverse().find(x => x.at <= i) : a.find(x => x.at > i);
      if (!q) throw new AsmErr(out[i]!, `numeric label ${n}${d} has no target`); return q.name;
    });
    return out;
  }
}
