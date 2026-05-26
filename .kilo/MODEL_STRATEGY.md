# TimeTrack Kilo Agent Manager — Model Strategy (May 2026)

**Goal:** Use the right model for the job inside Kilo's Agent Manager so we get maximum quality for planning/review while keeping parallel implementation work affordable and fast.

## Recommended Role → Model Mapping

| Role / Task Type                  | Recommended Model                          | Why |
|-----------------------------------|--------------------------------------------|-----|
| Manager / Orchestrator / Architect / Planner | `anthropic/claude-opus-4.7` (or `kilo-auto/frontier`) | Best long-horizon reasoning, multi-agent orchestration, "dreaming" (self-improvement across sessions), and strict instruction following. Essential for enforcing AGENTS.md invariants on complex payroll logic. |
| Code Reviewer (read-only)         | `anthropic/claude-opus-4.7` or `kilo-auto/frontier` | Highest fidelity when catching overtime math, audit, timezone, or segment model violations. |
| Implementation (feature work, refactors) | `anthropic/claude-sonnet-4.6` (primary)   | Kilo's default for `code`/`build`/`explore`. Excellent balance of quality and speed. |
| Long-context analysis / large doc synthesis | `google/gemini-3.1-pro`                    | 1M+ context, fast, cheaper than Opus. Great for ingesting entire `docs/planning/`, Firestore rules, or overtime calculation files. |
| Parallel experiments (Multi-Version Mode) | Mix: Opus (1), Sonnet (1), Gemini 3.1 Pro (1), DeepSeek V4 Pro (1) | Run 4 versions of the same risky change (e.g. overtime calc refactor) in isolated worktrees and diff the results cheaply. |
| Budget / high-volume / test generation | `deepseek/deepseek-v4-pro` or `deepseek/deepseek-v4-flash` | ~20-30× cheaper than Opus while still frontier-class on coding benchmarks. Perfect for worker swarm. |
| Fast summarization / read-heavy   | `google/gemini-2.5-flash` or Kilo fast tier | Cheap, fast, good enough for many review or planning-support tasks. |

## How to Use in Agent Manager

1. **Multi-Version Mode** (the killer feature for this project)
   - Click the multi-version button.
   - Enter the same prompt.
   - Assign different models per version.
   - Use the diff panel (`Cmd+D` / `Ctrl+D`) to compare.
   - Winner gets "Apply to local" or merged via normal PR.

2. **Sections** (recommended layout)
   - 📁 Payroll Core (overtime, segments, daily/weekly totals)
   - 📁 HR Features (leave, holidays, approvals)
   - 📁 Admin & Audit (corrections, immutable logs, reports)
   - 📁 Security & Rules (Firestore rules, permissions)
   - 📁 Infra / Staging (deployment, emulator, CI)

3. **Personas** (always load via sidebar or instructions)
   - Use `reviewer`, `planner`, `doc-agent`, and `payroll-guardian` personas defined in `.kilo/personas/`.
   - These hard-enforce `AGENTS.md` and the four critical rules in `.kilo/rules/`.

4. **Long-running / multi-day work**
   - Start the session in a worktree.
   - Close VS Code when you want the agent to "sleep".
   - Reopen later — Gemini's thought preservation + Claude's dreaming help continuity.
   - Use the existing merge-order discipline from prior planning runs (never merge everything at once).

## Cost & Performance Guidelines

- **Manager + Reviewer** work almost exclusively on Opus 4.7 (or auto/frontier). This is the expensive but necessary brain.
- **All implementation workers** default to Sonnet 4.6 or Gemini 3.1 Pro.
- When running 3–4 parallel versions, at least two should be on DeepSeek or Gemini Flash.
- Target: a typical feature cycle (planning + 3 parallel impls + review + doc update) should stay well under the cost of running everything on Opus.

## Fallback & Resilience

- Global config already registers DeepSeek as fallback provider.
- If primary provider is rate-limited or expensive, manually switch worker agents to `deepseek/deepseek-v4-pro` or `google/gemini-2.5-flash`.
- For very long context ingestion, Gemini is currently the most reliable and cost-effective.

## When to Re-evaluate

- Quarterly (or when Kilo auto-tiers change).
- After major new releases (Claude 4.8, Gemini 3.5 Flash, new DeepSeek, etc.).
- When we add expensive new MCPs or the scope of "continuous work" grows (e.g. true 24/7 background payroll agents — then evaluate moving orchestration to Gemini Enterprise Agent Platform while keeping Kilo for IDE work).

**This strategy directly supports the sophisticated multi-agent worktree patterns the team already uses (see brave-garden plan and existing worktrees) while making them repeatable, cheaper, and higher quality.**
