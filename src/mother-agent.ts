// src/mother-agent.ts
/**
 * 📌 Why this is the best version:
	•	✅ Keeps full message history without resetting
	•	✅ Supports multiple tool calls per Claude response
	•	✅ Spawns scenarios from multiple hypotheses
	•	✅ Never throws on malformed XML, logs gently instead
	•	✅ Doesn’t force memory bank writes — Mother can directly choose via filesystem-mcp
	•	✅ Maintains Deebo’s spirit: autonomy, freedom to fail, and graceful continuation
 */

import { spawn } from 'child_process';
import { join } from 'path';
import { log } from './util/logger.js';
import { connectRequiredTools } from './util/mcp.js';
import { DEEBO_ROOT } from './index.js';
import { updateMemoryBank } from './util/membank.js';
import { getProjectId } from './util/sanitize.js';
import { Message } from '@anthropic-ai/sdk/resources/messages.js';

const MAX_RUNTIME = 15 * 60 * 1000; // 15 minutes
const useMemoryBank = process.env.USE_MEMORY_BANK === 'true';

// Helper for Claude's responses
function getMessageText(message: Message): string {
  const content = message.content[0];
  return 'text' in content ? content.text : '';
}

// Mother agent main loop
export async function runMotherAgent(sessionId: string, error: string, context: string, language: string, filePath: string, repoPath: string) {
  await log(sessionId, 'mother', 'info', 'Mother agent started');
  const projectId = getProjectId(repoPath);
  const activeScenarios = new Set<string>();
  const startTime = Date.now();

  try {
    // OBSERVE: Setup tools and Claude
    await log(sessionId, 'mother', 'info', 'OODA: observe');
    const { gitClient, filesystemClient } = await connectRequiredTools('mother', sessionId);
    const anthropic = new (await import('@anthropic-ai/sdk')).default();

    // Initial conversation context
    const messages: { role: 'assistant' | 'user', content: string }[] = [{
      role: 'assistant',
      content: `You are the mother agent in an OODA loop debugging investigation.

You have access to these tools:

git-mcp:
- git_status: Show working tree status
- git_diff_unstaged: Show changes in working directory not yet staged
- git_diff_staged: Show changes that are staged for commit
- git_diff: Compare current state with a branch or commit
- git_add: Stage file changes
- git_commit: Commit staged changes
- git_reset: Unstage all changes
- git_log: Show recent commit history
- git_create_branch: Create a new branch
- git_checkout: Switch to a different branch
- git_show: Show contents of a specific commit
- git_init: Initialize a Git repository

filesystem-mcp:
- read_file: Read file contents
- read_multiple_files: Read multiple files at once
- write_file: Write or overwrite a file
- edit_file: Edit a file based on pattern matching
- create_directory: Create a new directory
- list_directory: List contents of a directory
- move_file: Move or rename a file
- search_files: Recursively search files
- get_file_info: Get file metadata
- list_allowed_directories: View directories this agent can access

Use tools by wrapping requests in XML tags like:
<use_mcp_tool>
  <server_name>git-mcp</server_name>
  <tool_name>git_status</tool_name>
  <arguments>
    {
      "repo_path": "/path/to/repo"
    }
  </arguments>
</use_mcp_tool>

You may update your investigation notes at any time using filesystem-mcp to edit memory-bank/activeContext.md. This is optional, but helpful for improving your own memory and hypothesis quality.`
    }, {
      role: 'user',
      content: `Error: ${error}
Context: ${context}
Language: ${language}
File: ${filePath}
Repo: ${repoPath}
Session: ${sessionId}
Project: ${projectId}
${useMemoryBank ? '\nPrevious debugging attempts and context are available in the memory-bank directory if needed.' : ''}`
    }];

    let conversation = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      messages
    });

    // ORIENT: Begin investigation loop
    await log(sessionId, 'mother', 'info', 'OODA: orient');

    while (!getMessageText(conversation).includes('<solution>')) {
      if (Date.now() - startTime > MAX_RUNTIME) {
        throw new Error('Investigation exceeded maximum runtime');
      }

      const response = getMessageText(conversation);
      messages.push({ role: 'assistant', content: response });

      // Handle MULTIPLE MCP tools (if any)
      const toolCalls = response.match(/<use_mcp_tool>[\s\S]*?<\/use_mcp_tool>/g) || [];

      const parsedCalls = toolCalls.map(tc => {
        try {
          const server = tc.includes('git-mcp') ? gitClient! : filesystemClient!;
          const toolMatch = tc.match(/<tool_name>(.*?)<\/tool_name>/);
          if (!toolMatch || !toolMatch[1]) throw new Error('Missing tool');
          const tool = toolMatch[1]!;

          const argsMatch = tc.match(/<arguments>(.*?)<\/arguments>/s);
          if (!argsMatch || !argsMatch[1]) throw new Error('Missing arguments');
          const args = JSON.parse(argsMatch[1]!);

          return { server, tool, args };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      });

      // Abort if *any* call fails to parse
      const invalid = parsedCalls.find(p => 'error' in p);
      if (invalid) {
        messages.push({
          role: 'user',
          content: `One of your tool calls was malformed and none were run. Error: ${invalid.error}`
        });
        continue;
      }
      
      const validCalls = parsedCalls as { server: NonNullable<typeof gitClient>, tool: string, args: any }[];

      // Only now, execute each one
      for (const { server, tool, args } of validCalls) {
        const result = await server.callTool({ name: tool, arguments: args });
        messages.push({
          role: 'user',
          content: JSON.stringify(result)
        });
      }

      // Handle Hypotheses → Scenario agents
      if (response.includes('<hypothesis>')) {
        const hypotheses = response.split('<hypothesis>').slice(1);
        /**
         * - if the mother isnt really writing to active context lets at least 
         * write down her responses that include hypotheses, 
         * as those are really the only significant ones anyways.
         */
        if (useMemoryBank) {
          await updateMemoryBank(projectId, response, 'activeContext');
        }

        const scenarioOutputs = await Promise.all(hypotheses.map(async (hypothesis: string) => {
          const scenarioId = `${sessionId}-${activeScenarios.size}`;
          if (activeScenarios.has(scenarioId)) return '';
          activeScenarios.add(scenarioId);

          const child = spawn('node', [
            join(DEEBO_ROOT, 'build/scenario-agent.js'),
            '--id', scenarioId,
            '--session', sessionId,
            '--error', error,
            '--context', context,
            '--hypothesis', hypothesis,
            '--language', language,
            '--file', filePath || '',
            '--repo', repoPath
          ]);

          let output = '';
          child.stdout.on('data', data => output += data);
          child.stderr.on('data', data => output += data);

          return new Promise<string>(resolve => child.on('exit', () => resolve(output)));
        }));

        messages.push({ role: 'user', content: scenarioOutputs.join('\n') });
      }

      // Mother can optionally edit memory bank directly via filesystem-mcp. No forced writes.

      conversation = await anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1024,
        messages
      });

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Structured record at the end
    if (useMemoryBank) {
      await updateMemoryBank(projectId, `\n## Debug Session ${sessionId} - ${new Date().toISOString()}
${error ? `Error: ${error}` : ''}
${getMessageText(conversation)}
Scenarios Run: ${activeScenarios.size}
Duration: ${Math.round((Date.now() - startTime) / 1000)}s`, 'progress');
    }

    return getMessageText(conversation);

  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    await log(sessionId, 'mother', 'error', `Failed: ${error.message}`);

    if (useMemoryBank) {
      await updateMemoryBank(projectId, `\n## Debug Session ${sessionId} - ${new Date().toISOString()}
${error ? `Error: ${error}` : ''}
Failed: ${error.message}
Scenarios Run: ${activeScenarios.size}
Duration: ${Math.round((Date.now() - startTime) / 1000)}s`, 'progress');
    }

    throw error;
  }
}