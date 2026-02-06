# Test Conventions

> File naming, structure, and assertion patterns.

---

## Test Infrastructure

| Item | Value |
|------|-------|
| Framework | Vitest 4.x |
| Config | `vitest.config.ts` |
| Include | `test/**/*.test.ts` |
| Exclude | `third/**` |
| Lint scope | `eslint src/ test/` |
| Module system | ESM (`"type": "module"` + `"module": "NodeNext"`) |
| Coverage provider | `@vitest/coverage-v8` |
| Coverage command | `pnpm test:coverage` |
| Coverage scope | `src/**/*.ts` (excludes `src/cli/index.ts`) |
| Coverage reports | `text` (terminal), `html` (`./coverage/index.html`), `json-summary` |

---

## When to Write Tests

### Must write

| Change Type | Test Type | Example |
|-------------|-----------|---------|
| New pure/utility function | Unit test | Added `compareVersions()` → test boundary values |
| New platform | Unit (auto-covered by `registry-invariants.test.ts`) | Added opencode → invariants verify consistency |
| Bug fix | Regression test | Fixed Windows encoding → add to `regression.test.ts` |
| Changed init/update behavior | Integration test | Changed downgrade logic → add/update scenario in `update.integration.test.ts` |

### Don't need tests

| Change Type | Reason |
|-------------|--------|
| Template text / doc content changes | No logic change |
| New migration manifest JSON | `registry-invariants.test.ts` auto-validates format |
| CLI flag description text | Display-only |

### Decision flow

```
Does this change have logic branches?
├─ No (pure data/text) → Don't write tests
└─ Yes
   ├─ Standalone function with predictable input→output? → Unit test
   ├─ Fixing a historical bug? → Regression test (verify fix exists in source)
   └─ Changes init/update end-to-end behavior? → Integration test
```

---

## File Naming

```
test/
  types/
    ai-tools.test.ts          # Unit tests for src/types/ai-tools.ts
  commands/
    update-internals.test.ts   # Unit tests for internal functions
    init.integration.test.ts   # Integration tests for init() command
    update.integration.test.ts # Integration tests for update() command
  regression.test.ts           # Cross-version regression tests
```

**Rules**:
- Mirror `src/` directory structure under `test/`
- Suffix: `.test.ts` for unit tests, `.integration.test.ts` for integration tests
- One test file per source module (exceptions: regression tests)

---

## Test Structure

### Standard Pattern

```typescript
import { describe, it, expect } from "vitest";

describe("functionName", () => {
  it("does X when given Y", () => {
    const result = functionName(input);
    expect(result).toBe(expected);
  });
});
```

### With Setup/Teardown

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("module", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-test-"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
```

---

## Assertion Patterns

### Prefer Exact Matchers

```typescript
// Good: Exact
expect(result).toBe("expected");
expect(array).toEqual(["a", "b"]);

// Avoid: Loose
expect(result).toBeTruthy();
expect(array.length).toBeGreaterThan(0);
```

### Snapshot Comparison for No-Op Verification

When asserting that an operation made zero changes, use full directory snapshots:

```typescript
// Collect all files + contents before
const before = new Map<string, string>();
walk(dir, (filePath, content) => before.set(filePath, content));

// Run operation
await operation();

// Collect after and diff
const after = new Map<string, string>();
walk(dir, (filePath, content) => after.set(filePath, content));

const added = [...after.keys()].filter((k) => !before.has(k));
const removed = [...before.keys()].filter((k) => !after.has(k));
expect(added).toEqual([]);
expect(removed).toEqual([]);
```

---

## ESLint Compatibility

Tests must pass the same ESLint rules as `src/`. Common workarounds:

```typescript
// Empty function (no-empty-function rule)
// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = () => {};
vi.spyOn(console, "log").mockImplementation(noop);

// Avoiding non-null assertion
// Bad: match![0]
// Good: (match as [unknown])[0]
```

---

## DO / DON'T

### DO

- Use independent temp directories per test (no shared state)
- Clean up temp directories in `afterEach`
- Restore all mocks in `afterEach` with `vi.restoreAllMocks()`
- Use `vi.mocked()` for type-safe mock access
- Number test scenarios (`#1`, `#2`, ...) for traceability to PRD

### DON'T

- Don't depend on test execution order
- Don't use timers, network, or global state
- Don't leave temp files after test completion
- Don't use `any` in test files (same ESLint rules apply)
- Don't forget `vi.unstubAllGlobals()` when using `vi.stubGlobal`
