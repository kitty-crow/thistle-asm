# THO, THX and .39

THO is the relocatable object format produced by the assembler. THX
is the executable format produced by the linker.

Version 1 containers identify Thistle32 files. Version 2 containers
identify Thistle64 files. The metadata carries the machine,
instruction profile, sections, symbols, relocations and entry point
required by the relevant stage.

`.thx` and `.39` are exact aliases. Renaming one extension to the
other does not alter the file and requires no conversion.
