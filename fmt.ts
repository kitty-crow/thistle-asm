import { enc, dec } from "./codec.js";

export type Bind = "local" | "global" | "weak";
export type SType = "none" | "func" | "object" | "section";
export type Mach = "thistle32" | "thistle64";
export type Isa = "thistle" | "rv64gc";
export type RType = "abs8" | "abs16" | "abs32" | "abs64" | "rel32" | "rel64";

export interface Sec {
  name: string;
  flg: string;
  align: number;
  data: Uint8Array;
  size: number;
  addr: number;
}

export interface Sym {
  name: string;
  bind: Bind;
  type: SType;
  vis: "default" | "hidden";
  sec: string;
  val: number;
  size: number;
}

export interface Rel {
  sec: string;
  off: number;
  type: RType;
  sym: string;
  add: number;
}

export interface Dbg {
  sec: string;
  off: number;
  file: string;
  line: number;
  col: number;
}

export abstract class Bin {
  readonly ver: number;
  readonly sec: Sec[] = [];
  readonly sym: Sym[] = [];
  readonly dbg: Dbg[] = [];
  readonly ident: string[] = [];
  abstract readonly kind: "obj" | "exe";

  protected constructor(readonly machine: Mach = "thistle64") {
    this.ver = machine === "thistle64" ? 2 : 1;
  }
}

export class Obj extends Bin {
  override readonly kind = "obj" as const;
  readonly rel: Rel[] = [];

  constructor(machine: Mach = "thistle64") { super(machine); }
}

export class Exe extends Bin {
  override readonly kind = "exe" as const;
  entry = 0;
  mem: number;
  isa: Isa = "thistle";
  phdr = 0;
  phent = 0;
  phnum = 0;

  constructor(machine: Mach = "thistle64") {
    super(machine);
    this.mem = machine === "thistle64" ? 1024 * 1024 * 1024 : 16 * 1024 * 1024;
  }
}

interface MSec { name: string; flg: string; align: number; size: number; addr: number; at: number; len: number; }
interface Meta {
  machine: string;
  ver: number;
  sec: MSec[];
  sym: Sym[];
  rel: Rel[];
  dbg: Dbg[];
  ident: string[];
  entry: number;
  mem: number;
  isa?: string;
  phdr?: number;
  phent?: number;
  phnum?: number;
}

const magic = (x: Bin): Uint8Array => enc(x.kind === "obj" ? x.machine === "thistle64" ? "THO2" : "THO1" : x.machine === "thistle64" ? "THX2" : "THX1");

const hash = (b: Uint8Array): number => {
  let n = 0x811c9dc5;
  for (const x of b) { n ^= x; n = Math.imul(n, 0x01000193); }
  return n >>> 0;
};

const rec = (x: unknown): Record<string, unknown> => {
  if (!x || typeof x !== "object" || Array.isArray(x)) throw new Error("bad Thistle binary header");
  return x as Record<string, unknown>;
};

const num = (x: unknown, k: string): number => {
  if (!Number.isSafeInteger(x) || (x as number) < 0) throw new Error(`bad ${k} in Thistle binary`);
  return x as number;
};

const str = (x: unknown, k: string): string => {
  if (typeof x !== "string") throw new Error(`bad ${k} in Thistle binary`);
  return x;
};

export class Codec {
  pack(x: Obj | Exe): Uint8Array {
    let at = 0;
    const ss: MSec[] = x.sec.map(s => {
      const z = { name: s.name, flg: s.flg, align: s.align, size: s.size, addr: s.addr, at, len: s.data.length };
      at += s.data.length;
      return z;
    });
    const m: Meta = {
      machine: x.machine, ver: x.ver, sec: ss, sym: x.sym, rel: x instanceof Obj ? x.rel : [],
      dbg: x.dbg, ident: x.ident, entry: x instanceof Exe ? x.entry : 0, mem: x instanceof Exe ? x.mem : 0,
      ...(x instanceof Exe ? { isa: x.isa, phdr: x.phdr, phent: x.phent, phnum: x.phnum } : {}),
    };
    const h = enc(JSON.stringify(m));
    const out = new Uint8Array(16 + h.length + at);
    out.set(magic(x));
    const v = new DataView(out.buffer);
    v.setUint32(4, h.length, true); v.setUint32(8, at, true);
    out.set(h, 16);
    at = 16 + h.length;
    for (const s of x.sec) { out.set(s.data, at); at += s.data.length; }
    v.setUint32(12, hash(out.subarray(16)), true);
    return out;
  }

