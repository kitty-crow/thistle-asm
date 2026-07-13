# Assembler

Assembly starts in `asm.ts`. Source is preprocessed, parsed and
matched against the selected instruction table. Expressions may
refer to constants and symbols; unresolved values become relocation
records in the object file.

The assembler reports source locations with syntax and expression
errors. It does not silently choose a different machine when an
instruction is unavailable. Select the intended machine before
assembling the source.

Library users import the assembler from `./assembler` or from the
main package entry point.
