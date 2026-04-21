# Mode: pdf — RenderCV Resume Generation

## Pipeline

1. Read `cv.yaml` as the base resume (source of truth)
2. Read `config/profile.yml` for candidate name
3. Get the JD — from context, pasted text, or URL
4. Detect paper format from company location: US/Canada → `letter`, elsewhere → `a4`
5. Run **Stage 1: Tailoring Agent** → produce tailored YAML
6. Add `design: theme: sb2nov` to the YAML (preserve if already present)
7. Write YAML to `/tmp/cv-{candidate}-{company}.yaml`
8. Run **Stage 2: QA Agent** → audit the YAML against the JD
9. Apply all high-priority improvements to the YAML in-place
10. Run: `rendercv render /tmp/cv-{candidate}-{company}.yaml -d {abs_project_root}/design.yaml --pdf-path {abs_output_path} --dont-generate-markdown`
11. Report: PDF path, QA keyword coverage score
12. Update tracker: change PDF column from ❌ to ✅ if offer is already registered

Where:
- `{candidate}` = `cv.name` from profile.yml normalized to kebab-case lowercase (e.g. "Alex Chen" → "alex-chen")
- `{company}` = company name slug from the JD
- `{abs_output_path}` = absolute path to `output/cv-{candidate}-{company}-{YYYY-MM-DD}.pdf`

---

## Stage 1 — Tailoring Agent

You are an expert resume optimization system designed to produce a **highly skimmable, recruiter-friendly, ATS-optimized RenderCV YAML resume**.

Your output must remain **fully grounded in the provided base resume** and must not fabricate experience.

Recruiters typically spend **3–5 seconds** scanning a resume initially. The resume must allow them to immediately understand:

- What the candidate does
- Their primary technologies
- Their impact and seniority

### Stage 1a — Job Requirement Extraction

From the job description extract:

- `required_technologies`
- `preferred_technologies`
- `responsibilities`
- `domain_keywords`
- `soft_skills`
- `experience_level`

### Stage 1b — Resume Capability Mapping

From the base YAML identify:

- `programming_languages`
- `frameworks`
- `backend_technologies`
- `infrastructure_tools`
- `domains`
- `notable_achievements`

Then determine:

- `strong_matches` — skills/experiences that clearly satisfy JD requirements
- `partial_matches` — hints at capability that could be made more explicit
- `missing_keywords` — important JD terms absent from the base resume

### Stage 1c — Keyword Gap Analysis

Identify JD keywords missing from the base resume.

Missing keywords may appear **only** in:
- Skills section (under a "Familiar With" label)
- `profile` summary (neutral phrasing: "Familiar with", "Exposure to", "Currently exploring")

They must **NOT** appear inside experience bullet points.

### Stage 1d — Skimmable Resume Generation

Generate the tailored RenderCV YAML following these rules:

**Profile summary rules:**
- Clearly state: primary role, years/level of experience, core technology stack
- Inject strong JD keyword matches naturally
- Example structure: "Software Engineer specializing in [domain]. Experienced in [tech stack], with a track record of [impact]."

**Bullet rules (ACTION + TECH + IMPACT):**
- Maximum 1–2 lines per bullet
- Lead with a strong verb
- Put important technologies early in the sentence
- Order bullets within each role: 1) relevance to JD, 2) measurable impact, 3) technical complexity
- Do not alter metrics
- Do not fabricate any technology, project, or responsibility

**Skills section structure:**
- Programming Languages
- Backend & Frameworks
- Frontend
- Infrastructure & DevOps
- Databases
- Testing & Quality
- Methodologies
- Familiar With ← only section that may contain technologies not in the base resume

**ATS rules:**
- Distribute important JD keywords across: profile summary, skills section, experience bullets (only if grounded)
- Avoid keyword stuffing
- Use exact terminology from the JD where possible (e.g. if JD says "RAG pipelines", use "RAG pipelines" not "retrieval workflows")

**Output:** Return only the complete RenderCV YAML. No explanations, no markdown fences, no analysis output.

---

## Stage 2 — QA Agent

You are a resume quality assurance and ATS audit system. Analyze the tailored YAML against the job description across five dimensions.

### QA Step 1 — Alignment Analysis

Compare JD requirements vs resume signals:

- `strong_matches` — clearly matching skills/experience
- `partial_matches` — hinted but could be stronger
- `missing_keywords` — important JD terms absent from the resume
- `weak_signals` — relevant experience that is undersold

### QA Step 2 — ATS Check

- `keyword_coverage_score` (0–100 estimate)
- `missing_ats_keywords` — JD keywords that should appear somewhere
- `keyword_placement_issues` — keywords buried or poorly placed
- `keyword_stuffing_risk` — unnatural repetition

### QA Step 3 — Scannability Test

Simulate a 3–5 second recruiter scan:

- `3_second_impression` — what a recruiter immediately infers
- `clarity_of_role_identity` — is the candidate's role obvious?
- `tech_stack_visibility` — are key technologies immediately visible?
- `bullet_quality_issues` — bullets that are too long, vague, missing tech, or missing impact

### QA Step 4 — Improvement Instructions

Provide structured instructions for improving the resume:

- `high_priority_changes` — structural fixes with significant impact
- `medium_priority_changes` — alignment improvements
- `keyword_insertion_opportunities` — where missing keywords could be safely added
- `bullet_rewrite_targets` — specific bullets to rewrite (ACTION + TECH + IMPACT pattern)
- `summary_improvement_advice`
- `skills_section_improvements`

**Rules:**
1. Do not fabricate information
2. Do not rewrite the entire resume — provide targeted instructions only
3. Every suggestion must be actionable and grounded

---

## Post-QA Revision

After the QA agent completes, apply **all high-priority changes** to the YAML:

- Rewrite flagged bullets following `ACTION + TECH + IMPACT`
- Insert missing ATS keywords in safe locations (skills section or summary only)
- Improve summary if flagged
- Restructure skills section if flagged

Then write the final YAML to `/tmp/cv-{candidate}-{company}.yaml` and render.

---

## Rendering

```bash
rendercv render /tmp/cv-{candidate}-{company}.yaml \
  -d /absolute/path/to/career-ops/design.yaml \
  --pdf-path /absolute/path/to/career-ops/output/cv-{candidate}-{company}-{YYYY-MM-DD}.pdf \
  --dont-generate-markdown
```

Use the absolute path to `design.yaml` in the project root. Do not embed a `design` block in the tailored YAML.

---

## Post-Generation

- Report: PDF path + QA keyword coverage score
- Update tracker if the offer is already registered: change PDF column ❌ → ✅
- Save the tailored YAML alongside the PDF as `output/cv-{candidate}-{company}-{YYYY-MM-DD}.yaml` for future reference
