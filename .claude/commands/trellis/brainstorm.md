# Brainstorm - Requirements Discovery

Guide AI through collaborative requirements discovery before implementation.

---

## When to Use

This skill is triggered from `/trellis:start` when the user describes a development task.
It helps turn vague ideas into well-defined requirements through structured dialogue.

---

## Task Classification

First, classify the user's request to determine if brainstorming is needed:

| Complexity | Criteria | Action |
|------------|----------|--------|
| **Trivial** | Single-line fix, typo, obvious change | Skip brainstorm, direct edit |
| **Simple** | Clear goal, 1-2 files, well-defined scope | Quick confirm, then implement |
| **Moderate** | Multiple files, some ambiguity | Light brainstorm (2-3 questions) |
| **Complex** | Vague goal, architectural decisions, multiple approaches | Full brainstorm |

### Classification Signals

**Trivial/Simple indicators:**
- User specifies exact file and change
- "Fix the typo in X"
- "Add field Y to component Z"
- Clear acceptance criteria already stated

**Moderate/Complex indicators:**
- "I want to add a feature for..."
- "Can you help me improve..."
- Mentions multiple areas or systems
- No clear implementation path
- User seems unsure about approach

---

## The Brainstorm Process

### Step 1: Acknowledge and Classify (No task creation yet)

First, understand and classify without creating any task directory:

```markdown
I understand you want to [summarize goal].

This looks like a [complexity level] task because [reason].

[If Simple]: Let me confirm: [restate understanding]. Ready to proceed?
[If Moderate/Complex]: Let me ask a few questions to clarify the requirements.
```

**Do NOT create task yet** - wait until you have basic understanding.

### Step 2: Initial Discovery (1-2 key questions)

For Moderate/Complex tasks, ask 1-2 **foundational questions** to establish basic understanding:

- What is the core goal?
- What's the scope boundary?

This helps form a meaningful **working title** for the task.

### Step 3: Create Task Directory (after basic understanding)

**Only after** you can articulate what the task is about, create the directory:

```bash
TASK_DIR=$(python3 ./.trellis/scripts/task.py create "[working title]" --slug [slug])
```

Create initial `prd.md` with what you know so far:

```markdown
# [Working Title]

## Goal
[Initial understanding from discovery]

## Open Questions
- [Remaining questions]

## Requirements (evolving)
- [What we know so far]

## Acceptance Criteria (evolving)
(To be refined)
```

### Step 4: Continue Q&A Loop

**Key principle**: One question per message. **Update PRD after each answer.**

**Question types (in order of priority):**

1. **Scope** - "Should this also handle X, or just Y?"
2. **Constraints** - "Are there any technical constraints I should know about?"
3. **Edge cases** - "What should happen when X occurs?"
4. **Success criteria** - "How will we know this is working correctly?"

**Question format:**

For **multiple choice** questions (preferred when options are clear):
```markdown
For [topic], which approach would you prefer?

1. **[Option A]** - [brief description, trade-off]
2. **[Option B]** - [brief description, trade-off]
3. **Other** - tell me your preference
```

For **open-ended** questions:
```markdown
[Question]?

(Feel free to be brief - we can clarify if needed)
```

**After each answer, immediately update `prd.md`:**

```bash
# Update with new information using Edit tool
# Move answered questions to Requirements section
# Add any new follow-up questions to Open Questions
```

**Example PRD evolution:**

Before:
```markdown
## Open Questions
- What input format is expected?
- Should validation be strict or lenient?

## Requirements (evolving)
(To be filled)
```

After user answers "JSON input, strict validation":
```markdown
## Open Questions
- (none remaining)

## Requirements (evolving)
- Input: JSON format only
- Validation: Strict - reject invalid input with clear error messages
```

### Step 5: Propose Approaches (if needed)

For complex tasks, after gathering requirements, propose 2-3 approaches:

```markdown
Based on what you've described, here are the main approaches:

**Approach A: [Name]** (Recommended)
- [How it works]
- Pros: [benefits]
- Cons: [trade-offs]

**Approach B: [Name]**
- [How it works]
- Pros: [benefits]
- Cons: [trade-offs]

Which direction would you prefer?
```

Update PRD with chosen approach in a new section:

```markdown
## Technical Approach
[Chosen approach and reasoning]
```

### Step 6: Confirm Final Requirements

When all questions are resolved:

