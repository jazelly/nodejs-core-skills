---
name: nodejs-core-skills
description: Used when working with Node.js Core Runtime. Covers environment setup (macOS/Linux/Windows), building with Ninja, running parallel/sequential tests, writing JS and C++ tests, commit message formatting, and Node.js internal JS coding conventions (primordials, null-prototype objects, performance patterns). Use when working on Node.js core patches, writing tests for Node.js, preparing commits for nodejs/node, or reviewing Node.js coding patterns.
---

## Project structure

- `src/` — C++ source code
- `lib/` — JavaScript core modules (public API + `lib/internal/`)
- `deps/` — bundled dependencies (V8, libuv, OpenSSL, llhttp, etc.)
- `test/` — test suites (parallel, sequential, cctest, etc.)
- `tools/` — utility scripts including `test.py`
- `doc/` — documentation and contributing guides
- `benchmark/` — performance benchmarks

## 1. Environment setup

### Prerequisites (all platforms)

- **Python**: a supported version (check `BUILDING.md` for current requirements)
- **Ninja** (recommended): speeds up incremental builds significantly

Check if ninja exists:

```bash
ninja --version  # or ninja-build --version on some distros
```

For Ninja usage details, install the dedicated skill:

```bash
npx skills add https://github.com/mohitmishra786/low-level-dev-skills --skill ninja
```

### macOS

```bash
xcode-select --install          # installs clang, clang++, make
brew install ccache ninja        # optional but recommended
export CC="ccache cc"
export CXX="ccache c++"
```

Xcode >= 16.4 required.

### Linux (Debian/Ubuntu)

```bash
sudo apt-get install python3 g++ gcc make python3-pip ccache ninja-build
export CC="ccache gcc"
export CXX="ccache g++"
# Optional: install mold for faster linking
# export LDFLAGS="-fuse-ld=mold"
```

GCC >= 13.2 or Clang >= 19.1 required.

### Windows

1. Install Python (current version)
2. Install Visual Studio 2022/2026 with "Desktop development with C++" workload
3. Install ClangCL optional components (required since Node.js 24):
   - C++ Clang Compiler for Windows
   - MSBuild support for LLVM (clang-cl) toolset
