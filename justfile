# deno-cgi
#
# Copyright © Gapotchenko and Contributors
#
# File introduced by: Oleksiy Gapotchenko
# Year of introduction: 2025

set windows-shell := ["gnu-tk", "-i", "-c"]

@help:
    just --list

# Start IDE using the project environment
[group("development")]
[windows]
develop:
    start "" *.code-workspace

# Start IDE using the project environment
[group("development")]
[unix]
develop:
    open *.code-workspace

# Format source code
[group("development")]
format:
    just --fmt --unstable
    deno fmt

# Format source code
[group("development")]
check:
    deno check

# Lint source code
[group("development")]
lint:
    deno lint

publish:
    deno publish
