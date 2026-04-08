# Prek Audit Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent commits and pushes from checking in dependency states with any npm vulnerabilities by routing Git hooks through `prek`.

**Architecture:** Add a repo-local `prek` config with a single local hook that runs `npm audit --audit-level=low` so any reported vulnerability fails the hook. Wire `prek install` into package scripts for easy setup, and document the workflow in the README so contributors know how the gate is enforced.

**Tech Stack:** YAML, npm scripts, `prek`, npm audit

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `.pre-commit-config.yaml` | Create | Configure `prek` hooks for pre-commit and pre-push audit checks |
| `package.json` | Modify | Add a helper script to install the Git hooks |
| `README.md` | Modify | Document the new `prek`-based dependency gate and setup command |

---

### Task 1: Add The Prek Hook Configuration

**Files:**
- Create: `.pre-commit-config.yaml`

- [ ] **Step 1: Write the hook config**

```yaml
repos:
  - repo: local
    hooks:
      - id: npm-audit
        name: npm audit
        entry: npm audit --audit-level=low
        language: system
        always_run: true
        pass_filenames: false
        stages: [pre-commit, pre-push]
```

- [ ] **Step 2: Validate the config**

Run: `prek validate-config`
Expected: success with no config errors.

### Task 2: Add A Hook Install Script

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the install script**

```json
{
  "scripts": {
    "test": "vitest run",
    "lint": "biome check .",
    "check": "biome check . && vitest run",
    "hooks:install": "prek install"
  }
}
```

- [ ] **Step 2: Verify the script is wired correctly**

Run: `npm run hooks:install`
Expected: `prek installed at '.git/hooks/pre-commit'` and `prek installed at '.git/hooks/pre-push'`.

### Task 3: Document The New Safety Check

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a short hooks section**

```md
## Local Git Hooks

This repo uses `prek` to install a local hook that runs `npm audit --audit-level=low` before commits and pushes.

Install the hooks with:

```bash
npm run hooks:install
```

Any reported npm vulnerability fails the hook, so dependency issues are caught before they can be checked in.
```

- [ ] **Step 2: Check the README renders cleanly**

Run: `npm run lint`
Expected: no markdown or formatting errors from the documentation update.
