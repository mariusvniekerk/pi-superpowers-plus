# Learnings

## UX Fixes — 2026-02-17

### Subagent `close` vs `exit` events
Node.js `close` event on child processes waits for ALL stdio streams to end — including from grandchild processes that inherit the file descriptors. The `exit` event fires when the process itself terminates. If you're spawning a process that itself spawns children (like `pi` running bash commands), use `exit` or the parent will hang indefinitely.

### Subagents can silently fail
Subagents sometimes return empty output without error. The subagent dispatched for state persistence (Task 7) did partial work (modified files) but didn't commit and returned no output. Always check `git status` after a subagent returns empty, and be ready to finish the work manually.

### `process.cwd()` is shared across vitest test files
Adding file I/O to production code (like writing `.pi/superpowers-state.json` relative to `process.cwd()`) can break unrelated tests that don't use temp CWDs. When production code reads/writes files based on CWD, every test file that exercises that code path needs CWD isolation. The fix: have shared test helpers (like `createFakePi`) automatically call `withTempCwd()` so all tests get isolation by default.

### Double-processing buffer on exit
When draining a line-buffered stream after process exit, don't process the buffer both immediately AND after a timeout delay — the buffer isn't cleared by `processLine`, so the same partial line gets processed twice. Use a single drain point.
