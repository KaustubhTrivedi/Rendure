# STAR+R Story Bank

This is a fictional example file. Copy it to `interview-prep/story-bank.md` and replace it with your own stories.

## How to use

- Keep 5-10 reusable stories.
- Focus on concrete actions and measurable outcomes.
- Add one reflection line per story so future interview prep stays sharp.

## Stories

### [Ownership] Stabilizing a failing release
**S (Situation):** A customer-facing release introduced regressions across a core onboarding flow.
**T (Task):** Restore stability quickly without hiding root causes.
**A (Action):** Coordinated triage, rolled back the riskiest change, added missing tests, and split follow-up fixes into smaller deployable patches.
**R (Result):** Restored the flow the same day and reduced repeat incidents in the following sprint.
**Reflection:** Fast recovery matters, but documenting the learning prevents the same class of failure later.

### [Performance] Reducing latency in a reporting API
**S (Situation):** Internal reporting pages were timing out during peak usage.
**T (Task):** Improve performance without changing the user workflow.
**A (Action):** Profiled slow queries, added indexes, and precomputed a subset of heavy aggregates.
**R (Result):** Cut median response time by more than 40% and eliminated timeout complaints.
**Reflection:** The best performance work targets real bottlenecks seen by real users.
