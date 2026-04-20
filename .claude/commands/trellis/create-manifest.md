# Create Migration Manifest

Create a migration manifest for a new patch/minor release based on commits since the last release.

## Arguments

- `$ARGUMENTS` — Target version (e.g., `0.3.1`). If omitted, ask the user.

## Steps

### Step 1: Identify Last Release

```bash
# Find the last release tag and its commit
git tag --sort=-v:refname | head -5
```

Pick the most recent release tag (e.g., `v0.3.0`).

### Step 2: Gather Changes

```bash
# Show all commits since last release
git log <last-release-tag>..HEAD --oneline

# Show src/ changes only (skip .trellis/, docs, chore)
git log <last-release-tag>..HEAD --oneline -- src/
```

### Step 3: Analyze Each Commit

For each commit that touches `src/`:
1. Read the diff: `git diff <parent>...<commit> -- src/ --stat`
2. Classify: `feat` / `fix` / `refactor` / `chore`
3. Write a one-line changelog entry in conventional commit style

### Step 4: Draft Changelog

Organize entries into sections:

```
**Enhancements:**
- feat(scope): description

**Bug Fixes:**
- fix(scope): description
```

### Step 5: Determine Manifest Fields

| Field | How to decide |
|-------|---------------|
| `breaking` | Any breaking API/behavior change? Default `false` for patch |
| `recommendMigrate` | Any file rename/delete migrations? Default `false` for patch. **When `breaking=true` + `recommendMigrate=true`, `trellis update` exits 1 without `--migrate` — this is the safety gate, set deliberately.** |
| `migrations` | List of `rename`/`rename-dir`/`delete`/`safe-file-delete` actions. Usually `[]` for patch |
| `notes` | Brief guidance for users (e.g., "run `trellis update --migrate` to sync"). Shown inline in terminal during update. |

### Step 5a: Per-Migration Entry Fields

For each entry inside `migrations`:

| Field | Purpose | Required? |
|-------|---------|-----------|
| `type` | `rename` / `rename-dir` / `delete` / `safe-file-delete` | yes |
| `from` | Source path (relative to project root) | yes |
| `to` | Target path (rename / rename-dir only) | yes for renames |
| `description` | **What** this migration does — one sentence, shown in the confirm prompt | recommended |
| `reason` | **Why** the user might see this entry flagged as modified. Version-specific context (e.g. "Trellis 0.4.0 skipped hashing this path — pristine copies show as modified. [r] is safe."). Keeps version-specific hints out of `update.ts`. | optional |
| `allowed_hashes` | **Only for `safe-file-delete`.** SHA256 hashes of known-pristine content — if file hash matches, delete; otherwise skip with a warning (preserves user customizations). | required for `safe-file-delete` |

**How `rename` classification works** (subtle, common gotcha):
- `rename` uses the **project-local** `.trellis/.template-hashes.json` (auto-maintained by Trellis), NOT the manifest's `allowed_hashes` field.
- Classification outcomes: `auto` (pristine hash match → rename silently) / `confirm` (hash mismatch → interactive prompt) / `conflict` (target already exists) / `skip` (source missing).
- So you do **NOT** need to collect historical template hashes for `rename` entries — only `safe-file-delete` needs `allowed_hashes`.

**When to use `rename` vs `safe-file-delete`:**
- File relocated / renamed in new version, old path has a new target → **`rename`** (preserves user edits via mv, confirm prompt lets them pick)
- File fully removed in new version, no replacement → **`safe-file-delete`** (requires `allowed_hashes` for hash-verified deletion)
- File semantically folded into another command (e.g. `record-session` → `finish-work` Step 3) → **`safe-file-delete`** + mention in `notes` for alias migration guidance

### Step 6: Create Manifest

Pipe JSON via heredoc (auto-detected when stdin is not a TTY):