```markdown
Here's my understanding of the complete requirements:

**Goal**: [one sentence]

**Requirements**:
- [Requirement 1]
- [Requirement 2]

**Acceptance Criteria**:
- [ ] [Criterion 1]
- [ ] [Criterion 2]

**Technical Approach**: [brief summary]

Does this look correct? If yes, I'll proceed with implementation.
```

Update PRD to finalize all sections and remove "Open Questions" section.

---

## PRD Template

The final `prd.md` should follow this structure:

```markdown
# [Task Title]

## Goal
[One paragraph describing what we're trying to achieve and why]

## Requirements
- [Functional requirement 1]
- [Functional requirement 2]
- [Non-functional requirement if any]

## Acceptance Criteria
- [ ] [Testable criterion 1]
- [ ] [Testable criterion 2]
- [ ] [Testable criterion 3]

## Technical Approach
[If complex: chosen approach and key decisions]

## Out of Scope
[Explicitly list what this task does NOT include]

## Technical Notes
[Any constraints, dependencies, or implementation hints]
```

---

## Integration with Start Workflow

This brainstorm process integrates into `/trellis:start` as follows:

```
User describes task
       ↓
Step 1: Classify (no task yet)
       ↓
┌──────┴──────┐
│ Trivial/    │ Complex/
│ Simple      │ Moderate
│     ↓       │     ↓
│ Quick       │ Step 2: Initial discovery
│ confirm     │ (1-2 key questions)
│     ↓       │     ↓
│             │ Step 3: Create task
│             │ (now have working title)
│             │     ↓
│             │ Step 4: Q&A loop
│             │ (update PRD each time)
│             │     ↓
│             │ Step 5-6: Approaches + Confirm
└──────┬──────┘
       ↓
   Implement
```

**Key insight**: Task creation happens AFTER basic understanding, not before.

---

## Key Principles

| Principle | Description |
|-----------|-------------|
| **Create task after understanding** | Wait until you can form a meaningful title (usually after 1-2 questions) |
| **One question at a time** | Never overwhelm with multiple questions |
| **Update PRD immediately** | After each answer, update the document |
| **Prefer multiple choice** | Easier for users to answer |
| **YAGNI** | Challenge unnecessary complexity |
| **Incremental clarity** | Build understanding step by step |
| **Visible progress** | User can see PRD evolving |

---

## Example Session

```
User: I want to add authentication to my app

AI: I understand you want to add authentication. This looks like a complex
    task with multiple valid approaches.

    First, let me understand the core approach:
    What type of authentication do you need?

    1. **Email/password** - Traditional login with optional email verification
    2. **OAuth only** - Google/GitHub login, no password management
    3. **Both** - Support multiple login methods
    4. **Other** - tell me your preference

User: OAuth only, just Google for now

AI: Got it - Google OAuth only. Now I have enough context to create the task.

    [Creates task directory: 02-01-google-oauth-auth]
    [Creates initial PRD with: Goal = Google OAuth authentication]

    Next question: What should happen after login?

    1. **Redirect to dashboard** - Main app view
    2. **Redirect to previous page** - Return where they came from
    3. **Stay on current page** - Refresh with logged-in state

User: Redirect to previous page

AI: [Updates PRD: adds redirect behavior to Requirements]

    One more: What user data do we need to store?

    1. **Minimal** - Just email and name from Google
    2. **Profile** - Email, name, and avatar
    3. **Extended** - Above plus custom profile fields

User: Just minimal for now

AI: [Updates PRD: adds data storage requirement]

    Here's my understanding of the complete requirements:

    **Goal**: Add Google OAuth authentication

    **Requirements**:
    - Google OAuth login only (no email/password)
    - Store minimal user data (email, name)
    - Redirect to previous page after login

    **Acceptance Criteria**:
    - [ ] User can click "Login with Google" button
    - [ ] Google OAuth flow completes successfully
    - [ ] User data is stored in database
    - [ ] User is redirected to previous page after login
    - [ ] Logout clears session

    Does this look correct? If yes, I'll proceed with implementation.
```

**Note**: Task was created after the first question, when we knew "Google OAuth" -
giving us a meaningful title instead of just "authentication".

---

## Related Commands

| Command | When to Use |
|---------|-------------|
| `/trellis:start` | Entry point that triggers brainstorm |
| `/trellis:finish-work` | After implementation is complete |
| `/trellis:update-spec` | If new patterns emerge during work |
