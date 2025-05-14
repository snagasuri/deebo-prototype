[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/snagasuri-deebo-prototype-badge.png)](https://mseep.ai/app/snagasuri-deebo-prototype)

# Deebo: Your AI Agent's Debugging Copilot
[![CI Status](https://github.com/snagasuri/deebo-prototype/actions/workflows/basic-ci.yml/badge.svg)](https://github.com/snagasuri/deebo-prototype/actions/workflows/basic-ci.yml)
[![npm version](https://img.shields.io/npm/v/deebo-setup.svg)](https://www.npmjs.com/package/deebo-setup)
[![GitHub stars](https://img.shields.io/github/stars/snagasuri/deebo-prototype?style=social)](https://github.com/snagasuri/deebo-prototype)

Deebo is an agentic debugging copilot for your AI coding agent that speeds up time-to-resolution by 10x. If your main coding agent is like a single-threaded process, Deebo introduces multi-threadedness to your development workflow.

**feedback, questions/support? check out Deebo Guide below, or dm me on x @sriramenn**

**If you think your team can benefit from Deebo, we’d love to hear from you.** We’re partnering with teams who use AI agents to write production code and want to maximize their productivity. Reach out for a live walkthrough, custom setup support, or to explore early access to enterprise features.

## Quick Install

```bash
npx deebo-setup@latest
```

<details>
<summary> Manual Configuration </summary>

After installing with deebo-setup, create a configuration file at your coding agent's specified location with the following content. First, add the guide server (which provides help documentation even if the main installation fails):

```json
{
  "servers": {
    "deebo-guide": {
      "command": "node",
      "args": [
        "--experimental-specifier-resolution=node",
        "--experimental-modules",
        "/Users/[your-name]/.deebo/guide-server.js"
      ],
      "env": {},
      "transportType": "stdio"
    },
    "deebo": {
      "command": "node",
      "args": [
        "--experimental-specifier-resolution=node",
        "--experimental-modules",
        "--max-old-space-size=4096",
        "/Users/[your-name]/.deebo/build/index.js"
      ],
      "env": {
        "NODE_ENV": "development",
        "USE_MEMORY_BANK": "true",
        "MOTHER_HOST": "openrouter",
        "MOTHER_MODEL": "anthropic/claude-3.5-sonnet",
        "SCENARIO_HOST": "openrouter",
        "SCENARIO_MODEL": "deepseek/deepseek-chat",
        "OPENROUTER_API_KEY": "your-openrouter-api-key"
      }
    }
  }
}
```
Deebo works with any OpenAI-compatible SDK, Anthropic, Gemini, and OpenRouter.
</details>

<details>

<summary> Deebo Guide </summary>

Deebo helps your AI agent debug real software errors by launching automated investigations. Here's how to use it effectively.

---

### 1. Start a Debugging Session

When you hit a tough bug, ask your agent to delegate the task to Deebo.

**What to include in your request:**
- 🔧 The **error** (message, stack trace, or behavior)
- 📁 The **absolute path** to your Git repository
- 💡 Any helpful **context**, such as:
  - What you’ve already tried
  - Relevant files or code snippets
  - How to reproduce the issue
  - The language or environment

**Example instruction to your agent:**

> “This error is happening in `/path/to/repo`, possibly related to auth logic. I already checked the session token parser. Can you delegate this to Deebo?”

Your agent will start a Deebo session and give you a **session ID** (e.g. `session-1745...`). Save it.

---

### 2. Check Investigation Progress

After ~30 seconds, ask your agent to check the status of the Deebo session using that session ID.

You’ll get a **session pulse**, which shows:
- Whether the investigation is in progress or completed
- What the system is currently exploring
- Summaries of findings, if any

---

### 3. Add Observations (Optional)

If you notice something important — or think Deebo is heading the wrong way — you can guide the investigation.

Ask your agent to pass a short observation to Deebo.

**Example:**

> “Let Deebo know that the file size warnings might be a red herring — the issue is probably with the CI env vars.”

This may shift the direction of the investigation.

### 4. Cancel a Session (Optional)

If you fixed the issue or no longer need the investigation, tell your agent to cancel the Deebo session.

### For AI Agents: Memory Bank Access

When asked to check debug session progress, look in:
`~/.deebo/memory-bank/[project-hash]/sessions/[session-id]/logs/`

The project hash is a unique identifier for each repository, and session IDs are provided when starting a debug session.

### Want More?

We're piloting enterprise features that unlock unprecedented productivity gains for your team. Reach out if interested!
</details>
 
---
[Watch the full work session with Cline + Deebo here (3 mins, sped up)](https://drive.google.com/file/d/141VdQ9DNOfnOpP_mmB0UPMr8cwAGrxKC/view)

<video src="https://github.com/user-attachments/assets/756d35b4-4f77-48de-bd1a-86f76360279e" controls width="100%"></video>

## License

Apache License 2.0 — see [LICENSE](LICENSE) for details.
