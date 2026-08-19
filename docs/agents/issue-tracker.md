# Issue tracker: GitHub

Issues and specifications for this repository live in GitHub Issues at `ccfii-engineering/ccfii-free-show`. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body-file <path>`.
- **Read an issue**: `gh issue view <number> --comments`, including labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments` with appropriate filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`.
- **Apply or remove labels**: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`.
- **Close an issue**: `gh issue close <number> --comment "..."`.

Infer the repository from the current Git remote when operating inside this clone.

## Publishing

When a skill says to publish a specification, PRD, or ticket to the issue tracker, create a GitHub issue.
