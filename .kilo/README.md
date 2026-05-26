# Kilo Code Configuration Recovery Guide

This directory (`.kilo/`) contains the **project-specific configuration** for Kilo Code's Agent Manager and custom agents.

## Why This Matters

When the Kilo Code extension is uninstalled, reinstalled, or you open the project on a fresh machine/clone, the extension will re-read this directory on next startup.

If the important files below are committed to git, your entire setup (personas, rules, scripts, model strategy) survives and reloads automatically.

## What Must Always Be Committed to Git

These files define your team's way of working and **must** be in the repository:

- `kilo.json` — Project-level agent definitions and permissions
- `personas/` — All custom personas (reviewer, planner, doc-agent, payroll-guardian, etc.)
- `rules/` — Short injectable guardrail files
- `setup-script` and `run-script` — Worktree bootstrap automation
- `MODEL_STRATEGY.md` — The official model routing policy for this project
- Important shared plans in `plans/` (the coordination documents referenced in AGENTS.md)
- This `README.md`

## What Should NOT Be Committed

These are transient and are already excluded by `.kilo/.gitignore`:

- `agent-manager.json` — Current sessions and UI state
- `worktrees/` — Actual checked-out worktrees (heavy and local)
- `node_modules/` and lockfiles — The Kilo runtime

## How to Recover After Extension Reinstall or Fresh Clone

1. Make sure you have the latest code from the repo (the `.kilo/` config files must be present).
2. Open the folder in VS Code.
3. Install / re-enable the Kilo Code extension.
4. The extension will automatically detect `.kilo/kilo.json`, the personas, rules, and scripts.
5. Your custom agents and worktree automation should be available immediately in the sidebar and Agent Manager.
6. If using Multi-Version Mode or sections, you may need to recreate sections manually (they are lightweight UI state).

## Recommended Workflow After Major Config Changes

After editing personas, rules, scripts, or `kilo.json`:

```bash
git add .kilo/personas/ .kilo/rules/ .kilo/setup-script .kilo/run-script .kilo/kilo.json .kilo/MODEL_STRATEGY.md
git commit -m "kilo: update personas and model strategy"
```

Then push so the whole team benefits.

## Additional Safety Tips

- Never delete the `.kilo/` directory.
- If you see the extension complaining about missing personas or scripts after reinstall, run:
  ```bash
  git status .kilo/
  ```
  and restore any missing tracked files.
- The global Kilo settings (in `~/.config/kilo/`) are machine-specific. Only project-level config in this repo is portable.

This structure was deliberately designed after losing configuration in the past. Committing these files is the only reliable way to make the setup survive extension removal, reinstall, or moving between machines.

## Delivery

The initial hardening of this setup (personas, rules, scripts, MODEL_STRATEGY, and this recovery guide) was delivered in:
https://github.com/torosasik/TimeTrack/pull/6

Once that PR is merged, the protection is active for the whole team.
