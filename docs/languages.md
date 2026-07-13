# Thistle32 and Thistle64

ThistleASM has one source front end and two machine descriptions.
The selected machine controls the register width, instruction table,
relocation widths and binary container version.

## Thistle32

Thistle32 is the original 32-bit language. Its relocatable objects
use `THO1` and its executables use `THX1`.

## Thistle64

Thistle64 uses 64-bit values and addresses. Its objects use `THO2`
and its executables use `THX2`.

A Thistle64 executable may select the native Thistle64 instruction
set or the `rv64gc` profile. The profile is recorded in the file
metadata; it is not inferred from the extension.
