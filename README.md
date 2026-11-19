# ThistleASM

**ThistleASM** is the **Thistle Assembler**.

It implements the Thistle32 and Thistle64 assembly languages, the
assembler and linker, relocatable THO objects, and THX executables.
The library also provides the decoder used by tools that inspect or
load those formats.

## Assembler validation

Bun is the required host runtime. No JavaScript build is needed.

    bun install
    bun run guards
    bun run check

The current package is TypeScript and is consumed directly from
source. `bun run test` runs Code Guards in strict mode and checks TypeScript types.

## Modules

- `pre.ts` expands macros and preprocessing directives;
- `syn.ts` and `expr.ts` parse source and expressions;
- `isa.ts` and `isa64.ts` describe the instruction sets;
- `asm.ts` assembles source into objects;
- `link.ts` resolves symbols and relocations;
- `fmt.ts` and `codec.ts` encode and decode THO and THX files;
- `lib.ts` is the package entry point.

## Documentation

- [Thistle32 and Thistle64](docs/languages.md)
- [Assembler](docs/assembler.md)
- [Linker](docs/linker.md)
- [THO, THX and .39](docs/formats.md)

## Licence

MIT. See `LICENSE`.
