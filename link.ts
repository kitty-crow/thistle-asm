import { MEM_SZ, TEXT_AT } from "./isa.js";
import { MEM64_SZ, TEXT64_AT } from "./isa64.js";
import { Exe, Obj } from "./fmt.js";
import type { RType, Sec, Sym } from "./fmt.js";
import { align, hex } from "./syn.js";

export interface LinkOpt {
  entry?: string;
  base?: number;
  mem?: number;
  names?: string[];
}

export interface LinkOut {
  exe: Exe;
  map: string;
}

interface Part { out: Sec; off: number; }
interface GSym { obj: Obj; sym: Sym; weak: boolean; }

export class LinkErr extends Error { constructor(msg: string) { super(msg); this.name = "LinkErr"; } }

const order = [".text", ".rodata", ".data", ".bss"];
const rank = (s: string): number => { const n = order.indexOf(s); return n < 0 ? order.length : n; };

export class Link {
  run(objs: Obj[], opt: LinkOpt = {}): LinkOut {
    if (!objs.length) throw new LinkErr("no input objects");
    const machine = objs[0]!.machine;
    if (objs.some(x => x.machine !== machine)) throw new LinkErr("cannot link thistle32 and thistle64 objects together");
    const names = objs.map((_x, i) => opt.names?.[i] ?? `obj${i}`);
    const ps = new Map<Obj, Map<string, Part>>(), out = new Map<string, Sec>(), seq: string[] = [];
    const all = [...new Set(objs.flatMap(o => o.sec.map(s => s.name)))].sort((a, b) => rank(a) - rank(b) || (rank(a) < order.length ? 0 : a.localeCompare(b)));
    for (const name of all) {
      const xs = objs.flatMap(o => o.sec.filter(s => s.name === name));
      const flg = xs[0]?.flg ?? "a";
      if (xs.some(s => s.flg !== flg)) throw new LinkErr(`section ${name} has incompatible flags`);
      const s: Sec = { name, flg, align: Math.max(...xs.map(x => x.align)), data: new Uint8Array(), size: 0, addr: 0 };
      out.set(name, s); seq.push(name);
    }
    for (const o of objs) {
      const m = new Map<string, Part>(); ps.set(o, m);
      for (const s of o.sec) {
        const z = out.get(s.name)!; z.size = align(z.size, s.align); m.set(s.name, { out: z, off: z.size }); z.size += s.size;
      }
    }
    for (const z of out.values()) {
      const has = objs.some(o => o.sec.some(s => s.name === z.name && s.data.length));
      z.data = has ? new Uint8Array(z.size) : new Uint8Array();
    }
    for (const o of objs) for (const s of o.sec) {
      const p = ps.get(o)!.get(s.name)!;
      if (s.data.length) p.out.data.set(s.data, p.off);
    }
    const textAt = machine === "thistle64" ? TEXT64_AT : TEXT_AT;
    let pc = opt.base ?? textAt;
    if (!Number.isSafeInteger(pc) || pc < textAt || pc > Number.MAX_SAFE_INTEGER / 2) throw new LinkErr(`image base must be at least 0x${hex(textAt)} and a safe host integer`);
    for (const name of seq) { const s = out.get(name)!; pc = align(pc, Math.max(0x1000, s.align)); s.addr = pc; pc += s.size; }
    const mem = opt.mem ?? (machine === "thistle64" ? MEM64_SZ : MEM_SZ);
    const max = machine === "thistle64" ? Number.MAX_SAFE_INTEGER : 256 * 1024 * 1024;
    if (!Number.isSafeInteger(mem) || mem < 1024 * 1024 || mem > max || pc + 65536 >= mem) throw new LinkErr("linked image does not fit executable memory");

    const gs = this.globals(objs, names), addr = (o: Obj, s: Sym): number => {
      if (s.sec === "ABS") return s.val;
      const p = ps.get(o)!.get(s.sec); if (!p) throw new LinkErr(`${names[objs.indexOf(o)]}: symbol ${s.name} names missing section ${s.sec}`);
      if (s.val > o.sec.find(x => x.name === s.sec)!.size) throw new LinkErr(`${s.name} lies outside section ${s.sec}`);
      return p.out.addr + p.off + s.val;
    };
    const find = (o: Obj, name: string): [number, Sym | null] => {
      const l = o.sym.find(s => s.name === name && s.sec);
      if (l) return [addr(o, l), l];
      const g = gs.get(name);
      if (g) return [addr(g.obj, g.sym), g.sym];
      const w = o.sym.find(s => s.name === name && s.bind === "weak");
      if (w) return [0, w];
      throw new LinkErr(`undefined symbol ${name}`);
    };
    for (const o of objs) for (const r of o.rel) {
      const p = ps.get(o)!.get(r.sec); if (!p) throw new LinkErr(`relocation names missing section ${r.sec}`);
      if (!p.out.data.length) throw new LinkErr(`relocation in nobits section ${r.sec}`);
      const src = o.sec.find(s => s.name === r.sec)!;
      const z = r.type === "abs8" ? 1 : r.type === "abs16" ? 2 : r.type === "abs64" || r.type === "rel64" ? 8 : 4;
      if (r.off + z > src.data.length) throw new LinkErr(`relocation exceeds section ${r.sec}`);
      const [sa] = find(o, r.sym), place = p.out.addr + p.off + r.off;
      const v = BigInt(sa) + BigInt(r.add) - (r.type === "rel32" ? BigInt(place + 4) : r.type === "rel64" ? BigInt(place + 8) : 0n);
      this.put(p.out.data, p.off + r.off, r.type, v, r.sym);
    }

    const ent = opt.entry ?? "_start";
    let ep: number;
    const eg = gs.get(ent);
    if (eg) ep = addr(eg.obj, eg.sym);
    else {
      const q = objs.flatMap(o => o.sym.filter(s => s.name === ent && s.sec).map(s => [o, s] as const));
      if (q.length !== 1) throw new LinkErr(`entry symbol ${ent} is ${q.length ? "ambiguous" : "undefined"}`);
      ep = addr(q[0]![0], q[0]![1]);
    }
    const text = [...out.values()].find(s => ep >= s.addr && ep < s.addr + s.size);
    if (!text?.flg.includes("x")) throw new LinkErr(`entry ${ent} is not in an executable section`);

    const exe = new Exe(machine); exe.entry = ep; exe.mem = mem; exe.sec.push(...seq.map(x => out.get(x)!));
    for (let oi = 0; oi < objs.length; oi++) {
      const o = objs[oi]!;
      for (const s of o.sym) if (s.sec) {
        const val = addr(o, s);
        exe.sym.push({ ...s, val });
      }
      for (const d of o.dbg) {
        const p = ps.get(o)!.get(d.sec); if (p) exe.dbg.push({ ...d, off: p.off + d.off });
      }
      exe.ident.push(...o.ident.map(x => `${names[oi]}: ${x}`));
    }
    const rows = ["Thistle link map", `entry ${ent} 0x${hex(ep)}`, `memory 0x${hex(mem)}`, "", "Sections:"];
    for (const s of exe.sec) rows.push(`0x${hex(s.addr)} 0x${hex(s.size)} ${s.flg.padEnd(3)} ${s.name}`);
    rows.push("", "Global symbols:");
    for (const [name, q] of [...gs].sort(([a], [b]) => a.localeCompare(b))) rows.push(`0x${hex(addr(q.obj, q.sym))} ${q.weak ? "W" : "G"} ${name}`);
    return { exe, map: rows.join("\n") + "\n" };
  }

