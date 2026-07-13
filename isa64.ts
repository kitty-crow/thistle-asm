export const I64_SZ = 16;
export const MEM64_SZ = 1024 * 1024 * 1024 * 1024;
export const TEXT64_AT = 0x10000;

export enum Op64 {
  Nop, Halt, Mov, Li,
  Add, AddI, Sub, SubI, Mul, MulI, Div, DivU, Mod, ModU,
  And, AndI, Or, OrI, Xor, XorI, Not, Neg,
  Shl, ShlI, Shr, ShrI, Sar, SarI,
  Cmp, CmpI, Test,
  Jmp, JmpR, Je, Jne, Jl, Jle, Jg, Jge, Jb, Jbe, Ja, Jae,
  Call, CallR, Ret, Push, Pop, Enter, Leave,
  Ld8U, Ld8S, Ld16U, Ld16S, Ld32U, Ld32S, Ld64,
  St8, St16, St32, St64,
  Sys, Xchg, Sex8, Sex16, Sex32,
  SetE, SetNe, SetL, SetLe, SetG, SetGe, SetB, SetBe, SetA, SetAe,
  Clz, Ctz, Popcnt,
  FMov, FLi, FAdd, FSub, FMul, FDiv, FNeg, FAbs, FSqrt, FCmp,
  FSetE, FSetNe, FSetL, FSetLe, FSetG, FSetGe,
  IToF, UToF, FToI, FToU,
  FLd32, FLd64, FSt32, FSt64,
}

export type Form64 = "z" | "x" | "xx" | "xxx" | "xi" | "xxi" | "cmp" | "cmpi" | "br" | "memx" | "memw" | "sys" | "f" | "ff" | "fff" | "fi" | "fcmp" | "xf" | "fx" | "xff" | "fmemr" | "fmemw";

export interface Ins64 {
  op: Op64;
  name: string;
  form: Form64;
}

const def = (op: Op64, name: string, form: Form64): Ins64 => ({ op, name, form });

export const INS64: readonly Ins64[] = [
  def(Op64.Nop, "nop", "z"), def(Op64.Halt, "halt", "z"),
  def(Op64.Mov, "mov", "xx"), def(Op64.Li, "li", "xi"),
  def(Op64.Add, "add", "xxx"), def(Op64.AddI, "addi", "xxi"),
  def(Op64.Sub, "sub", "xxx"), def(Op64.SubI, "subi", "xxi"),
  def(Op64.Mul, "mul", "xxx"), def(Op64.MulI, "muli", "xxi"),
  def(Op64.Div, "div", "xxx"), def(Op64.DivU, "divu", "xxx"),
  def(Op64.Mod, "mod", "xxx"), def(Op64.ModU, "modu", "xxx"),
  def(Op64.And, "and", "xxx"), def(Op64.AndI, "andi", "xxi"),
  def(Op64.Or, "or", "xxx"), def(Op64.OrI, "ori", "xxi"),
  def(Op64.Xor, "xor", "xxx"), def(Op64.XorI, "xori", "xxi"),
  def(Op64.Not, "not", "xx"), def(Op64.Neg, "neg", "xx"),
  def(Op64.Shl, "shl", "xxx"), def(Op64.ShlI, "shli", "xxi"),
  def(Op64.Shr, "shr", "xxx"), def(Op64.ShrI, "shri", "xxi"),
  def(Op64.Sar, "sar", "xxx"), def(Op64.SarI, "sari", "xxi"),
  def(Op64.Cmp, "cmp", "cmp"), def(Op64.CmpI, "cmpi", "cmpi"), def(Op64.Test, "test", "cmp"),
  def(Op64.Jmp, "jmp", "br"), def(Op64.JmpR, "jmpr", "x"), def(Op64.Je, "je", "br"), def(Op64.Jne, "jne", "br"),
  def(Op64.Jl, "jl", "br"), def(Op64.Jle, "jle", "br"), def(Op64.Jg, "jg", "br"), def(Op64.Jge, "jge", "br"),
  def(Op64.Jb, "jb", "br"), def(Op64.Jbe, "jbe", "br"), def(Op64.Ja, "ja", "br"), def(Op64.Jae, "jae", "br"),
  def(Op64.Call, "call", "br"), def(Op64.CallR, "callr", "x"), def(Op64.Ret, "ret", "z"),
  def(Op64.Push, "push", "x"), def(Op64.Pop, "pop", "x"), def(Op64.Enter, "enter", "sys"), def(Op64.Leave, "leave", "z"),
  def(Op64.Ld8U, "ld8u", "memx"), def(Op64.Ld8S, "ld8s", "memx"),
  def(Op64.Ld16U, "ld16u", "memx"), def(Op64.Ld16S, "ld16s", "memx"),
  def(Op64.Ld32U, "ld32u", "memx"), def(Op64.Ld32S, "ld32s", "memx"), def(Op64.Ld64, "ld64", "memx"),
  def(Op64.St8, "st8", "memw"), def(Op64.St16, "st16", "memw"), def(Op64.St32, "st32", "memw"), def(Op64.St64, "st64", "memw"),
  def(Op64.Sys, "sys", "sys"), def(Op64.Xchg, "xchg", "xx"),
  def(Op64.Sex8, "sex8", "xx"), def(Op64.Sex16, "sex16", "xx"), def(Op64.Sex32, "sex32", "xx"),
  def(Op64.SetE, "sete", "x"), def(Op64.SetNe, "setne", "x"), def(Op64.SetL, "setl", "x"),
  def(Op64.SetLe, "setle", "x"), def(Op64.SetG, "setg", "x"), def(Op64.SetGe, "setge", "x"),
  def(Op64.SetB, "setb", "x"), def(Op64.SetBe, "setbe", "x"), def(Op64.SetA, "seta", "x"), def(Op64.SetAe, "setae", "x"),
  def(Op64.Clz, "clz", "xx"), def(Op64.Ctz, "ctz", "xx"), def(Op64.Popcnt, "popcnt", "xx"),
  def(Op64.FMov, "fmov", "ff"), def(Op64.FLi, "fli", "fi"),
  def(Op64.FAdd, "fadd", "fff"), def(Op64.FSub, "fsub", "fff"), def(Op64.FMul, "fmul", "fff"), def(Op64.FDiv, "fdiv", "fff"),
  def(Op64.FNeg, "fneg", "ff"), def(Op64.FAbs, "fabs", "ff"), def(Op64.FSqrt, "fsqrt", "ff"), def(Op64.FCmp, "fcmp", "fcmp"),
  def(Op64.FSetE, "fsete", "xff"), def(Op64.FSetNe, "fsetne", "xff"), def(Op64.FSetL, "fsetl", "xff"),
  def(Op64.FSetLe, "fsetle", "xff"), def(Op64.FSetG, "fsetg", "xff"), def(Op64.FSetGe, "fsetge", "xff"),
  def(Op64.IToF, "itof", "fx"), def(Op64.UToF, "utof", "fx"), def(Op64.FToI, "ftoi", "xf"), def(Op64.FToU, "ftou", "xf"),
  def(Op64.FLd32, "fld32", "fmemr"), def(Op64.FLd64, "fld64", "fmemr"), def(Op64.FSt32, "fst32", "fmemw"), def(Op64.FSt64, "fst64", "fmemw"),
];