```bash
cat <<'EOF' | node packages/cli/scripts/create-manifest.js
{
  "version": "<version>",
  "description": "<short description>",
  "breaking": false,
  "recommendMigrate": false,
  "changelog": "<changelog text with real newlines>",
  "notes": "<notes>",
  "migrations": [
    {
      "type": "rename",
      "from": ".claude/commands/old-path.md",
      "to": ".claude/skills/trellis-new-path/SKILL.md",
      "description": "v<version>: repurposed as auto-triggered skill",
      "reason": "Why prompted: <version-specific nuance shown to user in confirm prompt>"
    },
    {
      "type": "safe-file-delete",
      "from": ".claude/commands/removed.md",
      "description": "Removed in v<version> — <replacement>",
      "allowed_hashes": ["<sha256 of known-pristine content>"]
    }
  ]
}
EOF
```

**Tip for breaking releases with many rename entries**: write a small Node generator script (see `/tmp/gen-rename-entries.mjs` pattern from 0.5.0-beta.0) that enumerates platform × command combinations, then injects them into the manifest. Easier to review than hand-writing 60+ entries.

### Step 7: Create Docs-Site Changelogs

**IMPORTANT**: This step is mandatory for every release.

Create changelog files for both English and Chinese:

1. `docs-site/changelog/v<version>.mdx` — English changelog
2. `docs-site/zh/changelog/v<version>.mdx` — Chinese changelog

Use the format from previous changelog files (frontmatter with title + description date, then content).

3. Update `docs-site/docs.json`:
   - Add `"changelog/v<version>"` to the English changelog pages list (at the top)
   - Add `"zh/changelog/v<version>"` to the Chinese changelog pages list (at the top)
   - Update the navbar changelog link `href` to point to the new version

### Step 8: Review and Confirm

1. Read the generated manifest: `packages/cli/src/migrations/manifests/<version>.json`
2. Verify the JSON is valid and `\n` renders as actual newlines
3. Verify both changelog MDX files exist and look correct
4. Show the final manifest and changelog to the user for confirmation

## Notes

- Patch versions (`X.Y.Z`) typically have `migrations: []` and `breaking: false`
- Only add `migrationGuide` and `aiInstructions` for breaking changes
- Changelog should cover ALL `src/` changes, not just the latest commit
- Do NOT manually bump `package.json` version — `pnpm release` handles that automatically

### Field Quick Reference

Added/clarified during 0.5.0-beta.0:

- **`breaking` + `recommendMigrate`** (manifest-level) — together form the safety gate: `update` exits 1 without `--migrate` when both are true. Set `recommendMigrate: true` whenever there are rename/delete entries whose absence would leave a half-migrated project.
- **`reason`** (per-entry) — shown in the confirm prompt when a file trips the modified-hash check. Put version-specific nuance here (e.g. "0.4.0 skipped hashing this path"), not in code.
- **`description`** (per-entry) — one sentence answering "what is this migration doing", also shown in the prompt.
- **`allowed_hashes`** — required ONLY for `safe-file-delete`. `rename` classification uses project-local `.trellis/.template-hashes.json`; you do NOT need to collect historical hashes for rename entries.

### Dogfooding (mandatory for breaking releases)

Before shipping, run end-to-end migration in a throwaway tmp dir:

```bash
# 1. Init the previous GA version in tmp
mkdir /tmp/migrate-test && cd /tmp/migrate-test && git init -q .
npx -y @mindfoldhq/trellis@<last-ga> init -y -u test --claude --cursor --<all-platforms-you-care-about>

# 2. Dry-run against local build
node <repo>/packages/cli/dist/cli/index.js update --migrate --dry-run

# 3. Real migrate
yes | node <repo>/packages/cli/dist/cli/index.js update --migrate --force

# 4. Verify idempotency — second run must say "Already up to date!"
yes | node <repo>/packages/cli/dist/cli/index.js update
```

Watch for:
- **Orphan files** — stale paths written by the old version that don't match any rename/safe-file-delete. Grep `find . -path "*/skills/*" -not -path "*/trellis-*"` to catch plain-name skill dirs.
- **Idempotency churn** — if second run adds/cleans files, something is either missing from the manifest or `dist/templates/` has stale copies from a broken build.
- **Backup bloat** — confirm `.trellis/.backup-*/` doesn't contain `/worktrees/` or `/workspace/` paths.
