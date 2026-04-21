# Style Guide

> Writing style and content standards for documentation.

---

## Voice and Tone

### Guidelines

| Aspect     | Guideline                                               |
| ---------- | ------------------------------------------------------- |
| **Voice**  | Professional, friendly, direct                          |
| **Tense**  | Present tense ("Click the button" not "You will click") |
| **Person** | Second person ("You can..." not "Users can...")         |
| **Mood**   | Imperative for instructions ("Run the command")         |

### Examples

**Good:**

> Run the following command to start the server.

**Avoid:**

> The user should run the following command to start the server.

---

## Page Structure

### Standard Page Template

```mdx
---
title: 'Clear, Action-Oriented Title'
description: 'What the reader will learn or accomplish (150 chars)'
---

Brief introduction paragraph explaining what this page covers.

## First Major Section

Content here...

### Subsection if needed

More detail...

## Second Major Section

Content here...

## Next Steps

Links to related content or next actions.
```

### Heading Hierarchy

| Level | Usage                                    |
| ----- | ---------------------------------------- |
| H1    | Never use (title comes from frontmatter) |
| H2    | Major sections                           |
| H3    | Subsections                              |
| H4    | Rarely needed, avoid if possible         |

---

## Writing Guidelines

### Titles

| Type            | Format        | Example                               |
| --------------- | ------------- | ------------------------------------- |
| Page title      | Title Case    | "Getting Started with the API"        |
| Section heading | Sentence case | "Configure your settings"             |
| Description     | Sentence      | "Learn how to set up authentication." |

### Lists

**Use bullet lists for:**

- Non-sequential items
- Feature lists
- Requirements

**Use numbered lists for:**

1. Step-by-step instructions
2. Ordered processes
3. Prioritized items

### Code References

- Use backticks for inline code: `npm install`
- Use code blocks for multi-line code
- Always specify language for syntax highlighting

---

## Content Types

### Conceptual Content

Explains what something is and why it matters.

```mdx
## What is Authentication?

Authentication verifies the identity of users accessing your API.
It ensures that only authorized users can perform actions.
```

### Procedural Content

Step-by-step instructions for completing a task.

```mdx
## Set Up Authentication

1. Navigate to the Dashboard
2. Click **Settings** > **API Keys**
3. Click **Generate New Key**
4. Copy the key and store it securely
```

### Reference Content

Technical specifications and API details.

```mdx
## API Response Codes

| Code | Meaning      |
| ---- | ------------ |
| 200  | Success      |
| 400  | Bad Request  |
| 401  | Unauthorized |
| 500  | Server Error |
```

---

## Formatting Standards

### Emphasis

| Style    | Usage                        | Markdown     |
| -------- | ---------------------------- | ------------ |
| **Bold** | UI elements, important terms | `**text**`   |
| _Italic_ | Introducing new terms        | `*term*`     |
| `Code`   | Commands, file names, code   | `` `code` `` |

### Links

**Internal links:**

```mdx
See the [quickstart guide](/quickstart) for setup instructions.
```

**External links:**

```mdx
Read the [official documentation](https://example.com/docs).
```

### Images

```mdx
![Alt text description](/images/screenshot.png)
```

Always include descriptive alt text.

---

## Best Practices

### DO

- Start with the most important information
- Use concrete examples
- Keep paragraphs short (3-4 sentences max)
- Include code samples for technical content
- Link to related content

### DON'T

- Assume prior knowledge without linking to prerequisites
- Use jargon without explanation
- Write walls of text without visual breaks
- Skip alt text on images
- Use vague language ("simply", "just", "easily")

---

## Source-of-Truth Discipline for Code-Level Docs

When a page documents **code-level contracts** — JSON schemas, CLI subcommand tables, config field lists, file path references, default values — **open the source file first** and copy the list verbatim (field order, names, defaults) before writing a single line of prose. Don't document from memory, and don't propagate what existing docs already say without re-verifying.

### Why

Docs drift silently. `task.json` schema docs claimed `task.py create-pr` and `rejected` status existed for multiple releases — neither was ever in the source. The schema field order was shuffled, comments described behavior the code doesn't implement ("commit hash filled on archive" when `archive` only writes `completedAt`). Every one of these is a ~30-second verification away from the truth.

### Rule

Before writing or editing code-level reference docs:

