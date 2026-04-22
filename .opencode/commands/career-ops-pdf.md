---
description: Generate ATS-optimized CV PDF
---

Generate an ATS-optimized CV using career-ops pdf mode with explicit subagents.

Arguments provided: "$ARGUMENTS"

Workflow:

1. Load the `career-ops` skill.
2. Read the repo instructions needed for PDF mode: `CLAUDE.md`, `modes/_shared.md`, `modes/_profile.md`, `modes/pdf.md`, `cv.yaml`, `config/profile.yml`.
3. Resolve the JD from `$ARGUMENTS`.
4. Launch a `general` subagent for Stage 1 tailoring. Its only job is to run the resume tailor workflow from `modes/pdf.md` and return only the tailored RenderCV YAML.
5. Launch a second `general` subagent for Stage 2 QA. Its only job is to run the resume QA workflow from `modes/pdf.md` against the Stage 1 YAML and return structured QA feedback.
6. If QA says another pass is needed, launch the tailoring subagent again with the QA feedback, then re-run the QA subagent. Stop when `jd_to_resume_score >= 90`, or `>= 80` with no high-priority issues, or after 4 total passes.
7. Write the final YAML to `output/` and render the PDF according to `modes/pdf.md`.
8. Report the final YAML path, PDF path, QA keyword coverage score, and JD-to-resume score.

Important:

- Use the `Task` tool so the tailoring and QA work shows up as separate subagent activity.
- Do not fabricate resume content.
- Keep the orchestration in the main agent, but delegate the actual tailoring and QA analysis to separate subagents.

Load the career-ops skill:
```
skill({ name: "career-ops" })
```
