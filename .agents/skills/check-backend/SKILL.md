---
name: check-backend
description: "Check if the code you just wrote follows the backend development guidelines."
---

Check if the code you just wrote follows the backend development guidelines.

Execute these steps:
1. Run `git status` to see modified files
2. Read `.trellis/spec/cli/backend/index.md` to understand which guidelines apply
3. Based on what you changed, read the relevant guideline files:
   - Database changes → `.trellis/spec/cli/backend/database-guidelines.md`
   - Error handling → `.trellis/spec/cli/backend/error-handling.md`
   - Logging changes → `.trellis/spec/cli/backend/logging-guidelines.md`
   - Type changes → `.trellis/spec/cli/backend/type-safety.md`
   - Any changes → `.trellis/spec/cli/backend/quality-guidelines.md`
4. Review your code against the guidelines
5. Report any violations and fix them if found
