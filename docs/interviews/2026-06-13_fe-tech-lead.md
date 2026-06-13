## Capture Sheet

| Field | Entry |
|---|---|
| Role / seniority / team size | FE Tech Lead / Senior / 10 in squad, 500 engs in org |
| % AI-heavy PRs (their guess) | 95% |
| Rubber-stamp moment (verbatim) | "An eng with 3 YoE submitted a PR with large FE changes in one PR. He didn't split the story into subtasks which didn't help him have a resulting small PR. I stopped 5 minutes in after seeing many anti-patterns, eslint ignore comments to try to bypass violations and tons of unstable useEffects.
I left some comments initially but left them as pending. DMd him and asked him if he went over his code before submitting it for review, he said not fully. Told him to go over it and try to identify why it is foing things wrong
" |
| Failure story — visible in diff? | "In another squad, someone used an array as a default prop value for a component, resulting in constant rerenders due to reference changes - the default array prop was unsatable. It was visibile in the diff but someone still approved. Of course here, it is not directly AI-related, it could've happened pre-AI since the reviewer wither didn't spot it or did not have proper React knowledge" |
| Coping under pressure | "If I have a 600-line PR to review in 20 minutes, I first try to identify the main files with the core pieces of logic and focus on them, trying to ignore nitpicks, once then I dedicate time for any tests and then as a last priority address nits". |
| Skill-atrophy mentioned spontaneously? | Mixed. Pure coding, potentially yes; Engineering as a whole, no. AI, in the right hands, forces you to be an orchestrator and designer of solutions, allow you to have a higher-level system thinking while allowing you to dive deep into details, all due to the coding part being much much faster |
| Re-review pain: vivid / mild / none | Vivid but dependent on team culture, if you are harsh but honest and enforce good practices, you can have good cadence and enforce rules that reduce code review iterations. For small new commits (nits etc), I review ust the new commit, otherwise, the entire PR |
| Tools used + honest relationship | Cursor as a harness, OpenSpec for both design, planning and documentation, Unblocked as a supporting context engine and code reviwer. Found Unblocked to be pretty good if the domain is in the engine and the repo has a clear lightweight AGENTS.md file. I never ignore it and use it to confirm or push back, other devs mostly accept blindly. |
| Linear reaction (verbatim) | Haven't used, we're a Jira company |
| Artifact reaction: grabbed / polite | "Cool mockup and the idea of groupinh by story and intent is nice but the whole playbook thing on the side might be just unnecessary noise. Why do I need to read all of this if this is trivial and just creates noise? By the time I read the playbook, I can already review the PR. Maybe this is more helpful for more junior engs. The rest might be nice though but it's hard for me to justify the benefit for a team with mostly experienced engs. Unless, the grouping is more substantial with larger and mroe complex PR - this example is small with one group. I do like the idea of having your own space but what benefit does it have over a pending review you don't submit? is there any use for historical context? Do you use this as data? Not sure how this helps in the real world" |
| Spontaneous wedge mentions (see below) |intent-tagging / change-type structure, per-change-type checklists or review structure, a private place to think through a review |
| Referrals given | None |

**Spontaneous wedge mentions checklist** (`next-steps.md` validation requirement — count ONLY if unprompted, before section 7):
- [x] intent-tagging / change-type structure
- [x] per-change-type checklists or review structure
- [x] a private place to think through a review
- [ ] a record/receipt of what was actually verified
- [ ] "better bug catching" instead ← if this dominates, investigate: wedge wrong, or right-but-described-differently?