export const BY64_NAME = new Map(INS64.map(x => [x.name, x]));
export const BY64_OP = new Map(INS64.map(x => [x.op, x]));

const xa = new Map<string, number>([["fp", 29], ["sp", 30], ["lr", 31]]);

export const xreg = (s: string): number | null => {
  const k = s.trim().toLowerCase(), a = xa.get(k);
  if (a !== undefined) return a;
  const m = /^[xr](\d+)$/.exec(k);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 0 && n < 32 ? n : null;
};

export const freg = (s: string): number | null => {
  const m = /^f(\d+)$/.exec(s.trim().toLowerCase());
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 0 && n < 16 ? n : null;
};

export const xname = (n: number): string => n === 29 ? "fp" : n === 30 ? "sp" : n === 31 ? "lr" : `x${n}`;
export const fname = (n: number): string => `f${n}`;

export const word64 = (op: Op64, d = 0, a = 0, b = 0, imm = 0n): Uint8Array => {
  const x = new Uint8Array(I64_SZ);
  x[0] = op; x[1] = d; x[2] = a; x[3] = b;
  new DataView(x.buffer).setBigInt64(8, BigInt.asIntN(64, imm), true);
  return x;
};

export const fword64 = (op: Op64, d: number, n: number): Uint8Array => {
  const x = word64(op, d);
  new DataView(x.buffer).setFloat64(8, n, true);
  return x;
};

export interface Dec64 {
  op: Op64;
  d: number;
  a: number;
  b: number;
  imm: bigint;
  fimm: number;
}

export const decode64 = (b: Uint8Array, at: number): Dec64 => {
  if (at < 0 || at + I64_SZ > b.length) throw new Error("truncated thistle64 instruction");
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { op: b[at]! as Op64, d: b[at + 1]!, a: b[at + 2]!, b: b[at + 3]!, imm: v.getBigInt64(at + 8, true), fimm: v.getFloat64(at + 8, true) };
};

const mem = (a: number, n: bigint): string => `[${xname(a)}${n < 0n ? " - " : n > 0n ? " + " : ""}${n ? (n < 0n ? -n : n) : ""}]`;
const hx = (n: bigint): string => `0x${BigInt.asUintN(64, n).toString(16)}`;

export const text64 = (x: Dec64, pc = 0n): string => {
  const i = BY64_OP.get(x.op);
  if (!i) return `.byte 0x${x.op.toString(16).padStart(2, "0")} ; bad opcode`;
  const n = i.name, d = xname(x.d), a = xname(x.a), b = xname(x.b), fd = fname(x.d), fa = fname(x.a), fb = fname(x.b);
  switch (i.form) {
    case "z": return n;
    case "x": return `${n} ${d}`;
    case "xx": return `${n} ${d}, ${a}`;
    case "xxx": return `${n} ${d}, ${a}, ${b}`;
    case "xi": return `${n} ${d}, ${x.imm}`;
    case "xxi": return `${n} ${d}, ${a}, ${x.imm}`;
    case "cmp": return `${n} ${a}, ${b}`;
    case "cmpi": return `${n} ${a}, ${x.imm}`;
    case "br": return `${n} ${hx(pc + BigInt(I64_SZ) + x.imm)}`;
    case "memx": return `${n} ${d}, ${mem(x.a, x.imm)}`;
    case "memw": return `${n} ${mem(x.a, x.imm)}, ${d}`;
    case "sys": return `${n} ${x.imm}`;
    case "f": return `${n} ${fd}`;
    case "ff": return `${n} ${fd}, ${fa}`;
    case "fff": return `${n} ${fd}, ${fa}, ${fb}`;
    case "fi": return `${n} ${fd}, ${x.fimm}`;
    case "fcmp": return `${n} ${fa}, ${fb}`;
    case "xf": return `${n} ${d}, ${fa}`;
    case "fx": return `${n} ${fd}, ${a}`;
    case "xff": return `${n} ${d}, ${fa}, ${fb}`;
    case "fmemr": return `${n} ${fd}, ${mem(x.a, x.imm)}`;
    case "fmemw": return `${n} ${mem(x.a, x.imm)}, ${fd}`;
  }
};
