# Deebo: Your AI Agent's Debugging Partner

<p align="center">
  <a href="https://github.com/snagasuri/deebo-prototype/stargazers">
    <img alt="GitHub stars"
         src="https://img.shields.io/github/stars/snagasuri/deebo-prototype?style=flat">
  </a>
  <a href="https://www.npmjs.com/package/deebo-setup">
    <img alt="npm"
         src="https://img.shields.io/npm/v/deebo-setup?color=cb3837">
  </a>
  <img alt="active installs"
       src="https://img.shields.io/endpoint?url=https://deebo-active-counter.ramnag2003.workers.dev/active">
</p>

Deebo is an autonomous debugging system that works alongside AI coding agents (Claude, Cline, Cursor, etc.) to solve complex bugs. It runs parallel experiments in isolated Git branches and delivers validated fixes in parallel.

Deebo is basically your coding agent's best friend and teammate. You can offload tricky bugs or even sub-tasks that Deebo groks while you continue working on your main task. 

<video width="640" controls>
  <source src="notes/deebo-demo.mp4" type="video/mp4">
  Your browser does not support the video tag.
</video>

https://github.com/user-attachments/assets/e38c8ced-da8f-4979-ab30-50869b07042a

<sub><sup>40‑second sped-up run showing Deebo in action</sup></sub>

Deebo scales to production codebases, too. Here's [an example of Deebo grokking the test53 linearizer failure $100 tinygrad bug bounty](https://github.com/snagasuri/deebo-prototype/tree/master/memory-bank/9bd38e9840d3/sessions/session-1744006973678) by spawning 17 scenario agents and coming up with 2 valid fixes. Check out [progress.md](https://github.com/snagasuri/deebo-prototype/blob/master/memory-bank/9bd38e9840d3/progress.md) for just the solution.

