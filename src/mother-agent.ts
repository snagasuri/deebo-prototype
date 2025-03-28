import { spawn } from 'child_process';
import { join } from 'path';
import { mkdir, readFile } from 'fs/promises';
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { log } from './util/logger.js';
import { connectMcpTool, getTextContent } from './util/mcp.js';
import { DEEBO_ROOT } from './index.js';

type OodaState = 'observe' | 'orient' | 'decide' | 'act';

/**
 * Mother agent - keep it simple
 * - Has both git-mcp and filesystem-mcp
 * - Trusts OS for process isolation
 * - Trusts Claude for strategy
 * - One-way OODA state logging
 */
export async function runMotherAgent(
  sessionId: string,
  error: string,
  context: string,
  language: string,
  filePath: string,
  repoPath: string
): Promise<any> {
  await log(sessionId, 'mother', 'info', 'Mother agent started', { error, language });

  try {
    // OBSERVE: Connect to tools and analyze error
    await log(sessionId, 'mother', 'info', 'OODA transition', { state: 'observe' as OodaState });
    const gitClient = await connectMcpTool('mother-git', 'git-mcp');
    const filesystemClient = await connectMcpTool('mother-filesystem', 'filesystem-mcp');

    // Create mother's workspace
    const motherWorkspace = join('sessions', sessionId, 'mother');
    await filesystemClient.callTool({
      name: 'create_directory',
      arguments: { path: motherWorkspace }
    });

    // Get initial context
    const observations = {
      git: {
        status: await gitClient.callTool({
          name: 'git_status',
          arguments: { repo_path: repoPath }
        }),
        diff: await gitClient.callTool({
          name: 'git_diff',
          arguments: { repo_path: repoPath }
        })
      },
      files: filePath ? await filesystemClient.callTool({
        name: 'read_file',
        arguments: { path: filePath }
      }) : null,
      context: await filesystemClient.callTool({
        name: 'search_files',
        arguments: { 
          path: repoPath,
          pattern: '*.{js,ts,json}'
        }
      })
    };

    // ORIENT: Let Claude analyze and suggest hypotheses
    await log(sessionId, 'mother', 'info', 'OODA transition', { state: 'orient' as OodaState });
    const anthropic = new (await import('@anthropic-ai/sdk')).default();

    const analysis = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      system: `You are analyzing a bug to determine investigation strategy. Return JSON array of hypotheses:
[{
  "type": string,
  "description": string,
  "suggestedTools": [{
    "tool": "git-mcp" | "filesystem-mcp",
    "name": string,
    "args": object
  }]
}]`,
      messages: [{
        role: 'user',
        content: `Error: ${error}\nContext: ${context}\nObservations: ${JSON.stringify(observations, null, 2)}`
      }]
    });

    const content = analysis.content[0];
    if (!('text' in content)) {
      throw new Error('Expected text response from Claude');
    }
    const hypotheses = JSON.parse(content.text);

    // DECIDE: Create scenario agents
    await log(sessionId, 'mother', 'info', 'OODA transition', { state: 'decide' as OodaState });
    const scenarioIds = hypotheses.map((h: { type: string }) => `scenario-${sessionId}-${h.type}`);
    await log(sessionId, 'mother', 'info', 'Creating scenario agents', { scenarioIds });

    // ACT: Run scenario agents in parallel
    await log(sessionId, 'mother', 'info', 'OODA transition', { state: 'act' as OodaState });
    const results = await Promise.all(hypotheses.map(async (hypothesis: any) => {
      const scenarioId = `scenario-${sessionId}-${hypothesis.type}`;
      const scenarioPath = join(DEEBO_ROOT, 'build/scenario-agent.js');

      // Simple one-way communication: spawn, collect output, wait for exit
      const childProcess = spawn('node', [
        scenarioPath,
        '--id', scenarioId,
        '--session', sessionId,
        '--error', error,
        '--context', context,
        '--hypothesis', hypothesis.description,
        '--language', language,
        '--file', filePath,
        '--repo', repoPath
      ]);

      // Collect stdout/stderr
      let stdout = '';
      let stderr = '';
      childProcess.stdout.on('data', data => stdout += data);
      childProcess.stderr.on('data', data => stderr += data);

      // One-way communication: just wait for exit
      return new Promise((resolve, reject) => {
        childProcess.on('exit', code => {
          if (code === 0 && stdout) {
            try {
              const report = JSON.parse(stdout);
              resolve({ id: scenarioId, ...report });
            } catch (err) {
              reject(new Error(`Invalid report format: ${err instanceof Error ? err.message : String(err)}`));
            }
          } else if (stderr) {
            try {
              const error = JSON.parse(stderr);
              resolve({ id: scenarioId, ...error });
            } catch (err) {
              reject(new Error(`Scenario failed: ${err instanceof Error ? err.message : String(err)}`));
            }
          } else {
            reject(new Error(`Scenario exited with code ${code}`));
          }
        });
      });
    }));

    // OBSERVE results
    await log(sessionId, 'mother', 'info', 'OODA transition', { state: 'observe' as OodaState });
    await log(sessionId, 'mother', 'info', 'Scenario results', { 
      total: results.length,
      successful: results.filter((r: any) => r.success).length
    });

    // ORIENT: Let Claude evaluate results
    await log(sessionId, 'mother', 'info', 'OODA transition', { state: 'orient' as OodaState });
    const evaluation = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      system: `You are evaluating debugging results. Return JSON:
{
  "complete": boolean,
  "result": {
    "fix": string,
    "confidence": number,
    "explanation": string
  }
}`,
      messages: [{
        role: 'user',
        content: JSON.stringify(results)
      }]
    });

    const evalContent = evaluation.content[0];
    if (!('text' in evalContent)) {
      throw new Error('Expected text response from Claude');
    }
    const { complete, result } = JSON.parse(evalContent.text);

    // DECIDE & ACT on evaluation
    await log(sessionId, 'mother', 'info', 'OODA transition', { state: 'decide' as OodaState });
    if (complete && result) {
      await log(sessionId, 'mother', 'info', 'OODA transition', { state: 'act' as OodaState, action: 'complete' });
      return result;
    }

    await log(sessionId, 'mother', 'info', 'OODA transition', { state: 'act' as OodaState, action: 'fail' });
    throw new Error('No solution found');
  } catch (error) {
    // Log the actual error details
    await log(sessionId, 'mother', 'error', 'Mother agent failed', {
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}