  private globals(objs: Obj[], names: string[]): Map<string, GSym> {
    const out = new Map<string, GSym>();
    for (let oi = 0; oi < objs.length; oi++) for (const s of objs[oi]!.sym) {
      if (!s.sec || s.bind === "local") continue;
      const old = out.get(s.name), weak = s.bind === "weak";
      if (!old || old.weak && !weak) out.set(s.name, { obj: objs[oi]!, sym: s, weak });
      else if (!weak && !old.weak) throw new LinkErr(`multiple definition of ${s.name} (${names[objs.indexOf(old.obj)]} and ${names[oi]})`);
    }
    return out;
  }

  private put(b: Uint8Array, at: number, t: RType, n: bigint, name: string): void {
    const z = t === "abs8" ? 1 : t === "abs16" ? 2 : t === "abs64" || t === "rel64" ? 8 : 4;
    const rel = t === "rel32" || t === "rel64";
    const lo = rel ? -(1n << BigInt(z * 8 - 1)) : -(1n << BigInt(z * 8 - 1)), hi = rel ? (1n << BigInt(z * 8 - 1)) - 1n : (1n << BigInt(z * 8)) - 1n;
    if (n < lo || n > hi) throw new LinkErr(`${t} relocation for ${name} is out of range`);
    const x = BigInt.asUintN(z * 8, n);
    for (let i = 0; i < z; i++) b[at + i] = Number(x >> BigInt(i * 8) & 255n);
  }
}
