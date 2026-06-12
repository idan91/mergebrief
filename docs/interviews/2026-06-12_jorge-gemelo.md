### Capture Sheet 

| Field | Entry |
|---|---|
| Role / seniority / team size | Mid-level SWE / 5 years total (1 yr agentic) / 100-person startup (50 eng, 5-person squad) |
| % AI-heavy PRs (their guess) | "Easily 80-85%. Everything has at least some Cursor autocomplete or Claude scaffolding now." |
| Rubber-stamp moment (verbatim) | "Once I hit the third file of Cursor-generated DTOs and interface mappers, my eyes just glazed over. I spent maybe 3 minutes on the actual webhook handler logic, then literally just scrolled to the bottom and hit approve on the other 400 lines of setup." |
| Failure story — visible in diff? | Yes, a subtle off-by-one error in a billing cycle date calculation. The AI used extremely plausible, clean-looking variable names (`calculateNextBillingCycle`), which masked the logic flaw. Would have required pulling the branch down and running edge cases locally to catch it. |
| Skill-atrophy mentioned spontaneously? | yes / "I do worry about the newer devs. I feel like our juniors aren't learning the domain models anymore. They just highlight errors, prompt 'fix the types,' and merge it without understanding how the data actually flows." |
| Re-review pain: vivid / mild / none | Vivid. Mentioned a time a squadmate used Cursor to apply a requested PR comment fix, and the agent "helpfully" refactored a shared utility function in the same commit. Jorge only reviewed the delta for the specific fix and missed the unrelated change, which broke staging. |
| Tools used + honest relationship | CodeRabbit. "It's mostly noise, honestly. I skim it and auto-resolve the standard linting or 'consider extracting this' comments. It's okay for syntax, but it fundamentally never catches actual business logic flaws." |
| Linear reaction (verbatim) | "Yeah, we live in Linear. I've seen the Diffs beta. It's aesthetically really nice and fast, but honestly, it doesn't solve the core problem. It makes the code easier to read, but it doesn't tell me which parts of this 800-line PR actually matter and which parts are just AI boilerplate." |
| Artifact reaction: grabbed / polite | Grabbed. Immediately ignored the top summary paragraph and clicked straight into the categorized groupings, specifically focusing on the "Logic Changes" bucket while ignoring the "Boilerplate/Scaffolding" bucket. |
| Spontaneous wedge mentions (see below) | [x] intent-tagging / change-type structure ("I just want a button that hides the AI scaffolding and shows me the human decisions.") |
| Referrals given | "You should definitely talk to Sarah, our Staff Engineer. She's the one usually acting as the backstop when these massive AI-generated PRs go sideways." |

**Spontaneous wedge mentions checklist**:
- [x] intent-tagging / change-type structure
- [ ] per-change-type checklists or review structure
- [ ] a private place to think through a review
- [ ] a record/receipt of what was actually verified
- [ ] "better bug catching" instead