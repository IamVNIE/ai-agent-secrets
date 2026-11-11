# ai-agent-secret — keep API keys and secrets away from AI coding agents

[![npm version](https://img.shields.io/npm/v/ai-agent-secret.svg)](https://www.npmjs.com/package/ai-agent-secret)

**ai-agent-secret** (CLI: `agentshield`) protects your `.env` secrets from AI coding agents such as
Claude Code, Cursor, Codex, GitHub Copilot, opencode and pi. It encrypts `.env` files, keeps the
encryption key outside the project, and redacts secrets from command output and agent tool results,
so API keys never end up in an LLM's context window, chat logs or terminal history.

Like dotenvx, but built for the age of AI coding agents: your `.env` stays encrypted in the
project, the **key lives outside the project**, and command output is **automatically redacted**
so secrets never reach the terminal — or the LLM reading it.

## Install

```sh
npm install -g ai-agent-secret   # requires Node >= 22.13; installs the `agentshield` command
```

## Quick start

```sh
cd my-project
agentshield encrypt                  # encrypts values in .env, in place
agentshield run -- npm start         # runs with decrypted env, output redacted
```

Your `.env` now looks like this — safe to leave in the repo an agent works on:

```dotenv
# --- agentshield: encrypted env file ---
# Values starting with "enc:gcm:" are AES-256-GCM encrypted. The key is NOT in this
# project; ... (usage notes for agents: run commands via `agentshield run -- <cmd>`)
# --- end agentshield ---

OPENAI_API_KEY=enc:gcm:Mylncwi/ckLh8qwCvDkcUxdFuiL4EDdT...
DB_PASSWORD="enc:gcm:BLvFH180xMOoA7srcUOn23AGV13qxbNq..."
PORT=8080
```

And if your app (or an agent) prints a secret, the output is masked — first 90% hidden:

```sh
$ agentshield run -- node -e "console.log(process.env.OPENAI_API_KEY)"
**************************CD
```

## Commands

| Command | What it does |
|---|---|
| `agentshield encrypt [-f <file>]` | Encrypt all values (≥ 5 chars) in place |
| `agentshield run [-f <file>] -- <cmd>` | Run a command with decrypted env; secrets redacted in stdout/stderr |
| `agentshield decrypt [-f <file>] [--stdout]` | Restore plaintext (for humans; `--stdout` doesn't touch the file) |
| `agentshield keys list` | Show which projects have keys (never the keys themselves) |
| `agentshield keys path` | Show the keystore location |
| `agentshield hooks install [agent...]` | Redact secrets from every tool result in your coding agents |
| `agentshield hooks uninstall [agent...]` | Remove those hooks (other settings untouched) |
| `agentshield hooks status` | Show where hooks are installed |

### Running commands

`agentshield run` spawns your command as a **child process** with the decrypted env injected,
so it works with `.cmd`/`.bat` shims on Windows (`npm`, `npx`, `nodemon`, …) too:

```sh
agentshield run -- nodemon server.js
agentshield run -- docker compose up
```

It cannot, however, work like the shell builtin `source` — a separate process can't push env
vars back into your shell, so `agentshield source .env && docker compose up` is impossible by
design (and would defeat output redaction). To chain commands, **quote the whole line** and let
the shell run it under the injected env:

```sh
agentshield run -- "npm run migrate && docker compose up"
```

Without quotes, your shell splits on `&&` before agentshield sees it, so only the first command
gets the secrets.

## Agent hooks: redact every tool result

`agentshield run` only protects output of commands you route through it. To make sure an agent
*never* sees a secret — even when it `cat`s a log your app wrote, reads a decrypted file, or
calls an MCP tool that echoes a key — install a post-tool-call hook:

```sh
agentshield hooks install            # every supported agent detected on this machine
agentshield hooks install claude pi  # or pick agents explicitly
```

After each tool call the agent hands the result to `agentshield hook <agent>`, which masks every
protected value of the project being worked on (looked up via the keystore, including from
subdirectories) before the model sees it. Projects you haven't encrypted are left alone.

| Agent | Installed into | What gets redacted |
|---|---|---|
| Claude Code | `~/.claude/settings.json` (`PostToolUse`) | All tool output, replaced in place |
| Codex CLI | `~/.codex/hooks.json` (`PostToolUse`) | All tool output, returned to the model as a blocked result¹ |
| pi | `~/.pi/agent/extensions/agentshield.js` | All tool output, replaced in place |
| OpenCode | `~/.config/opencode/plugins/agentshield.js` | All tool output, replaced in place |
| Gemini CLI | `~/.gemini/settings.json` (`AfterTool`) | All tool output, returned to the model as a blocked result |
| Cursor | `~/.cursor/hooks.json` | MCP output redacted; reads of files that contain secrets are denied. Cursor can't rewrite shell output, so use `agentshield run` there |

¹ Codex asks you to review and trust new hooks before they run.

Install merges into your existing config (a `.agentshield-backup` copy is kept), is idempotent, and
refuses to touch a config file it can't parse. Hooks fail open: if something goes wrong, the
agent keeps working with the original output. Restart the agent after installing.

## How it works

- Each `(project directory, env file)` pair gets its own AES-256-GCM key, stored in
  `~/.agentshield/keystore.db` — **never inside the project** (no `.env.keys` file to steal).
- `agentshield run` decrypts in memory only, injects the env into your command, and streams its
  output through a redactor that masks every protected value, even across chunk boundaries.
- Values **shorter than 5 characters** (ports, flags like `DEBUG=1`) are left as-is: not
  encrypted, not redacted.
- On first encrypt, a short comment **preamble** is added at the top telling agents what the
  file is and to use `agentshield run -- <cmd>` instead of trying to decrypt. It's added once
  (edit or delete it and it stays that way), and `decrypt` removes it again.
- Comments, ordering, quoting, and line endings in your `.env` are preserved; encrypt → decrypt
  restores the file byte-for-byte.

## Threat model, honestly

agentshield protects against an agent *reading project files* or *reading command output*. An
agent running unrestricted with your full OS account could still read `~/.agentshield/`. So deny
it: e.g. in Claude Code, add `~/.agentshield` to the deny list in your permission settings, and
never let agents run `agentshield decrypt`.

## Migrating from llm-envshield

This package was previously published as `llm-envshield` with an `envshield` command.

```sh
npm uninstall -g llm-envshield
npm install -g ai-agent-secret
agentshield hooks install     # re-install agent hooks under the new command name
```

Existing keys keep working: if `~/.agentshield` doesn't exist, `agentshield` uses your old
`~/.envshield` keystore (and honors `ENVSHIELD_HOME`). Files already encrypted by `envshield`
decrypt as before. Run `envshield hooks uninstall` *before* uninstalling the old package to
remove its hooks.

## License

Apache-2.0
