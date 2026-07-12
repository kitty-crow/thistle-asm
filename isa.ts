export const I_SZ = 8;
export const MEM_SZ = 16 * 1024 * 1024;
export const TEXT_AT = 0x1000;

export enum Op {
  Nop, Halt, Mov, Li,
  Add, AddI, Sub, SubI, Mul, MulI, Div, DivU, Mod, ModU,
  And, AndI, Or, OrI, Xor, XorI, Not, Neg,
  Shl, ShlI, Shr, ShrI, Sar, SarI,
  Cmp, CmpI, Test,
  Jmp, Je, Jne, Jl, Jle, Jg, Jge, Jb, Jbe, Ja, Jae,
  Call, CallR, Ret, Push, Pop, Enter, Leave,
  Ld8U, Ld8S, Ld16U, Ld16S, Ld32, St8, St16, St32,
  Sys, Xchg, Sex8, Sex16,
  SetE, SetNe, SetL, SetLe, SetG, SetGe, SetB, SetBe, SetA, SetAe,
}

export type Form = "z" | "r" | "rr" | "rrr" | "ri" | "rri" | "cmp" | "cmpi" | "br" | "memr" | "memw" | "sys";

export interface Ins {
  op: Op;
  name: string;
  form: Form;
}

const def = (op: Op, name: string, form: Form): Ins => ({ op, name, form });

export const INS: readonly Ins[] = [
  def(Op.Nop, "nop", "z"), def(Op.Halt, "halt", "z"),
  def(Op.Mov, "mov", "rr"), def(Op.Li, "li", "ri"),
  def(Op.Add, "add", "rrr"), def(Op.AddI, "addi", "rri"),
  def(Op.Sub, "sub", "rrr"), def(Op.SubI, "subi", "rri"),
  def(Op.Mul, "mul", "rrr"), def(Op.MulI, "muli", "rri"),
  def(Op.Div, "div", "rrr"), def(Op.DivU, "divu", "rrr"),
  def(Op.Mod, "mod", "rrr"), def(Op.ModU, "modu", "rrr"),
  def(Op.And, "and", "rrr"), def(Op.AndI, "andi", "rri"),
  def(Op.Or, "or", "rrr"), def(Op.OrI, "ori", "rri"),
  def(Op.Xor, "xor", "rrr"), def(Op.XorI, "xori", "rri"),
  def(Op.Not, "not", "rr"), def(Op.Neg, "neg", "rr"),
  def(Op.Shl, "shl", "rrr"), def(Op.ShlI, "shli", "rri"),
  def(Op.Shr, "shr", "rrr"), def(Op.ShrI, "shri", "rri"),
  def(Op.Sar, "sar", "rrr"), def(Op.SarI, "sari", "rri"),
  def(Op.Cmp, "cmp", "cmp"), def(Op.CmpI, "cmpi", "cmpi"), def(Op.Test, "test", "cmp"),
  def(Op.Jmp, "jmp", "br"), def(Op.Je, "je", "br"), def(Op.Jne, "jne", "br"),
  def(Op.Jl, "jl", "br"), def(Op.Jle, "jle", "br"), def(Op.Jg, "jg", "br"), def(Op.Jge, "jge", "br"),
  def(Op.Jb, "jb", "br"), def(Op.Jbe, "jbe", "br"), def(Op.Ja, "ja", "br"), def(Op.Jae, "jae", "br"),
  def(Op.Call, "call", "br"), def(Op.CallR, "callr", "r"), def(Op.Ret, "ret", "z"),
  def(Op.Push, "push", "r"), def(Op.Pop, "pop", "r"), def(Op.Enter, "enter", "sys"), def(Op.Leave, "leave", "z"),
  def(Op.Ld8U, "ld8u", "memr"), def(Op.Ld8S, "ld8s", "memr"),
  def(Op.Ld16U, "ld16u", "memr"), def(Op.Ld16S, "ld16s", "memr"), def(Op.Ld32, "ld32", "memr"),
  def(Op.St8, "st8", "memw"), def(Op.St16, "st16", "memw"), def(Op.St32, "st32", "memw"),
  def(Op.Sys, "sys", "sys"), def(Op.Xchg, "xchg", "rr"), def(Op.Sex8, "sex8", "rr"), def(Op.Sex16, "sex16", "rr"),
  def(Op.SetE, "sete", "r"), def(Op.SetNe, "setne", "r"), def(Op.SetL, "setl", "r"),
  def(Op.SetLe, "setle", "r"), def(Op.SetG, "setg", "r"), def(Op.SetGe, "setge", "r"),
  def(Op.SetB, "setb", "r"), def(Op.SetBe, "setbe", "r"), def(Op.SetA, "seta", "r"), def(Op.SetAe, "setae", "r"),
];

export const BY_NAME = new Map(INS.map(x => [x.name, x]));
export const BY_OP = new Map(INS.map(x => [x.op, x]));

const alias = new Map<string, number>([["fp", 13], ["sp", 14], ["lr", 15]]);

export const reg = (s: string): number | null => {
  const k = s.trim().toLowerCase();
  const a = alias.get(k);
  if (a !== undefined) return a;
  const m = /^r(\d+)$/.exec(k);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 0 && n < 16 ? n : null;
};

export const rname = (n: number): string => n === 13 ? "fp" : n === 14 ? "sp" : n === 15 ? "lr" : `r${n}`;

export const word = (op: Op, d = 0, a = 0, b = 0, imm = 0): Uint8Array => {
  const x = new Uint8Array(I_SZ);
  x[0] = op; x[1] = d; x[2] = a; x[3] = b;
  new DataView(x.buffer).setInt32(4, imm, true);
  return x;
};

export interface DecIns {
  op: Op;
  d: number;
  a: number;
  b: number;
  imm: number;
}

export const decode = (b: Uint8Array, at: number): DecIns => {
  if (at < 0 || at + I_SZ > b.length) throw new Error("truncated thistle32 instruction");
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { op: b[at]! as Op, d: b[at + 1]!, a: b[at + 2]!, b: b[at + 3]!, imm: v.getInt32(at + 4, true) };
};

const mem = (a: number, n: number): string => `[${rname(a)}${n < 0 ? " - " : n > 0 ? " + " : ""}${n ? Math.abs(n) : ""}]`;

export const text = (x: DecIns, pc = 0): string => {
  const i = BY_OP.get(x.op);
  if (!i) return `.word 0x${x.op.toString(16).padStart(2, "0")} ; bad opcode`;
  const n = i.name, d = rname(x.d), a = rname(x.a), b = rname(x.b);
  switch (i.form) {
    case "z": return n;
    case "r": return `${n} ${d}`;
    case "rr": return `${n} ${d}, ${a}`;
    case "rrr": return `${n} ${d}, ${a}, ${b}`;
    case "ri": return `${n} ${d}, ${x.imm}`;
    case "rri": return `${n} ${d}, ${a}, ${x.imm}`;
    case "cmp": return `${n} ${a}, ${b}`;
    case "cmpi": return `${n} ${a}, ${x.imm}`;
    case "br": return `${n} 0x${(pc + I_SZ + x.imm >>> 0).toString(16)}`;
    case "memr": return `${n} ${d}, ${mem(x.a, x.imm)}`;
    case "memw": return `${n} ${mem(x.a, x.imm)}, ${d}`;
    case "sys": return `${n} ${x.imm}`;
  }
};
