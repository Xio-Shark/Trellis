---
name: improve-ut
description: "Improve Unit Test Coverage for New Changes"
---

# Improve Unit Tests (UT)

Use this skill to improve test coverage after code changes.

## Usage

```text
$improve-ut
```

## Source of Truth

Discover and read unit-test specs dynamically:

```bash
# Discover available packages and their spec layers
python3 ./.trellis/scripts/get_context.py --mode packages
```

Look for packages with `unit-test` spec layer in the output. For each discovered `unit-test/` directory, read all spec files inside it (e.g., `index.md`, `conventions.md`, `integration-patterns.md`, `mock-strategies.md`).

> If this skill conflicts with the unit-test specs, the specs win.

---

## Execution Flow

1. Inspect changed files:
   - `git diff --name-only`
2. Decide test scope using unit-test specs:
   - unit vs integration vs regression
   - mock vs real filesystem flow
3. Add/update tests using existing project test patterns
4. Run validation:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

5. Summarize decisions, updates, and remaining test gaps.

---

## Output Format

```markdown
## UT Coverage Plan
- Changed areas: ...
- Test scope (unit/integration/regression): ...

## Test Updates
- Added: ...
- Updated: ...

## Validation
- pnpm lint: pass/fail
- pnpm typecheck: pass/fail
- pnpm test: pass/fail

## Gaps / Follow-ups
- <none or explicit rationale>
```
