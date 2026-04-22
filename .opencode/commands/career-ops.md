---
description: AI job search command center -- show menu or evaluate job description
---

Career-ops router. Arguments provided: "$ARGUMENTS"

If arguments contain a job description or URL (keywords like "responsibilities", "requirements", "qualifications", "about the role", "http", "https"), the skill will execute auto-pipeline mode.

For auto-pipeline runs that reach PDF generation, prefer the built-in `/career-ops-pdf` flow so resume tailoring and resume QA run as separate visible subagents instead of inline.

Otherwise, the discovery menu will be shown.

Load the career-ops skill:
```
skill({ name: "career-ops" })
```
