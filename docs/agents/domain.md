# Domain docs

This repository uses a **single-context** layout: one root `GLOSSARY.md` for shared domain vocabulary and the existing `docs/adr/` directory for decisions. Package boundaries do not require separate glossaries.

## Before exploring or designing a change

- Read the root `GLOSSARY.md` when it exists.
- For plugin store work, read `CONTEXT.md`. It remains the authoritative source for plugin store terms; reference its definitions rather than copying them into another glossary.
- Read relevant ADRs in `docs/adr/`, including their status. A proposed ADR records a proposal, not an accepted decision.

When a glossary does not exist, continue with the available context. `/domain-modeling` creates `GLOSSARY.md` only when the first new term is resolved. Keep the existing `CONTEXT.md` and ADRs in place.

## Vocabulary and decisions

- Use canonical domain terms in issues, specs, proposals, hypotheses, and test names. Follow the glossary's avoided-synonym rules.
- Record resolved shared vocabulary in `GLOSSARY.md`; keep it focused on domain definitions.
- Record qualifying architectural decisions in `docs/adr/`, following `.agents/skills/domain-modeling/ADR-FORMAT.md`. Scan the existing ADR numbers and increment the highest number.
- Surface conflicts with existing definitions or ADRs explicitly, with the reason for revisiting them.
