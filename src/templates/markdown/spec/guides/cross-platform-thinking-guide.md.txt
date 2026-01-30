# Cross-Platform Thinking Guide

> **Purpose**: Catch platform-specific assumptions before they become bugs.

---

## Why This Matters

**Most cross-platform bugs come from implicit assumptions**:

- Assumed shebang works → breaks on Windows
- Assumed `/` path separator → breaks on Windows
- Assumed `\n` line endings → inconsistent behavior
- Assumed command availability → `grep` vs `findstr`

---

## Platform Differences Checklist

### 1. Script Execution

| Assumption | macOS/Linux | Windows |
|------------|-------------|---------|
| Shebang (`#!/usr/bin/env python3`) | ✅ Works | ❌ Ignored |
| Direct execution (`./script.py`) | ✅ Works | ❌ Fails |
| Explicit interpreter (`python3 script.py`) | ✅ Works | ✅ Works |

**Rule**: Always use explicit `python3` in documentation, help text, and error messages.

```python
# BAD - Assumes shebang works
print("Usage: ./script.py <args>")
print("Run: script.py <args>")

# GOOD - Explicit interpreter
print("Usage: python3 script.py <args>")
print("Run: python3 ./script.py <args>")
```

### 2. Path Handling

| Assumption | macOS/Linux | Windows |
|------------|-------------|---------|
| `/` separator | ✅ Works | ⚠️ Sometimes works |
| `\` separator | ❌ Escape char | ✅ Native |
| `pathlib.Path` | ✅ Works | ✅ Works |

**Rule**: Use `pathlib.Path` for all path operations.

```python
# BAD - String concatenation
path = base + "/" + filename

# GOOD - pathlib
from pathlib import Path
path = Path(base) / filename
```

### 3. Line Endings

| Format | macOS/Linux | Windows | Git |
|--------|-------------|---------|-----|
| `\n` (LF) | ✅ Native | ⚠️ Some tools | ✅ Normalized |
| `\r\n` (CRLF) | ⚠️ Extra char | ✅ Native | Converted |

**Rule**: Use `.gitattributes` to enforce consistent line endings.

```gitattributes
* text=auto eol=lf
*.sh text eol=lf
*.py text eol=lf
```

### 4. Environment Variables

| Variable | macOS/Linux | Windows |
|----------|-------------|---------|
| `HOME` | ✅ Set | ❌ Use `USERPROFILE` |
| `PATH` separator | `:` | `;` |
| Case sensitivity | ✅ Case-sensitive | ❌ Case-insensitive |

**Rule**: Use `pathlib.Path.home()` instead of environment variables.

```python
# BAD
home = os.environ.get("HOME")

# GOOD
home = Path.home()
```

### 5. Command Availability

| Command | macOS/Linux | Windows |
|---------|-------------|---------|
| `grep` | ✅ Built-in | ❌ Not available |
| `find` | ✅ Built-in | ⚠️ Different syntax |
| `cat` | ✅ Built-in | ❌ Use `type` |

**Rule**: Use Python standard library instead of shell commands when possible.

---

## Change Propagation Checklist

When making platform-related changes, check **all these locations**:

### Documentation & Help Text
- [ ] Docstrings at top of Python files
- [ ] `--help` output / argparse descriptions
- [ ] Usage examples in README
- [ ] Error messages that suggest commands
- [ ] Markdown documentation (`.md` files)

### Code Locations
- [ ] `src/templates/` - Template files for new projects
- [ ] `.trellis/scripts/` - Project's own scripts (if self-hosting)
- [ ] `dist/` - Built output (rebuild after changes)

### Search Pattern
```bash
# Find all places that might need updating
grep -r "python [a-z]" --include="*.py" --include="*.md"
grep -r "\./" --include="*.py" --include="*.md" | grep -v python3
```

---

## Pre-Commit Checklist

Before committing cross-platform code:

- [ ] All Python invocations use `python3` explicitly
- [ ] All paths use `pathlib.Path`
- [ ] No hardcoded path separators (`/` or `\`)
- [ ] No platform-specific commands without fallbacks
- [ ] Documentation matches code behavior
- [ ] Ran search to find all affected locations

---

## Common Mistakes

### 1. "It works on my Mac"

```python
# Developer's Mac
subprocess.run(["./script.py"])  # Works!

# User's Windows
subprocess.run(["./script.py"])  # FileNotFoundError
```

### 2. "The shebang should handle it"

```python
#!/usr/bin/env python3
# This line is IGNORED on Windows
```

### 3. "I updated the template"

```
src/templates/script.py  ← Updated
.trellis/scripts/script.py  ← Forgot to sync!
```

---

## Recovery: When You Find a Platform Bug

1. **Fix the immediate issue**
2. **Search for similar patterns** (grep the codebase)
3. **Update this guide** with the new pattern
4. **Add to pre-commit checklist** if recurring

---

**Core Principle**: If it's not explicit, it's an assumption. And assumptions break.