1. Identify the **canonical source** — usually a single file (e.g. `task_store.py`, `init.ts`, a Zod schema). Link to it in the doc so reviewers can cross-check.
2. **Copy field order** from source. Don't alphabetize, don't reorder "for readability".
3. **Quote source line numbers** in commit messages (`task_store.py:147-172`) so the provenance is traceable.
4. When comments describe "when is this populated" — grep for every writer. If the only writer is `create()`, say "written as null; no other code paths update it" — don't invent imaginary lifecycle events.
5. When multiple writers exist with divergent shapes (e.g. `task_store.py` vs `init.ts` vs `update.ts`), either document all variants or document the canonical one and file a code-cleanup task to converge them. **Don't paper over divergence with optimistic prose.**

### Common Mistake: Documenting from prior docs

**Symptom**: Doc says field X or subcommand Y exists. Reader tries it. Nothing happens.

**Cause**: The doc was copied from a previous version of itself. The previous version was wrong. The field / subcommand was aspirational, removed, or never merged.

**Fix**: For every code-level claim, grep the source. If no code path writes/reads it, delete the claim.

**Prevention**: When editing an existing reference page, treat the prior content as unverified. The only trustworthy version is the source file.

---

## JSONL Context Injection Content

When writing docs, skills, commands, or templates that teach users about `implement.jsonl` / `check.jsonl` / `research.jsonl` entries, enforce this content rule:

### Rule

JSONL entries point at **spec files** (`.trellis/spec/**`) or the task's **research outputs** (`{TASK_DIR}/research/**`). They do NOT point at raw source files (`src/services/foo.ts`) or raw source directories (`packages/<pkg>/`).

### Why

Sub-agents already have `Read` / `Grep`. They pull code on demand. Injecting source files into the prompt:

- Burns tokens in every sub-agent spawn for code that may not even be relevant to this turn
- Makes JSONL entries decay fast (code moves; a path pinned by JSONL is stale the moment you refactor)
- Gives AI a false impression that the injected files are the "authoritative" code, biasing toward them even when better code exists elsewhere

Specs and research, by contrast, *are* the rules and background the sub-agent needs before touching code. They're the right payload.

### Example

```jsonl
# Good — specs + research
{"file": ".trellis/workflow.md", "reason": "Workflow contract"}
{"file": ".trellis/spec/backend/api-module.md", "reason": "API module conventions"}
{"file": ".trellis/tasks/02-27-user-login/research/", "type": "directory", "reason": "Upstream research outputs"}

# Bad — raw code
{"file": "src/services/auth.ts", "reason": "Existing auth patterns"}
{"file": "src/services/", "type": "directory", "reason": "Existing service patterns"}
```

### Writer's check

When you add a JSONL example or write a skill that calls `task.py add-context`:

- [ ] Is the path under `.trellis/spec/` or `{TASK_DIR}/research/`?
- [ ] If you're tempted to point at `src/` or `packages/`, ask: is this really a *rule* the agent needs up-front, or just code it could grep for itself when needed?

---

## Tombstone Sections: Delete, Don't Archive

When content becomes obsolete because a feature was removed, **delete the content outright**. Don't leave a "What was removed in vX.Y" table or a standalone "Appendix X: feature (removed)" page.

### Why

Tombstone sections:

- Pollute the TOC and in-page sidebar
- Repeat migration guidance that belongs in the changelog / migration manifest, not the reference docs
- Teach readers to skim-ignore sections — the "noise sections" train them to tune out legit content too
- Accumulate across versions (every release adds one; none ever removes one)

### Rule

When a feature is removed:

1. Delete the sections / pages that documented it.
2. Put the "what to do instead" guidance in **one place** — the release changelog or migration manifest's `notes` field. Link to it from the top-of-page `<Note>` for the one release that removes it, then drop the note the release after.
3. If a former section is heavily cross-referenced, check for incoming links and redirect them; don't keep the tombstone just to preserve URLs.

### Example

**Wrong** (actual regression seen in 0.5 audit):

```markdown
## Appendix E: worktree.yaml (removed)

This appendix previously documented…  Both the pipeline and this file
were removed in 0.5.0-beta.0 along with…
```

**Right**: delete `appendix-e.mdx`, remove it from `docs.json`. Note in the 0.5.0-beta.0 changelog that Multi-Agent Pipeline was removed and `worktree.yaml` is no longer read.

---

## Quality Checklist

Before publishing:

- [ ] Title is clear and descriptive
- [ ] Description is under 160 characters
- [ ] Headings follow hierarchy (H2 > H3)
- [ ] Code examples are tested and correct
- [ ] Links are valid and point to correct pages
- [ ] Images have alt text
- [ ] Content is scannable (lists, tables, short paragraphs)
- [ ] For code-level reference pages: every field / subcommand / flag traces to a named source file you opened while writing
- [ ] JSONL examples inject specs or research, not raw code
- [ ] No "removed in vX.Y" tombstone sections for features already absent
