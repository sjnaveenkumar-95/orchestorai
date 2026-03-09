---
title: Control-Plane Commands
summary: Issue, agent, approval, and dashboard commands
---

Client-side commands for managing issues, agents, approvals, and more.

## Issue Commands

```sh
# List issues
pnpm orchestorai issue list [--status todo,in_progress] [--assignee-agent-id <id>] [--match text]

# Get issue details
pnpm orchestorai issue get <issue-id-or-identifier>

# Create issue
pnpm orchestorai issue create --title "..." [--description "..."] [--status todo] [--priority high]

# Update issue
pnpm orchestorai issue update <issue-id> [--status in_progress] [--comment "..."]

# Add comment
pnpm orchestorai issue comment <issue-id> --body "..." [--reopen]

# Checkout task
pnpm orchestorai issue checkout <issue-id> --agent-id <agent-id>

# Release task
pnpm orchestorai issue release <issue-id>
```

## Company Commands

```sh
pnpm orchestorai company list
pnpm orchestorai company get <company-id>

# Export to portable folder package (writes manifest + markdown files)
pnpm orchestorai company export <company-id> --out ./exports/acme --include company,agents

# Preview import (no writes)
pnpm orchestorai company import \
  --from https://github.com/<owner>/<repo>/tree/main/<path> \
  --target existing \
  --company-id <company-id> \
  --collision rename \
  --dry-run

# Apply import
pnpm orchestorai company import \
  --from ./exports/acme \
  --target new \
  --new-company-name "Acme Imported" \
  --include company,agents
```

## Agent Commands

```sh
pnpm orchestorai agent list
pnpm orchestorai agent get <agent-id>
```

## Approval Commands

```sh
# List approvals
pnpm orchestorai approval list [--status pending]

# Get approval
pnpm orchestorai approval get <approval-id>

# Create approval
pnpm orchestorai approval create --type hire_agent --payload '{"name":"..."}' [--issue-ids <id1,id2>]

# Approve
pnpm orchestorai approval approve <approval-id> [--decision-note "..."]

# Reject
pnpm orchestorai approval reject <approval-id> [--decision-note "..."]

# Request revision
pnpm orchestorai approval request-revision <approval-id> [--decision-note "..."]

# Resubmit
pnpm orchestorai approval resubmit <approval-id> [--payload '{"..."}']

# Comment
pnpm orchestorai approval comment <approval-id> --body "..."
```

## Activity Commands

```sh
pnpm orchestorai activity list [--agent-id <id>] [--entity-type issue] [--entity-id <id>]
```

## Dashboard

```sh
pnpm orchestorai dashboard get
```

## Heartbeat

```sh
pnpm orchestorai heartbeat run --agent-id <agent-id> [--api-base http://localhost:3100]
```
