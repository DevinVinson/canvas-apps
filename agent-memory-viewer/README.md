# Agent Memory

A read-only App for Agent Canvas that displays enabled user and project memory indexes plus dated daily notes, their tier and source path, last-modified time, and index character usage against the 6,000-character memory budget.

The App uses existing Agent Server read APIs plus fixed read-only discovery and metadata probes. It does not write memory, change the memory setting, or add an Agent Server endpoint. Daily notes such as `YYYY-MM-DD.md` are shown as read-on-demand files, not automatically injected context.

Install from the absolute package path. New installations remain disabled until explicitly enabled in Agent Canvas.
