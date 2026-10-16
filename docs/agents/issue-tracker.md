# Issue tracker: GitHub

Issues, specs, and implementation tickets live in GitHub Issues for `aaskfuqw/ZCode`. Use the `gh` CLI from the repository root; pass `--repo aaskfuqw/ZCode` when working outside the clone.

## Issue operations

- Create: `gh issue create --title "<title>" --body-file <body-file>`. Write multiline bodies to a temporary file, preserving actual newlines.
- Read: `gh issue view <number> --json number,title,body,labels,comments,assignees,state`.
- List: `gh issue list --state open --limit 100 --json number,title,body,labels,assignees`; filter with `--label` and adjust the limit or paginate when needed.
- Update a body: `gh issue edit <number> --body-file <body-file>`.
- Comment: `gh issue comment <number> --body-file <body-file>`.
- Apply or remove labels: `gh issue edit <number> --add-label "<label>"` or `--remove-label "<label>"`. Read `docs/agents/triage-labels.md` before applying triage states.
- Assign: `gh issue edit <number> --add-assignee @me`.
- Close: `gh issue close <number> --comment "<reason>"`.
- Link a sub-issue: `gh issue create --parent <parent> ...`, or `gh issue edit <parent> --add-sub-issue <child>`.
- Add blocking: `gh issue edit <child> --add-blocked-by <blocker>`.

When a skill says "publish to the issue tracker", create a GitHub issue. When it says "fetch the relevant ticket", read that issue.

## Pull requests as a triage surface

**PRs as a request surface: no.**

GitHub shares the issue and PR number space. Resolve an ambiguous bare `#<number>` with `gh pr view <number>`, falling back to `gh issue view <number>`.

## Wayfinding operations

Read `.agents/skills/wayfinder/SKILL.md` when charting or resuming a map.

- **Map:** one issue labelled `wayfinder:map`, using the map body from the skill.
- **Child ticket:** a native sub-issue labelled `wayfinder:<type>`, where the type is `research`, `prototype`, `grilling`, or `task`. Create missing `wayfinder:` labels when first needed. These maps and decision tickets use only `wayfinder:` labels.
- **Blocking:** use native issue dependencies via `--add-blocked-by`. If the installed CLI lacks that flag, use `gh api --method POST repos/aaskfuqw/ZCode/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`. Get the numeric database ID with `gh api repos/aaskfuqw/ZCode/issues/<blocker> --jq .id`; it differs from the issue number and node ID.
- **Frontier query:** list the map's children with `gh api --paginate repos/aaskfuqw/ZCode/issues/<map>/sub_issues`. Take open, unassigned children with no open blockers, in map order. Read each child's `issue_dependencies_summary.blocked_by` from the issue API; it counts open blockers.
- **Claim:** assign the child to `@me` before starting work.
- **Resolve:** post the resolution as a comment, close the child, then append a context pointer containing the decision and issue link to the map's Decisions so far section. Preserve the rest of the map body.

If native sub-issues are unavailable, keep an ordered task list in the map and put `Part of #<map>` at the top of each child body. If native dependencies are unavailable, put `Blocked by: #<number>, ...` at the top of each child body and check every blocker's state before claiming it.
