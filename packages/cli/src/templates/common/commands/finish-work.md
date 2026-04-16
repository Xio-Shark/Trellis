# Finish Work

Wrap up the current session: verify quality, then record progress.

---

## Step 1: Quality Gate

The `trellis-check` skill should have already run. If not, trigger it now — verify that lint, type-check, tests, and spec compliance all pass before proceeding.

## Step 2: Remind User to Commit

If there are uncommitted changes, remind the user:

> "Please review the changes and commit when ready."

Do NOT run `git commit` — the human commits after testing.

## Step 3: Record Session (after commit)

Once the human has committed:

### Archive Completed Tasks

Archive tasks whose work is done — judge by work status, not the `status` field:

```bash
{{PYTHON_CMD}} ./.trellis/scripts/task.py archive <task-name>
```

### Add Session Entry

```bash
{{PYTHON_CMD}} ./.trellis/scripts/add_session.py \
  --title "Session Title" \
  --commit "hash1,hash2" \
  --summary "Brief summary of what was done"
```

Auto-completes: journal append, line count check, branch detection, index update, metadata commit.

---

## Related

- `trellis-check` — Full quality verification (auto-triggered or invoke manually)
- `{{CMD_REF:update-spec}}` — Capture new patterns into specs
- `{{CMD_REF:break-loop}}` — Deep analysis after debugging
