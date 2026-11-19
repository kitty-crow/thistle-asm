# Linker

The linker combines THO objects, lays out their sections, resolves
symbols and applies relocations. An unresolved required symbol or a
relocation that cannot be represented is an error.

| THX data | Meaning |
| --- | --- |
| Entry | Initial instruction address |
| Sections | Merged bytes and address ranges |
| Symbols | Resolved names and addresses |
| Target | Machine and instruction profile | Linking a Thistle32 object into a
Thistle64 image, or the reverse, is rejected rather than converted
implicitly.

The linker implementation is in `link.ts` and is exported as
`./linker`.
