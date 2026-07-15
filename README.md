# opencode-costs

Show LLM costs and token usage per agent in OpenCode sidebar.

![OpenCode costs sidebar](screenshot.png)

## Why

OpenCode shows total token usage per session, which works fine when you have a single agent.
But once you start working with multiple agents — a planner that delegates to a backend-dev,
a frontend-dev, a reviewer, and a scriber — you lose visibility into who's spending what.

This plugin breaks down costs **per agent**, so you can see at a glance which agents
are the most expensive, where token usage piles up, and whether your delegation strategy
is cost-effective.

## What it looks like

```
Costs  $0.615764  549.6K tok
qa  $0.137073  53.2K tok  (1)
scriber  $0.110440  55.1K tok  (1)
backend-dev  $0.104367  53.2K tok  (1)
frontend-dev  $0.090654  43.3K tok  (1)
plan  $0.082858  235.6K tok  (1)
system-analyst  $0.079053  38.6K tok  (1)
consult  $0.011319  70.7K tok  (1)
```

## Install

1. Open OpenCode
2. Press `Ctrl+P` (or `Cmd+P` on macOS)
3. Select **Install Plugins**
4. Type `opencode-costs` and hit Enter

Done. Costs will appear in the sidebar on your next session.

## How it works

Reads assistant messages from the current OpenCode session tree, groups their cost and
token usage by agent (e.g. `plan`, `build`, `default`), and shows the totals in the
sidebar. Refreshes automatically when sessions are created, updated, or selected.

## Known Limitations

- **Current directory only:** Only sessions from the current project directory are shown.
- **TUI only:** This plugin only works in TUI mode, not CLI.

## License

MIT
