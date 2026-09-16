# Break the Loop — Post-Fix Analysis

Use after fixing a bug — especially one that took multiple attempts — to keep this class of bug from coming back.

## Analyze

1. **Root cause category** — missing spec / cross-layer contract / change-propagation failure / test-coverage gap / implicit assumption
2. **Why earlier fixes failed** (if it took several tries) — surface fix, partial scope, wrong layer, tool blind spot
3. **Prevention** — what makes this impossible or loud next time: doc, type, test, checklist
4. **Blast radius** — where else does the same bug shape live?

## Then Act

Update the file that would have prevented it:

- Cross-layer issue → `.trellis/spec/guides/cross-layer-thinking-guide.md`
- Cross-platform issue → `cross-platform-thinking-guide.md`
- Reuse issue → `code-reuse-thinking-guide.md`
- Domain issue → `.trellis/spec/<package>/<layer>/*.md`

The analysis is worthless if it stays in chat — the spec update is the deliverable. Commit it with the fix.
