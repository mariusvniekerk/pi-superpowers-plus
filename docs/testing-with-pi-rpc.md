# Testing With Pi RPC

Use this when you want to verify this package inside a real `pi` process without permanently installing it into your normal Pi environment.

## Preferred One-Shot Validation

For repo-level validation, load the package directly from the checkout and disable normal extension discovery:

```bash
TMP_HOME="$(mktemp -d)"
HOME="$TMP_HOME" \
pi --mode rpc --no-session --no-extensions -e /absolute/path/to/pi-superpowers-plus
```

Why this is the preferred path:
- it loads this checkout only
- it avoids conflicts with globally installed Pi packages
- it does not modify your normal `~/.pi/agent` state
- it exercises Pi's real package/resource loading path

`--no-extensions` matters. Without it, Pi will also load globally installed extensions and packages, which can produce false failures from duplicate tools or commands.

## What To Check Over RPC

After starting RPC mode, send:

```json
{"id":"cmds","type":"get_commands"}
```

Expected signals:
- extension commands from this package are present:
  - `workflow-reset`
  - `workflow-next`
  - `agents`
  - `run`
  - `chain`
  - `parallel`
  - `subagents-status`
- workflow skills from this package are present as `skill:*`

Then invoke one extension command to prove the package is not just discoverable, but executable:

```json
{"id":"reset","type":"prompt","message":"/workflow-reset"}
```

Expected signals:
- `{"type":"extension_ui_request","method":"setWidget",...}`
- `{"type":"extension_ui_request","method":"notify",...}`
- successful `prompt` response

This is enough to prove:
- Pi loaded the package
- the extensions registered correctly
- skills/commands are discoverable over RPC
- extension command execution works in RPC mode

## Testing Agent Sync

If you also want to verify the `pi-subagents-agent-sync` behavior, use a clean temporary `HOME` and inspect the synced agent directories after startup:

```bash
find "$TMP_HOME/.pi/agent/agents" "$TMP_HOME/.agents" -maxdepth 1 -type f 2>/dev/null
```

Expected files include:
- `spx-implementer.md`
- `spx-worker.md`
- the rest of the managed `spx-*` agent set

Expected directory behavior:
- if `"$TMP_HOME/.agents"` already exists, sync writes there
- otherwise sync writes to `"$TMP_HOME/.pi/agent/agents"`

This validates that `session_start` triggered the sync extension and that the managed agents were written to the effective user-agent directory upstream discovery scans.

## When To Use `pi install`

Use `pi install` only when the thing you are testing is actual install behavior:
- project-local settings wiring
- package manager integration
- install/update/remove behavior
- interaction with normal Pi package configuration

For example:

```bash
TMP_HOME="$(mktemp -d)"
HOME="$TMP_HOME" pi install /absolute/path/to/pi-superpowers-plus -l
```

That is useful for install-path testing, but it is not the best first-line validation for package behavior during development.

## Failure Mode To Avoid

Do not combine:
- a repo checkout loaded directly, and
- an already-installed global/project package for the same repo

That can produce misleading conflicts such as:
- `Tool "plan_tracker" conflicts ...`
- `Tool "workflow_reference" conflicts ...`
- `Tool "subagent" conflicts ...`

Those are environment collisions, not necessarily package regressions.

## Model-Backed Runs

The RPC checks above prove package loading and extension execution. They do **not** prove a full model-backed agent run.

If you need end-to-end validation of subagent behavior:
1. start from the same clean `HOME` + `--no-extensions -e ...` setup
2. make sure that Pi has usable auth/model configuration in that environment
3. run a real prompt or subagent command
4. verify the resulting agent/tool behavior, not just command discovery

Use the lightweight RPC checks for package-load validation.
Use a model-backed run only when you specifically need end-to-end runtime assurance.
