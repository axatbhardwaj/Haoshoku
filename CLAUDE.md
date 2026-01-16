# Haoshoku

Multi-distro Linux setup and configuration toolkit (JavaScript/Bun).

## Files

| File            | What                              | When to read                                    |
| --------------- | --------------------------------- | ----------------------------------------------- |
| `haoshoku.js`   | CLI entry point, OS detection     | Modifying CLI args, adding new OS targets       |
| `package.json`  | Dependencies and npm scripts      | Adding deps, updating scripts                   |
| `README.md`     | User documentation, feature list  | Understanding features, installation options    |
| `CHANGELOG.md`  | Version history                   | Checking release notes                          |
| `.gitmodules`   | Git submodule definitions         | Working with claude-config submodule            |
| `info.txt`      | Theme names and resource links    | Reference for KDE theme components              |
| `bun.lock`      | Dependency lockfile (Bun)         | Checking exact dependency versions              |

## Subdirectories

| Directory  | What                              | When to read                                    |
| ---------- | --------------------------------- | ----------------------------------------------- |
| `src/`     | Core source code                  | Modifying setup logic, adding features          |
| `configs/` | Template configs for deployment   | Adding/modifying terminal or app configs        |
| `common/`  | Package lists for OS setup        | Adding/removing packages to install             |
| `tests/`   | Test suite                        | Writing tests, debugging test failures          |
| `scripts/` | Build and release scripts         | Modifying release process                       |
| `docs/`    | Additional documentation          | Understanding project details                   |
| `deskback/`| Wallpaper assets                  | Adding wallpapers                               |
| `icons/`   | Icon assets                       | Adding icons                                    |

## Install

```bash
# Option 1: Run with Bun (Recommended)
bun install
bun haoshoku.js

# Option 2: Install via npm
npm install -g haoshoku
haoshoku
```

## Test

```bash
bun test
```

## Lint

```bash
bun run lint
bun run format
```