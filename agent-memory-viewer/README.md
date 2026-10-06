# Agent Memory

A read-only App for Agent Canvas that displays enabled user and project memory indexes plus dated daily notes, their tier and source path, last-modified time, and index character usage against the 6,000-character memory budget.

The App uses existing Agent Server read APIs plus fixed read-only discovery and metadata probes. It does not write memory, change the memory setting, or add an Agent Server endpoint. Daily notes such as `YYYY-MM-DD.md` are shown as read-on-demand files, not automatically injected context.

Install from the absolute package path. New installations remain disabled until explicitly enabled in Agent Canvas.

## Agent Server access and security notes

The App only talks to the Agent Server through `host.agentServer.request()`:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/settings` | Check whether Agent Memory is enabled. |
| `GET /api/file/home` | Find the server user's home directory. |
| `GET /api/workspaces`, `GET /api/conversations/search?limit=100` | Discover workspace directories. |
| `GET /api/file/download?path=...` | Read `MEMORY.md` and daily notes. |
| `POST /api/bash/execute_bash_command` | List daily notes and read file modification times. |

**Bash endpoint.** The Agent Server has no file-listing or file-stat endpoint, so
the App runs two fixed, read-only `python3 -c` commands: one lists
`YYYY-MM-DD.md` files in the memory directories, and one reads their `mtime`.
Directory and file paths are passed as base64-encoded JSON and are never
interpolated into the command text; filenames are re-validated against a strict
`YYYY-MM-DD.md` pattern before use. The App does not expose a terminal, write any
files, or run commands built from user input. If the probes fail, the viewer
still works but may omit daily notes or modification times.

Because any App can already call this endpoint, the App does not add new
capability. It does mean the bundle must be reviewed with that in mind: do not
add markdown/HTML rendering or interpolate values into those commands without
revisiting this section. Memory files can contain text the agent copied from
untrusted sources, so all content is rendered with `textContent` only.

**Scope of what is read.** Besides the user-level `~/.openhands/memory/`, the App
reads `.openhands/memory/` from every registered workspace and from the working
directories of the 100 most recent conversations, so it may show memory from
projects you did not expect. Nothing is sent anywhere except the Agent Server
you are connected to.
