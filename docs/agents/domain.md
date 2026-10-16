# Domain docs

Use a **single-context** layout: a root `GLOSSARY.md` for domain vocabulary and `docs/adr/` for architectural decisions accepted or proposed for this fork. Create them only when there is a resolved term or a qualifying decision to record.

## Before exploring or designing a change

- Establish current behavior from the checked-out source, contracts, and tests.
- Read the root `GLOSSARY.md` when it exists.
- Read relevant ADRs in `docs/adr/` when the directory exists, including their status. A proposed ADR records a proposal, not an accepted decision.

When a glossary or ADR directory does not exist, continue silently with the available context. `/domain-modeling` creates them lazily as terms or decisions are resolved.

## Vocabulary and decisions

- Use canonical domain terms in issues, specs, proposals, hypotheses, and test names. Follow the glossary's avoided-synonym rules.
- Record resolved vocabulary in `GLOSSARY.md`; keep it focused on domain definitions.
- Record decisions made for this fork in `docs/adr/`, following `.agents/skills/domain-modeling/ADR-FORMAT.md`. Increment the highest existing ADR number, starting at `0001` when there are no ADRs.
- Surface conflicts with existing definitions or ADRs explicitly, with the reason for revisiting them.