**any questions/problems with installing? DM me on Twitter: [@sriramenn](https://twitter.com/sriramenn)**

## 🚀 Quick Install (for Cline/Claude Desktop users)

```bash
npx deebo-setup@latest
```
That's it! Follow the prompts to configure your API key and you're ready to go.

### Managing Providers & Pings

After installation, you can:

```bash
npx deebo-setup providers  # manage your LLM providers
npx deebo-setup ping      # show us you're alive
```

The providers command allows you to:
- Configure Mother Agent (provider, model, API key)
- Configure Scenario Agent (provider, model, API key)
- Remove Provider

You can use different providers for Mother and Scenario agents. For example:
- Mother Agent: Anthropic with claude-3-sonnet
- Scenario Agents: OpenRouter with claude-3.5-sonnet

<details>
<summary>🔍 What exactly does Deebo do?</summary>

Deebo is your AI agent's debugging partner. When your agent encounters a tricky bug, Deebo:

- Spawns multiple "scenario agents" to test different hypotheses in parallel
- Runs each experiment in an isolated Git branch
- Validates or falsifies each approach
- Returns structured reports and solutions
- Optionally logs session history for learning

Instead of going back and forth with your AI agent about bugs, let Deebo handle the investigation while you focus on building features.

### Exposed MCP Tools
| Tool             | Description                                                          |
| ---------------- | -------------------------------------------------------------------- |
| `start`          | Begins a debugging session                                           |
| `check`          | Returns current status of debugging session                          |
| `cancel`         | Terminates all processes for a given debugging session               |
| `add_observation`| Logs external observations for an agent                              |
</details>

<details>
<summary>🛠️ Manual Installation (for other setups)</summary>

If you're not using Cline or Claude Desktop, follow these steps:

1. Clone the repo:
   ```bash
   git clone https://github.com/snagasuri/deebo-prototype.git
   cd deebo-prototype
   ```

2. Install dependencies:
   ```bash
   npm install
   npm run build
   ```

3. Install required MCP tools:
   ```bash
   # Install uv/uvx
   curl -LsSf https://astral.sh/uv/install.sh | sh
   
   # Install git-mcp
   uvx mcp-server-git --help
   
   # Install desktop-commander
   npx @wonderwhy-er/desktop-commander@latest setup
   ```

4. Configure your MCP client to use Deebo (see Technical Details section for configuration format)
</details>

<details>
<summary>📚 Technical Details</summary>

### Memory Bank
If `USE_MEMORY_BANK=true` is set, Deebo enables structured memory logging:
- `activeContext.md`: Editable live journal for the Mother agent
- `progress.md`: Summarized results of completed debug sessions
- `sessions/<id>/reports/`: Structured scenario agent reports
- `sessions/<id>/logs/`: Raw logs from Mother and scenarios
- `sessions/<id>/observations/`: Logs of external observations

### MCP Configuration
```json
{
  "mcpServers": {
    "deebo": {
      "autoApprove": [],
      "disabled": false,
      "timeout": 30,
      "command": "node",
      "args": [
        "--experimental-specifier-resolution=node",
        "--experimental-modules",
        "--max-old-space-size=4096",
        "/absolute/path/to/deebo/build/index.js"
      ],
      "env": {
        "NODE_ENV": "development",
        "USE_MEMORY_BANK": "true",
        "MOTHER_HOST": "openrouter",
        "MOTHER_MODEL": "anthropic/claude-3.5-sonnet",
        "SCENARIO_HOST": "openrouter",
        "SCENARIO_MODEL": "anthropic/claude-3.5-sonnet",
        "OPENROUTER_API_KEY": "sk-or-v1-..."
      },
      "transportType": "stdio"
    }
  }
}
```

### Design Principles
- **Tool-isolated:** All mutations via MCP tools (no raw fs/git calls)
- **Stateless scenarios:** No shared memory between agents
- **Raw logs:** Human-readable, tailable logs and reports
- **Delegation-first:** Built to be called by other agents, not humans
</details>

<details>
<summary>🔧 Development Guide</summary>

### Prerequisites
- **Git**: For version control
- **Node.js**: v18+ (includes npm)
- **Python**: 3.10+ (for git-mcp)

### Configuration Files
- **Cline:** `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`
- **Claude Desktop:** `~/Library/Application Support/Claude/claude_desktop_config.json`

### LLM Support
Deebo supports OpenRouter, Anthropic, and Gemini models. Configure via environment variables:
- `MOTHER_HOST`: LLM provider for mother agent
- `SCENARIO_HOST`: LLM provider for scenario agents
- `[PROVIDER]_API_KEY`: API key for chosen provider

See `src/util/agent-utils.ts` for supported models and configuration details.
</details>

<details>
<summary>📖 For LLM Agents</summary>

This section contains detailed information to help LLM agents understand and work with Deebo:

### Architecture
- **Mother Agent:** Coordinates investigation, spawns scenarios, writes solutions
- **Scenario Agents:** Each tests one hypothesis in an isolated Git branch
- **Process Isolation:** All agents run as subprocesses with timeout enforcement
- **MCP Tools:** All Git/FS operations through git-mcp and desktop-commander

### Memory Bank Structure
Memory bank paths follow the pattern:
```
memory-bank/{codebaseHash}/{session-id-hash}/
  ├── mother.log
  ├── scenario-agent-0.log
  ├── scenario-agent-1.log
  └── ...
```

The memory bank allows Deebo to learn from past sessions and personalize to your codebase. Use the context field when starting a debug session to provide relevant information, and add observations mid-session if needed.


### Tool Usage Examples
```xml
<deebo>
  <start
    error="ReferenceError: x is not defined"
    repoPath="/my/project/path"
    context="// suspect function below\nfunction handleClick() { ... }"
    filePath="src/ui/buttons.ts"
    language="typescript"
  />
</deebo>
```

See the full [MCP Tools documentation](docs/mcp-tools.md) for more examples.
</details>

## 📜 License

Apache 2.0
