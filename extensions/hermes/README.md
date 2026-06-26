# Hermes

Built-in Hermes assistant panel for Sanook AI IDE. Adds a **Hermes** view to the
secondary sidebar — alongside Claude Code and Codex — backed by the locally
installed [Hermes agent](https://github.com/NousResearch/hermes-agent) over the
Agent Client Protocol (`hermes acp`).

Requires `hermes` on the machine (default `~/.local/bin/hermes`). If Hermes is not
installed or not configured, the panel shows a setup prompt that runs
`hermes setup`.