4. Install [NASM](https://www.nasm.us/) for OpenSSL asm modules
5. Git for Windows (includes Bash and Unix tools)

Automated alternative: use WinGet DSC files in `.configurations/`.

For IDE/LSP and debugging setup, see [Section 6: Advanced Development Tips](#6-advanced-development-tips).

## 2. Building

### Unix / macOS (with Ninja — recommended)

```bash
./configure --ninja
make -j4
```

`make` invokes `ninja -C out/Release` internally. The built binary lands at `out/Release/node` and is symlinked as `./node` at project root.

**JS-only changes** — skip recompiling C++:

```bash
./configure --ninja --node-builtin-modules-path "$(pwd)"
```

**Debug build:**

```bash
./configure --ninja --debug && make
# produces out/Debug/node in addition to out/Release/node
```

### Controlling parallelism

- `-j<N>` controls parallel jobs: `make -j4`
- **macOS caveat**: GNU Make 3.x (shipped with macOS) does not support `-jN`. Either:
  - Upgrade: `brew install make` (use `gmake`) — Make 4.x
  - Use: `make JOBS=4`

On some RHEL systems, ninja may be named `ninja-build`:

```bash
NINJA="ninja-build" make
```

### Windows

```powershell
.\vcbuild           # build
.\vcbuild test       # build + test
```

**Tip**: if you hit zlib link errors, disable vcpkg integration: `vcpkg integrate remove`.

### Troubleshooting

- `make distclean` for stale build artifacts (requires re-running `./configure`)
- Memory: at least 8GB RAM with 4 parallel jobs. Reduce `-j` if OOM.
- Build path must not contain spaces or non-ASCII characters.

## 3. Testing

### Philosophy

Almost every change requires a test. For bug fixes: **write a test that reproduces the bug and fails on main first**, then fix the code to make it pass.

### Test organization

| Directory | Behavior |
|-----------|----------|
| `test/parallel/` | Tests run concurrently across workers |
| `test/sequential/` | Tests run one at a time (port conflicts, global state) |
| `test/cctest/` | C++ unit tests (Google Test) |
| `test/message/` | Tests checking stderr/stdout output |
| `test/pseudo-tty/` | Tests requiring a pseudo-terminal |
| `test/pummel/` | Stress / long-running tests |
| `test/internet/` | Tests requiring internet access |

When in doubt, add new tests to `test/parallel/`.

### Running tests

**Method 1: tools/test.py** (the test runner)

```bash
# Run a single test
tools/test.py test/parallel/test-stream2-transform.js

# Run a subsystem
tools/test.py child-process

# Run a test suite directory
tools/test.py test/message

# Wildcard patterns
tools/test.py "test/parallel/test-stream-*"
tools/test.py "test/*/test-inspector-*"

# Control parallelism
tools/test.py -j8 test/parallel/

# Windows: use python3 explicitly
python3 tools/test.py test/parallel/test-stream2-transform.js
```

**Method 2: Run directly with built node**

```bash
./node test/parallel/test-stream2-transform.js
# or for debug build:
out/Debug/node test/parallel/test-stream2-transform.js
```

**Full test suite:**

```bash
make -j4 test         # includes lint
make test-only        # tests without lint
```

### Writing JS tests

```js
'use strict';
const common = require('../common');
const assert = require('node:assert');

// Brief description of what this test checks.

// Use common.mustCall() to assert callbacks fire
// Use common.mustNotCall() to assert callbacks don't fire
// Use port 0 for dynamic port assignment (parallel-safe)
// Tests pass by exiting with code 0
// Tests fail by throwing or setting process.exitCode != 0
```

Key helpers in `test/common/`:
- `common.mustCall(fn, expectedCalls)` — assert callback invocation count
- `common.mustNotCall()` — fail if called
- `common.platformTimeout(ms)` — platform-aware timeouts
- `common.skip(msg)` — skip test with reason
- `require('../common/fixtures')` — access test fixture files

### C++ unit tests (Google Test)

Located in `test/cctest/`. Uses Google Test framework.

```cpp
#include "gtest/gtest.h"
#include "node.h"         // or specific headers

TEST(MySuite, MyTest) {
  EXPECT_EQ(1 + 1, 2);
  ASSERT_TRUE(condition);
}
```

For tests needing a Node.js environment, use `NodeTestFixture` from `test/cctest/node_test_fixture.h`:

```cpp
#include "node_test_fixture.h"

class MyTest : public NodeTestFixture {};

TEST_F(MyTest, SomeTest) {
  // Has access to isolate, event loop, etc.
}
```

Build and run C++ tests:

```bash
make cctest         # build + run all C++ tests
out/Release/cctest  # run directly
```

### Linting

```bash
make lint           # JS + C++ + Markdown
make lint-js-fix    # auto-fix JS lint errors
```

## 4. Commit guidelines

Node.js commits are **rebase-only** (no merge commits).

### Format

```
subsystem: imperative lowercase description

Optional body wrapped at 72 columns.

Fixes: https://github.com/nodejs/node/issues/NNNN
Refs: https://github.com/nodejs/node/pull/NNNN
Signed-off-by: Your Name <your@email.com>
```

### Rules

1. **First line**: max 72 chars (prefer ~50), **entirely lowercase** except proper nouns/code identifiers
2. **Prefix** with subsystem name + imperative verb: `net: add localAddress to Socket`
3. Find subsystem via: `git log --oneline files/you/changed`
4. **Second line blank**
5. Body wrapped at 72 columns
6. `Fixes:` / `Refs:` with **full URLs** (not just issue numbers)
7. `Signed-off-by:` required (DCO)
8. For `semver-major`: explain the breaking change, trigger, and exact change

### Examples

```
stream: fix backpressure handling in writable

The previous implementation did not properly pause the source
when the writable's internal buffer exceeded highWaterMark.

Fixes: https://github.com/nodejs/node/issues/12345
Signed-off-by: J. Random User <j.random.user@example.com>
```

### Common subsystems

`assert`, `buffer`, `child_process`, `crypto`, `dgram`, `dns`, `doc`, `errors`, `esm`, `events`, `fs`, `http`, `http2`, `https`, `inspector`, `lib`, `module`, `net`, `os`, `path`, `perf_hooks`, `process`, `readline`, `repl`, `src`, `stream`, `test`, `test_runner`, `timers`, `tls`, `tools`, `url`, `util`, `v8`, `vm`, `wasi`, `worker`, `zlib`

Full list: [core-validate-commit subsystem rules](https://github.com/nodejs/core-validate-commit/blob/main/lib/rules/subsystem.js)

## 5. Coding conventions

### Null-prototype objects

Objects used as dictionaries or property descriptors strip the prototype chain to prevent prototype pollution:

```js
const obj = { __proto__: null, key: 'value' };

ObjectDefineProperty(target, 'prop', {
  __proto__: null,
  enumerable: true,
  value: fn,
});

const kEmptyObject = ObjectFreeze({ __proto__: null });
```

`{ __proto__: null }` is preferred over `Object.create(null)` throughout the codebase. Exception: on extremely hot allocation paths, `__proto__: null` may be omitted if benchmarks show measurable overhead.

### Primordials

Node.js captures built-in functions at bootstrap to protect against user-land prototype pollution. Core modules destructure from the global `primordials` binding:

```js
const {
  ArrayPrototypePush,
  StringPrototypeSlice,
  ObjectDefineProperty,
  SafeMap,
  RegExpPrototypeExec,
} = primordials;
```

**Why**: if user code mutates `Array.prototype.push`, code using `ArrayPrototypePush` from primordials still calls the original. The safe versions are captured in `lib/internal/per_context/primordials.js` before any user code runs.

**When writing core code**: always use primordials for built-in methods in `lib/internal/` modules. Do NOT call `Array.prototype.push()` directly — use `ArrayPrototypePush(arr, item)`.

Primordials can impact performance. Benchmark changes in hot paths. See: https://github.com/nodejs/node/pull/38248

### Performance patterns

Common patterns in performance-sensitive Node.js core code:

- **Fast path / slow path branching**: check the common case first, branch to slow path for edge cases
- **`for` loops over iterators**: explicit `for(;;)` or `for...` loops in hot paths instead of `forEach`/`map`
- **Bitwise state flags**: use `state[kState] |= kFlag` / `(state[kState] & kFlag) !== 0` instead of boolean properties
- **Avoid unnecessary Promises**: in hot async paths, manually construct Promises instead of using `async` functions to save 2 extra Promise allocations
- **Power-of-two arithmetic**: use bit manipulation (`n |= n >>> 1; ...`) for next-power-of-two calculations
- **Retain `for(;;)` in hot paths**: even where higher-level constructs exist, `for(;;)` loops are intentionally kept for performance — see comments in `_http_outgoing.js`

## 6. Advanced development tips

### C++ LSP setup with clangd

The default C/C++ extension does not work well for Node.js on macOS. Use **clangd** instead.

**Step 1**: Generate `compile_commands.json` (the `-C` flag):

```bash
# macOS / Linux
./configure --node-builtin-modules-path "$(pwd)" --ninja -C

# Windows (PowerShell)
python configure.py -C
```

**Step 2**: Install the clangd VSCode extension (clangd >= 16) and configure:

```json
"clangd.arguments": [
    "--compile-commands-dir=.",
    "--background-index",
    "--completion-style=detailed"
]
```

Reload the window to let clangd index. For debug builds, use `./configure --debug -C` instead.

Alternatively, if using the **cpptools** extension, add to `.vscode/c_cpp_properties.json`:

```json
"compileCommands": "${workspaceFolder}/out/Release/compile_commands.json"
```

### Debugging C++ with native debuggers

| Platform | Debugger | VSCode plugin |
|----------|----------|---------------|
| macOS | lldb | [vscode-lldb](https://github.com/vadimcn/vscode-lldb) |
| Linux | gdb or lldb | vscode-lldb or cppdbg |
| Windows | Visual Studio debugger | built-in |

**VSCode launch.json** for lldb (from [Joyee Cheung's tips](https://joyeecheung.github.io/blog/2018/12/31/tips-and-tricks-node-core/)):

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "(lldb) Launch",
      "type": "lldb",
      "request": "launch",
      "program": "${workspaceFolder}/out/Release/node",
      "args": ["--expose-internals", "test.js"],
      "cwd": "${workspaceFolder}"
    }
  ]
}
```

Switch `program` to `out/Debug/node` for debug builds. The `--expose-internals` flag allows accessing `lib/internal/` modules from JS land.

**V8 GDB/LLDB macros**: V8 ships GDB macros in `deps/v8/tools/gdbinit`. For LLDB, use the `.lldbinit` and `lldb_commands.py` from [danbev/learning-v8](https://github.com/danbev/learning-v8) — place them in your home directory for automatic loading.

### JS debugging with V8 Inspector

```bash
./node --inspect-brk test.js
```

Open `chrome://inspect` in Chrome and use the Node.js dedicated DevTools.

To debug **Node.js bootstrap code** (before user code runs):

```bash
./node --inspect-brk-node test.js
```

This breaks at the first line of the bootstrapping JS (currently `lib/internal/bootstrap/loaders.js`). Useful for debugging module loading, primordials initialization, etc.

### V8 intrinsics for debugging

Pass `--allow-natives-syntax` to access V8 internal functions prefixed with `%`:

```bash
./node --allow-natives-syntax -e "%DebugPrint(process)"
```

`%DebugPrint(obj)` shows V8 internal object details. Limited info in release builds — use debug builds for full output. `--expose-gc` exposes `global.gc()` for manually triggering GC when debugging memory issues.

### Logging from Node.js core

**JS land:**
- `console.log()` / `console.error()` — uses `util.inspect` underneath
- `process._rawDebug(string)` — prints directly to stderr, bypassing streams (use when debugging streams/console themselves)
- `util.debuglog('subsystem')` — conditional logging via `NODE_DEBUG=subsystem node test.js`

**C++ land:**
- `Debug()` from `src/debug_utils.h` — conditional stderr output based on `NODE_DEBUG` env var
- `printf` / `fprintf` — for quick throwaway logging
- `CHECK` macros from `src/util.h` — crash the process on failure (like assert but aborts)
- `DCHECK` — only active in debug builds, zero cost in release

```bash
NODE_DEBUG=http ./node test.js    # prints util.debuglog('http') outputs
```

### Debugging deps/v8

V8's own tests are **not** run by `make test`. To build and run V8 tests separately (from [Joyee Cheung's V8 guide](https://joyeecheung.github.io/blog/2019/06/08/on-deps-v8-in-node-js/)):

```bash
tools/make-v8.sh x64.debug
deps/v8/tools/run-tests.py --outdir out.gn/x64.debug 'cctest/test-api/CodeCache'
```

Debug V8 tests in VSCode by opening `deps/v8` as workspace and using this launch config:

```json
{
  "type": "lldb",
  "request": "launch",
  "name": "V8 cctest",
  "program": "${workspaceFolder}/out.gn/x64.debug/cctest",
  "args": ["test-api/CodeCache"],
  "cwd": "${workspaceFolder}"
}
```

### llnode — post-mortem debugging

[llnode](https://github.com/nodejs/llnode) is an LLDB plugin that understands V8/Node.js memory (JS objects on heap, stack frames). Works on release builds with post-mortem support (enabled by default in Node.js releases).

```bash
npm install -g llnode
llnode /path/to/node/binary -c /path/to/core/dump
(llnode) v8 help
```

Useful for debugging production crashes from core dumps without needing debug builds. Cross-platform core dump analysis is supported (e.g., debug Linux dumps on macOS).

### C++ formatting

Format only changed C++ files relative to the base branch:

```bash
CLANG_FORMAT_START=$(git merge-base HEAD main) make format-cpp
```

### Additional references

- [Tips and Tricks for Node.js Core Development and Debugging](https://joyeecheung.github.io/blog/2018/12/31/tips-and-tricks-node-core/) — Joyee Cheung
- [On deps/v8 in Node.js](https://joyeecheung.github.io/blog/2019/06/08/on-deps-v8-in-node-js/) — Joyee Cheung
- [Tinkering with Node.js Core on ARM64 Windows](https://joyeecheung.github.io/blog/2026/01/31/tinkering-with-nodejs-core-on-arm64-windows/) — Joyee Cheung
- [Debug V8 in Node.js core with GDB](https://medium.com/nickthecoder/debug-v8-in-node-js-core-with-gdb-cc753f1f32) — Franziska Hinkelmann
