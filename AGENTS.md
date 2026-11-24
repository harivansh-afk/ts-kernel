# AGENTS.md

- Write no comments. A line's why goes in its commit message; how the parts fit goes in `docs/design.md`.
- Bun runs it; TypeScript is pinned to 5.9 because the checker uses its JavaScript API, which 7 does not have.
- `@types/bun` is a runtime dependency: cells are checked against it.
- A change to `package.json` or `bun.lock` changes the `node_modules` hash in `package.nix`.
- Verify with `bun test`, `bun x tsc --noEmit` and `nix build`.
- Forgejo (`git.harivan.sh`) is the repo; GitHub is a mirror.
