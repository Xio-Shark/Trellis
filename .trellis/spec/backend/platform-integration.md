# Platform Integration Guide

How to add support for a new AI CLI platform (like Claude Code, Cursor, OpenCode, iFlow).

---

## Checklist

When adding a new platform `{platform}`, update all of the following:

### 1. CLI Commands

| File | Change |
|------|--------|
| `src/cli/index.ts` | Add `--{platform}` option |
| `src/commands/init.ts` | Add option handling and configurator call |
| `src/commands/update.ts` | Add template collection for new platform |

### 2. Configurator

| File | Change |
|------|--------|
| `src/configurators/{platform}.ts` | Create new configurator (copy from existing) |

### 3. Templates

| Directory | Contents |
|-----------|----------|
| `src/templates/{platform}/` | Root directory |
| `src/templates/{platform}/index.ts` | Export functions for commands, agents, hooks, settings |
| `src/templates/{platform}/commands/trellis/` | Slash commands (`.md` files) |
| `src/templates/{platform}/agents/` | Agent definitions (`.md` files) |
| `src/templates/{platform}/hooks/` | Hook scripts (`.py` files) |
| `src/templates/{platform}/settings.json` | Platform settings |

### 4. Type Definitions

| File | Change |
|------|--------|
| `src/types/ai-tools.ts` | Add to `AITool` and `TemplateDir` types |

### 5. Template Extraction

| File | Change |
|------|--------|
| `src/templates/extract.ts` | Add `get{Platform}TemplatePath()` function |

### 6. Update Mechanism

| File | Change |
|------|--------|
| `src/commands/update.ts` | Add `.{platform}` to `getConfiguredPlatforms()` detection |
| `src/commands/update.ts` | Add template collection in `collectTemplateFiles()` with `platforms.has("{platform}")` check |
| `src/commands/update.ts` | Add to `BACKUP_DIRS` array |
| `src/commands/update.ts` | Add to directory cleanup logic |
| `src/utils/template-hash.ts` | Add to `TEMPLATE_DIRS` array |

**Note**: `trellis update` only updates platforms that have existing directories. The `getConfiguredPlatforms()` function detects which `.{platform}/` directories exist and only collects templates for those platforms.

### 7. Python Scripts

| File | Change |
|------|--------|
| `src/templates/trellis/scripts/common/cli_adapter.py` | Add platform to `Platform` type and `config_dir_name` |
| `src/templates/trellis/scripts/multi_agent/plan.py` | Add to `--platform` choices |
| `src/templates/trellis/scripts/multi_agent/start.py` | Add to `--platform` choices |

### 8. Build Scripts

| File | Change |
|------|--------|
| `scripts/copy-templates.js` | Add new template directory to copy list |

### 9. Documentation

| File | Change |
|------|--------|
| `README.md` | Add platform to supported tools list |
| `README_CN.md` | Add platform to supported tools list (Chinese) |
| `src/templates/trellis/workflow.md` | Add developer naming convention |

### 10. Project Config (Optional)

If Trellis project itself should support the new platform:

| Directory | Contents |
|-----------|----------|
| `.{platform}/` | Project's own config directory |
| `.{platform}/commands/trellis/` | Slash commands |
| `.{platform}/agents/` | Agents |
| `.{platform}/hooks/` | Hooks |
| `.{platform}/settings.json` | Settings |

### 11. Gitignore

| File | Change |
|------|--------|
| `.gitignore` | Add local config patterns (e.g., `{platform}.local.json`) |

---

## Command Format by Platform

| Platform | Command Format | Example |
|----------|---------------|---------|
| Claude Code | `/trellis:xxx` | `/trellis:start` |
| Cursor | `/trellis-xxx` | `/trellis-start` |
| OpenCode | `/trellis:xxx` | `/trellis:start` |
| iFlow | `/trellis:xxx` | `/trellis:start` |

When creating command templates, ensure the command references match the platform's format.

---

## Windows Encoding Fix

All hook scripts that output to stdout must include the Windows encoding fix:

```python
# IMPORTANT: Force stdout to use UTF-8 on Windows
# This fixes UnicodeEncodeError when outputting non-ASCII characters
if sys.platform == "win32":
    import io as _io
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
    elif hasattr(sys.stdout, "detach"):
        sys.stdout = _io.TextIOWrapper(sys.stdout.detach(), encoding="utf-8", errors="replace")  # type: ignore[union-attr]
```

---

## Common Mistakes

### Missing from getConfiguredPlatforms()

**Symptom**: `trellis update` doesn't update templates for the new platform even when its directory exists.

**Fix**: Add `.{platform}` detection to `getConfiguredPlatforms()` in `src/commands/update.ts`.

### Missing from BACKUP_DIRS

**Symptom**: `trellis update` doesn't backup the new platform's directory.

**Fix**: Add `.{platform}` to `BACKUP_DIRS` in `src/commands/update.ts`.

### Missing from TEMPLATE_DIRS

**Symptom**: Template hash tracking doesn't work for new platform.

**Fix**: Add `.{platform}` to `TEMPLATE_DIRS` in `src/utils/template-hash.ts`.

### Missing platform in cli_adapter.py

**Symptom**: Python scripts fail with "Unsupported platform" error.

**Fix**: Add platform to `Platform` literal type and `config_dir_name` method.

### Wrong command format in templates

**Symptom**: Slash commands don't work or show wrong format.

**Fix**: Check platform's command format and update all command references in templates.

---

## Reference PR

See PR #22 (iFlow CLI support) for a complete example of adding a new platform.