  unpack(b: Uint8Array): Obj | Exe {
    if (b.length < 16) throw new Error("truncated Thistle binary");
    const mg = dec(b.subarray(0, 4));
    const x = mg === "THO1" ? new Obj("thistle32") : mg === "THX1" ? new Exe("thistle32") : mg === "THO2" ? new Obj("thistle64") : mg === "THX2" ? new Exe("thistle64") : null;
    if (!x) throw new Error("unknown Thistle binary magic");
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const hn = v.getUint32(4, true), pn = v.getUint32(8, true);
    if (16 + hn + pn !== b.length) throw new Error("bad Thistle binary length");
    if (v.getUint32(12, true) !== hash(b.subarray(16))) throw new Error("Thistle binary checksum mismatch");
    const m = rec(JSON.parse(dec(b.subarray(16, 16 + hn))));
    if (m.machine !== x.machine || m.ver !== x.ver) throw new Error("Thistle magic, machine and version disagree");
    if (!Array.isArray(m.sec) || !Array.isArray(m.sym) || !Array.isArray(m.rel) || !Array.isArray(m.dbg) || !Array.isArray(m.ident)) throw new Error("bad Thistle binary tables");
    const sn = new Set<string>();
    for (const q0 of m.sec) {
      const q = rec(q0), off = num(q.at, "section offset"), len = num(q.len, "section length"), size = num(q.size, "section size");
      if (off + len > pn || len > size) throw new Error("section exceeds Thistle binary payload");
      const align = num(q.align, "section alignment");
      if (!align || (align & (align - 1))) throw new Error("section alignment is not a power of two");
      const name = str(q.name, "section name"); if (sn.has(name)) throw new Error(`duplicate section ${name}`); sn.add(name);
      x.sec.push({ name, flg: str(q.flg, "section flags"), align, size, addr: num(q.addr, "section address"), data: b.slice(16 + hn + off, 16 + hn + off + len) });
    }
    for (const q0 of m.sym) {
      const q = rec(q0), bind = str(q.bind, "symbol binding"), type = str(q.type, "symbol type"), vis = str(q.vis, "symbol visibility");
      if (!(["local", "global", "weak"] as string[]).includes(bind) || !(["none", "func", "object", "section"] as string[]).includes(type) || !(["default", "hidden"] as string[]).includes(vis)) throw new Error("bad symbol attributes");
      x.sym.push({ name: str(q.name, "symbol name"), bind: bind as Bind, type: type as SType, vis: vis as "default" | "hidden", sec: str(q.sec, "symbol section"), val: num(q.val, "symbol value"), size: num(q.size, "symbol size") });
    }
    for (const q0 of m.dbg) {
      const q = rec(q0);
      x.dbg.push({ sec: str(q.sec, "debug section"), off: num(q.off, "debug offset"), file: str(q.file, "debug file"), line: num(q.line, "debug line"), col: num(q.col, "debug column") });
    }
    for (const s of m.ident) x.ident.push(str(s, "ident"));
    if (x instanceof Obj) {
      for (const q0 of m.rel) {
        const q = rec(q0), type = str(q.type, "relocation type");
        if (!(["abs8", "abs16", "abs32", "abs64", "rel32", "rel64"] as string[]).includes(type)) throw new Error("bad relocation type");
        const add = q.add;
        if (!Number.isSafeInteger(add)) throw new Error("bad relocation addend");
        x.rel.push({ sec: str(q.sec, "relocation section"), off: num(q.off, "relocation offset"), type: type as RType, sym: str(q.sym, "relocation symbol"), add: add as number });
      }
    } else {
      x.entry = num(m.entry, "entry address");
      x.mem = num(m.mem, "memory size");
      const isa = m.isa ?? "thistle";
      if (isa !== "thistle" && isa !== "rv64gc") throw new Error("bad instruction set in Thistle binary");
      if (isa === "rv64gc" && x.machine !== "thistle64") throw new Error("rv64gc needs the thistle64 ABI");
      x.isa = isa;
      x.phdr = m.phdr === undefined ? 0 : num(m.phdr, "program header address");
      x.phent = m.phent === undefined ? 0 : num(m.phent, "program header size");
      x.phnum = m.phnum === undefined ? 0 : num(m.phnum, "program header count");
    }
    return x;
  }
}

export const codec = new Codec();
const mag = (b: Uint8Array): string => b.length >= 4 ? dec(b.subarray(0, 4)) : "";
export const isObj = (b: Uint8Array): boolean => ["THO1", "THO2"].includes(mag(b));
export const isExe = (b: Uint8Array): boolean => ["THX1", "THX2"].includes(mag(b));
