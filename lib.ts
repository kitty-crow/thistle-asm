import type { Inc } from "./pre.js";

export const SYS_TAS = `.arch thistle64
.code64
.equ SYS_exit, 0
.equ SYS_read, 1
.equ SYS_write, 2
.equ SYS_open, 3
.equ SYS_close, 4
.equ SYS_seek, 5
.equ SYS_unlink, 6
.equ SYS_mkdir, 7
.equ SYS_getpid, 8
.equ SYS_getppid, 9
.equ SYS_brk, 10
.equ SYS_clock, 11
.equ SYS_yield, 12
.equ SYS_stat, 13
.equ SYS_getcwd, 14
.equ SYS_chdir, 15
.equ SYS_rmdir, 16
.equ SYS_rename, 17
.equ SYS_chmod, 18
.equ SYS_random, 19
.equ SYS_spawn, 20
.equ SYS_wait, 21
.equ SYS_kill, 22
.equ SYS_sleep, 23
.equ SYS_getuid, 24
.equ SYS_getgid, 25
.equ SYS_dup, 26
.equ SYS_link, 27
.equ SYS_symlink, 28
.equ SYS_readlink, 29
.equ SYS_truncate, 30

.equ O_RDONLY, 0
.equ O_WRONLY, 1
.equ O_RDWR, 2
.equ O_CREAT, 0x40
.equ O_EXCL, 0x80
.equ O_TRUNC, 0x200
.equ O_APPEND, 0x400

.macro exit code
  li r0, \\code
  sys SYS_exit
.endm

.macro write fd, ptr, len
  li r0, \\fd
  la r1, \\ptr
  li r2, \\len
  sys SYS_write
.endm
`;

export const SYS32_TAS = SYS_TAS.replace(".arch thistle64\n.code64\n", ".arch thistle32\n.code32\n");

export const CRT0_TAS = `.arch thistle64
.code64
.include "/usr/include/thistle/sys.tas"
.text
.global _start
.extern main
.type _start, @function
_start:
  call main
  sys SYS_exit
.size _start, . - _start
`;

export const CRT032_TAS = CRT0_TAS.replace(".arch thistle64\n.code64\n.include \"/usr/include/thistle/sys.tas\"", ".arch thistle32\n.code32\n.include \"/usr/include/thistle32/sys.tas\"");

export const HELLO_TAS = `.arch thistle64
.code64
.include "/usr/include/thistle/sys.tas"
.file 1 "hello.tas"
.section .rodata
msg:
  .ascii "Hello from native Thistle assembly!\\n"
.equ msg_len, . - msg

.text
.global _start
.type _start, @function
_start:
  write 1, msg, msg_len
  exit 0
.size _start, . - _start
`;

export const HELLO32_TAS = HELLO_TAS
  .replace(".arch thistle64\n.code64\n.include \"/usr/include/thistle/sys.tas\"", ".arch thistle32\n.code32\n.include \"/usr/include/thistle32/sys.tas\"")
  .replace("native Thistle assembly", "Thistle 1 compatibility assembly");

export const FIB_TAS = `.arch thistle64
.code64
.include "/usr/include/thistle/sys.tas"
.section .rodata
digits: .asciz "0123456789"
nl: .byte 10

.text
.global _start
_start:
  li r0, 5
  call fib
  addi r1, r0, 48
  push r1
  li r0, 1
  mov r1, sp
  li r2, 1
  sys SYS_write
  addi sp, sp, 8
  write 1, nl, 1
  exit 0

.type fib, @function
fib:
  enter 8
  st32 [fp - 4], r0
  cmpi r0, 1
  jle .base
  subi r0, r0, 1
  call fib
  st32 [fp - 8], r0
  ld32 r0, [fp - 4]
  subi r0, r0, 2
  call fib
  ld32 r1, [fp - 8]
  add r0, r0, r1
.base:
  leave
  ret
`;

const src = new Map<string, string>([
  ["/usr/include/thistle/sys.tas", SYS_TAS], ["/usr/include/thistle32/sys.tas", SYS32_TAS],
  ["/usr/lib/thistle/crt0.tas", CRT0_TAS], ["/usr/lib/thistle32/crt0.tas", CRT032_TAS],
  ["/usr/share/thistle/examples/hello.tas", HELLO_TAS], ["/usr/share/thistle/examples/hello32.tas", HELLO32_TAS], ["/usr/share/thistle/examples/fib.tas", FIB_TAS],
]);

export const libInc = (name: string): Inc => {
  const s = src.get(name); if (s === undefined) throw new Error(`include not found: ${name}`); return { src: s, file: name };
};
