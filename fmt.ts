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




}

const magic = (x: Bin): Uint8Array => enc(x.kind === "obj" ? x.machine === "thistle64" ? "THO2" : "THO1" : x.machine === "thistle64" ? "THX2" : "THX1");

const hash = (b: Uint8Array): number => {
  let n = 0x811c9dc5;
  for (const x of b) { n ^= x; n = Math.imul(n, 0x01000193); }
  return n >>> 0;
};

/**
 * JSON has a finite structural value grammar. Do not erase metadata into
 * `any` or `unknown`: the decoder validates the concrete shape before
 * constructing a Thistle executable, and Bake must retain these guards.
 */
type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
interface JsonObject { [name: string]: JsonValue; }

// Decode the JSON grammar directly so an untyped host parser cannot bypass the binary boundary.
class JsonReader {
  private at = 0;
  constructor(private readonly source: string) {}
  private whitespace(): void {
    while (this.at < this.source.length && /[ \t\r\n]/.test(this.source.charAt(this.at))) this.at++;
  }
  private take(s: string): boolean {
    this.whitespace();
    if (!this.source.startsWith(s, this.at)) return false;
    this.at += s.length;
    return true;
  }
  private string(): string {
    this.whitespace();
    const match = /^"((?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*)"/.exec(this.source.slice(this.at));
    if (!match) throw new Error("invalid JSON string");
    this.at += match[0].length;
    const escapes: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
    return (match[1] ?? "").replace(/\\(u[0-9a-fA-F]{4}|["\\/bfnrt])/g, (_match: string, code: string) => code.startsWith("u") ? String.fromCharCode(Number.parseInt(code.slice(1), 16)) : escapes[code] ?? "");
  }
  private object(): JsonObject {
    const value: JsonObject = {};
    if (this.take("}")) return value;
    do {
      const key = this.string();
      if (!this.take(":")) throw new Error("invalid JSON member");
      Object.defineProperty(value, key, { value: this.value(), enumerable: true, configurable: true, writable: true });
    } while (this.take(","));
    if (!this.take("}")) throw new Error("invalid JSON object");
    return value;
  }
  private array(): JsonValue[] {
    const value: JsonValue[] = [];
    if (this.take("]")) return value;
    do { value.push(this.value()); } while (this.take(","));
    if (!this.take("]")) throw new Error("invalid JSON array");
    return value;
  }
  private value(): JsonValue {
    this.whitespace();
    if (this.take("{")) return this.object();
    if (this.take("[")) return this.array();
    if (this.source.charAt(this.at) === '"') return this.string();
    if (this.take("true")) return true;
    if (this.take("false")) return false;
    if (this.take("null")) return null;
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(this.source.slice(this.at));
    if (!match) throw new Error("invalid JSON value");
    this.at += match[0].length;
    return Number(match[0]);
  }
  parse(): JsonValue {
    const result = this.value();
    this.whitespace();
    if (this.at !== this.source.length) throw new Error("trailing JSON data");
    return result;
  }
}

const rec = (x: JsonValue | null): JsonObject => {
  if (!x || typeof x !== "object" || Array.isArray(x)) throw new Error("bad Thistle binary header");
  return x;
};

const list = (x: JsonValue): x is JsonValue[] => Array.isArray(x);

const num = (x: JsonValue, k: string): number => {
  if (typeof x !== "number" || !Number.isSafeInteger(x) || x < 0) throw new Error(`bad ${k} in Thistle binary`);
  return x;
};

const str = (x: JsonValue, k: string): string => {
  if (typeof x !== "string") throw new Error(`bad ${k} in Thistle binary`);
  return x;
};

const readRelocations = (x: Obj, rel: JsonValue[]): void => {
  for (const q0 of rel) {
    const q = rec(q0), type = str(q.type ?? null, "relocation type");
    if (type !== "abs8" && type !== "abs16" && type !== "abs32" && type !== "abs64" && type !== "rel32" && type !== "rel64") throw new Error("bad relocation type");
    const add = q.add ?? null;
    if (typeof add !== "number" || !Number.isSafeInteger(add)) throw new Error("bad relocation addend");
    x.rel.push({ sec: str(q.sec ?? null, "relocation section"), off: num(q.off ?? null, "relocation offset"), type, sym: str(q.sym ?? null, "relocation symbol"), add });
  }
};

const readExecutable = (x: Exe, m: JsonObject): void => {
  x.entry = num(m.entry ?? null, "entry address");
  x.mem = num(m.mem ?? null, "memory size");
  const isa = m.isa ?? "thistle";
  if (isa !== "thistle" && isa !== "rv64gc") throw new Error("bad instruction set in Thistle binary");
  if (isa === "rv64gc" && x.machine !== "thistle64") throw new Error("rv64gc needs the thistle64 ABI");
  x.isa = isa;
  x.phdr = !Object.hasOwn(m, "phdr") ? 0 : num(m.phdr ?? null, "program header address");
  x.phent = !Object.hasOwn(m, "phent") ? 0 : num(m.phent ?? null, "program header size");
  x.phnum = !Object.hasOwn(m, "phnum") ? 0 : num(m.phnum ?? null, "program header count");
};

const pack = (x: Obj | Exe): Uint8Array => {
    let at = 0;
    const ss: MSec[] = x.sec.map(s => {
      const z = { name: s.name, flg: s.flg, align: s.align, size: s.size, addr: s.addr, at, len: s.data.length };
      at += s.data.length;
      return z;
    });
    const m: Meta = {
      machine: x.machine, ver: x.ver, sec: ss, sym: x.sym, rel: x instanceof Obj ? x.rel : [],
      dbg: x.dbg, ident: x.ident, entry: x instanceof Exe ? x.entry : 0, mem: x instanceof Exe ? x.mem : 0,

    };
    const h = enc(JSON.stringify(x instanceof Exe ? { ...m, isa: x.isa, phdr: x.phdr, phent: x.phent, phnum: x.phnum } : m));
    const out = new Uint8Array(16 + h.length + at);
    out.set(magic(x));
    const v = new DataView(out.buffer);
    v.setUint32(4, h.length, true); v.setUint32(8, at, true);
    out.set(h, 16);
    at = 16 + h.length;
    for (const s of x.sec) { out.set(s.data, at); at += s.data.length; }
    v.setUint32(12, hash(out.subarray(16)), true);
    return out;
};

const unpack = (b: Uint8Array): Obj | Exe => {
    // Validate envelope lengths and checksum before trusting metadata offsets or allocating section data.
    if (b.length < 16) throw new Error("truncated Thistle binary");
    const mg = dec(b.subarray(0, 4));
    const x = mg === "THO1" ? new Obj("thistle32") : mg === "THX1" ? new Exe("thistle32") : mg === "THO2" ? new Obj("thistle64") : mg === "THX2" ? new Exe("thistle64") : null;
    if (!x) throw new Error("unknown Thistle binary magic");
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const hn = v.getUint32(4, true), pn = v.getUint32(8, true);
    if (16 + hn + pn !== b.length) throw new Error("bad Thistle binary length");
    if (v.getUint32(12, true) !== hash(b.subarray(16))) throw new Error("Thistle binary checksum mismatch");
    const m = rec(new JsonReader(dec(b.subarray(16, 16 + hn))).parse());
    if ((m.machine ?? null) !== x.machine || (m.ver ?? null) !== x.ver) throw new Error("Thistle magic, machine and version disagree");
    const sections = m.sec ?? null, symbols = m.sym ?? null, relocations = m.rel ?? null, debug = m.dbg ?? null, identities = m.ident ?? null;
    if (!list(sections) || !list(symbols) || !list(relocations) || !list(debug) || !list(identities)) throw new Error("bad Thistle binary tables");
    const sn = new Set<string>();
    for (const q0 of sections) {
      const q = rec(q0), off = num(q.at ?? null, "section offset"), len = num(q.len ?? null, "section length"), size = num(q.size ?? null, "section size");
      if (off + len > pn || len > size) throw new Error("section exceeds Thistle binary payload");
      const align = num(q.align ?? null, "section alignment");
      if (!align || (align & (align - 1))) throw new Error("section alignment is not a power of two");
      const name = str(q.name ?? null, "section name"); if (sn.has(name)) throw new Error(`duplicate section ${name}`); sn.add(name);
      x.sec.push({ name, flg: str(q.flg ?? null, "section flags"), align, size, addr: num(q.addr ?? null, "section address"), data: b.slice(16 + hn + off, 16 + hn + off + len) });
    }
    for (const q0 of symbols) {
      const q = rec(q0), bind = str(q.bind ?? null, "symbol binding"), type = str(q.type ?? null, "symbol type"), vis = str(q.vis ?? null, "symbol visibility");
      if ((bind !== "local" && bind !== "global" && bind !== "weak") || (type !== "none" && type !== "func" && type !== "object" && type !== "section") || (vis !== "default" && vis !== "hidden")) throw new Error("bad symbol attributes");
      x.sym.push({ name: str(q.name ?? null, "symbol name"), bind, type, vis, sec: str(q.sec ?? null, "symbol section"), val: num(q.val ?? null, "symbol value"), size: num(q.size ?? null, "symbol size") });
    }
    for (const q0 of debug) {
      const q = rec(q0);
      x.dbg.push({ sec: str(q.sec ?? null, "debug section"), off: num(q.off ?? null, "debug offset"), file: str(q.file ?? null, "debug file"), line: num(q.line ?? null, "debug line"), col: num(q.col ?? null, "debug column") });
    }
    for (const s of identities) x.ident.push(str(s, "ident"));
    if (x instanceof Obj) readRelocations(x, relocations);
    if (x instanceof Exe) readExecutable(x, m);
    return x;
};

export class Codec {
  readonly pack = pack;
  readonly unpack = unpack;
}

export const codec = new Codec();
const mag = (b: Uint8Array): string => b.length >= 4 ? dec(b.subarray(0, 4)) : "";
export const isObj = (b: Uint8Array): boolean => ["THO1", "THO2"].includes(mag(b));
export const isExe = (b: Uint8Array): boolean => ["THX1", "THX2"].includes(mag(b));
