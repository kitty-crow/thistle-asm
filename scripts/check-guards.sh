#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
work=$(mktemp -d "${TMPDIR:-/tmp}/thistle-asm-guards.XXXXXXXX")
trap 'rm -rf -- "$work"' EXIT
# Dependencies run their own strict checks.
tar -C "$root" --exclude='./kittyx' --exclude='./.git' --exclude='./node_modules' --exclude='./dist' --exclude='./build' -cf - . | tar -C "$work" -xf -
ln -s "$root/node_modules" "$work/node_modules"
bun "$root/node_modules/@kitty-crow/code-guards/src/cli.ts" all --strict --include-tests --project "$work/tsconfig.json"
