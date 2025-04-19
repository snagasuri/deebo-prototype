// src/mother-agent.ts
/**
 * 📌 Why this is the best version:
    •	✅ Keeps full message history without resetting
    •	✅ Supports multiple tool calls per Claude response
    •	✅ Spawns scenarios from multiple hypotheses
    •	✅ Never throws on malformed XML, logs gently instead
    •	✅ Doesn't force memory bank writes — Mother can directly choose via filesystem-mcp
    •	✅ Maintains Deebo's spirit: autonomy, freedom to fail, and graceful continuation
 */

    import { spawn } from 'child_process';
    import { join } from 'path';
    import { getAgentObservations } from './util/observations.js';
    import { log } from './util/logger.js';
    import { connectRequiredTools } from './util/mcp.js';
    import { DEEBO_ROOT } from './index.js';
    import { updateMemoryBank } from './util/membank.js';
    import { getProjectId } from './util/sanitize.js';
    // import OpenAI from 'openai'; // Removed
    import { ChatCompletionMessageParam, ChatCompletionMessage } from 'openai/resources/chat/completions';
    import { createScenarioBranch } from './util/branch-manager.js';
    import { callLlm, getMotherAgentPrompt } from './util/agent-utils.js'; // Updated import
    
    const MAX_RUNTIME = 60 * 60 * 1000; // 60 minutes
    const SCENARIO_TIMEOUT = 5 * 60 * 1000;
    const useMemoryBank = process.env.USE_MEMORY_BANK === 'true';
    
    // Removed safeAssistantMessage function as it's no longer needed with callLlm
    
    // Mother agent main loop
    export async function runMotherAgent(
      sessionId: string,
      error: string,
      context: string,
      language: string,
      filePath: string,
      repoPath: string,
      signal: AbortSignal, // Added: Cancellation signal
      scenarioPids: Set<number> // Added: Set to track scenario PIDs
    ) {
      await log(sessionId, 'mother', 'info', 'Mother agent started', { repoPath });
      const projectId = getProjectId(repoPath);
      let scenarioCounter = 0; // Simple counter for unique scenario IDs within the session
      const startTime = Date.now();
      const memoryBankPath = join(DEEBO_ROOT, 'memory-bank', projectId);
      let lastObservationCheck = 0;
    
      try {
        // OBSERVE: Setup tools and LLM Client
        await log(sessionId, 'mother', 'info', 'OODA: observe', { repoPath });
        const { gitClient, filesystemClient } = await connectRequiredTools('mother', sessionId, repoPath);
    
        // Read LLM configuration from environment variables
        const motherProvider = process.env.MOTHER_HOST; // Read provider name from MOTHER_HOST
        const motherModel = process.env.MOTHER_MODEL;
        const openrouterApiKey = process.env.OPENROUTER_API_KEY; // Still needed if provider is 'openrouter'
        const geminiApiKey = process.env.GEMINI_API_KEY;
        const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
        // const motherHost = process.env.MOTHER_HOST; // No longer needed as separate URL
    
        // Create the config object to pass to callLlm
        const llmConfig = {
          provider: motherProvider, // Use the provider name from MOTHER_HOST
          model: motherModel,
          apiKey: openrouterApiKey, // Pass the OpenRouter key (used only if provider is 'openrouter')
          // baseURL: motherHost, // Removed - OpenRouter URL is hardcoded in callLlm
          geminiApiKey: geminiApiKey,
          anthropicApiKey: anthropicApiKey
        };
    
        // Initial conversation context
        const messages: ChatCompletionMessageParam[] = [{
          role: 'assistant',
          content: getMotherAgentPrompt(useMemoryBank, memoryBankPath)
        }, {
          role: 'user',
          content: `Error: ${error}
    Context: ${context}
    Language: ${language}
    File: ${filePath}
    Repo: ${repoPath}
    Session: ${sessionId}
    Project: ${projectId}
    ${useMemoryBank ? '\nPrevious debugging attempts and context are available in the memory-bank directory if needed.' : ''}
    
    IMPORTANT: Generate your first hypothesis within 2-3 responses. Don't wait for perfect information.`
        }];

    // Check for new observations
    let observations = await getAgentObservations(repoPath, sessionId, 'mother'); // Changed const to let
    if (observations.length > 0) {
      messages.push(...observations.map(obs => ({
        role: 'user' as const,
        content: `Scientific observation: ${obs}`
      })));
    }

    // Initial LLM call using the new utility function with config
    await log(sessionId, 'mother', 'debug', 'Sending to LLM', { model: llmConfig.model, provider: llmConfig.provider, messages, repoPath });
    let replyText = await callLlm(messages, llmConfig);
    if (!replyText) {
      messages.push({ role: 'user', content: 'LLM returned empty or malformed response' });
      await log(sessionId, 'mother', 'warn', 'Received empty/malformed response from LLM', { provider: llmConfig.provider, model: llmConfig.model, repoPath });
    } else {
      // Add the valid response to messages history
      messages.push({ role: 'assistant', content: replyText });
      await log(sessionId, 'mother', 'debug', 'Received from LLM', { response: { content: replyText }, repoPath });
    }

    // ORIENT: Begin investigation loop
    await log(sessionId, 'mother', 'info', 'OODA: orient', { repoPath });

    // Loop while the last reply exists, doesn't contain the solution tag, AND cancellation hasn't been requested
    while (replyText && !replyText.includes('<solution>') && !signal.aborted) { // Check signal in loop condition
      if (Date.now() - startTime > MAX_RUNTIME) {
        await log(sessionId, 'mother', 'warn', 'Investigation exceeded maximum runtime', { repoPath });
        throw new Error('Investigation exceeded maximum runtime');
      }

      // Check for cancellation signal before processing response
      if (signal.aborted) {
        await log(sessionId, 'mother', 'info', 'Cancellation signal received, stopping loop.', { repoPath });
        break; // Exit loop if cancelled
      }

      // The assistant's response (replyText) is already added to messages before the loop starts and after each LLM call inside the loop.

      // Use the latest replyText directly
      const responseText = replyText; 

      // Handle MULTIPLE MCP tools (if any) - Parsing from responseText
      const toolCalls = responseText.match(/<use_mcp_tool>[\s\S]*?<\/use_mcp_tool>/g) || [];

      const parsedCalls = toolCalls.map((tc: string) => {
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

      // Process each parsed call
      for (const parsed of parsedCalls) {
        if ('error' in parsed) {
          messages.push({
            role: 'user',
            content: `One of your tool calls was malformed and skipped. Error: ${parsed.error}`
          });
          continue;
        }

        try {
          const result = await parsed.server.callTool({ name: parsed.tool, arguments: parsed.args });
          messages.push({
            role: 'user',
            content: JSON.stringify(result)
          });
        } catch (err) {
          messages.push({
            role: 'user',
            content: `Tool call failed: ${err instanceof Error ? err.message : String(err)}`
          });
        }
      }


      // Handle Hypotheses → Scenario agents - Parsing from responseText
      if (responseText.includes('<hypothesis>')) {
        const hypotheses = [...responseText.matchAll(/<hypothesis>([\s\S]*?)<\/hypothesis>/g)].map(match => match[1].trim());

        if (useMemoryBank) {
          await updateMemoryBank(projectId, `==================
AUTOMATED HYPOTHESIS RECORD
Timestamp: ${new Date().toISOString()}
Error: ${error || 'No error provided'}

${responseText}

==================
`, 'activeContext');
        }

        const scenarioPromises = hypotheses.map(async (hypothesis: string) => {
          const scenarioId = `${sessionId}-${scenarioCounter++}`; // Use counter for unique ID

          await new Promise(resolve => setTimeout(resolve, 100)); // Small delay
          const branchName = await createScenarioBranch(repoPath, sessionId); // Branch name generation

          const scenarioArgs = [ // Define args for spawn
            join(DEEBO_ROOT, 'build/scenario-agent.js'),
            '--id', scenarioId,
            '--session', sessionId,
            '--error', error,
            '--context', context,
            '--hypothesis', hypothesis,
            '--language', language,
            '--file', filePath || '',
            '--repo', repoPath,
            '--branch', branchName
          ];

          // Spawn process with tool path environment variables
          const child = spawn('node', scenarioArgs, {
            env: {
              ...process.env,
              DEEBO_NPX_PATH: process.env.DEEBO_NPX_PATH,
              DEEBO_UVX_PATH: process.env.DEEBO_UVX_PATH
            }
          }); // Ensure tool paths are passed to scenarios
          let output = '';

          // Track the PID in the shared Set
          if (child.pid) {
            scenarioPids.add(child.pid);
            await log(sessionId, 'mother', 'info', `Spawned Scenario ${scenarioId} with PID ${child.pid}`, { repoPath, hypothesis, args: scenarioArgs });
          } else {
             await log(sessionId, 'mother', 'warn', `Spawned Scenario ${scenarioId} but PID was unavailable`, { repoPath, hypothesis, args: scenarioArgs });
          }

          child.stdout.on('data', data => output += data);
          child.stderr.on('data', data => output += data);

          // Wait for process exit OR timeout
          return new Promise<string>((resolve) => {
              let resolved = false;
              const scenarioPid = child.pid; // Capture PID for cleanup logic

              // Function to handle cleanup and resolution
              const cleanupAndResolve = (exitInfo: string) => {
                if (resolved) return;
                resolved = true;
                if (scenarioPid) {
                  scenarioPids.delete(scenarioPid); // Remove PID from registry
                  log(sessionId, 'mother', 'debug', `Removed scenario PID ${scenarioPid} from registry`, { repoPath });
                }
                output += `\n${exitInfo}`;
                resolve(output);
              };

              // Handle process exit
              child.on('exit', (code, signal) => {
                cleanupAndResolve(`Scenario ${scenarioId} (PID: ${scenarioPid}) exited with code ${code}, signal ${signal}`);
              });

              // Handle process spawn errors
              child.on('error', err => {
                if (resolved) return;
                resolved = true;
                output += `\nProcess spawn error: ${err}`;
                resolve(output); // Resolve immediately on spawn error
              });

              // Capture stream-level errors (don't resolve promise)
              child.stdout.on('error', err => { output += `\nStdout error: ${err}`; });
              child.stderr.on('error', err => { output += `\nStderr error: ${err}`; });

              // Set a timeout for the scenario
              const timeoutHandle = setTimeout(() => {
                 if (!resolved) {
                    child.kill(); // Force kill the scenario on timeout
                    cleanupAndResolve(`Scenario ${scenarioId} (PID: ${scenarioPid}) timed out after ${SCENARIO_TIMEOUT / 1000}s`);
                 }
              }, SCENARIO_TIMEOUT);

              // Clear timeout if process exits or errors first
              child.on('exit', () => clearTimeout(timeoutHandle));
              child.on('error', () => clearTimeout(timeoutHandle));
            });
        });

        // Wait for all spawned scenarios for this turn to complete
        const scenarioOutputs = await Promise.all(scenarioPromises);

        messages.push({ role: 'user', content: scenarioOutputs.join('\n\n---\n\n') }); // Add separator for readability
      }

      // Mother can optionally edit memory bank directly via filesystem-mcp. No forced writes.

      // Check for new observations before each Claude call
      const newObservations = await getAgentObservations(repoPath, sessionId, 'mother');
      if (newObservations.length > observations.length) {
        const latestObservations = newObservations.slice(observations.length);
        messages.push(...latestObservations.map(obs => ({
          role: 'user' as const,
          content: `Scientific observation: ${obs}`
        })));
        observations = newObservations; // Update the baseline observation list
      }

      // Check for cancellation signal again before the next LLM call
      if (signal.aborted) {
        await log(sessionId, 'mother', 'info', 'Cancellation signal received before next LLM call.', { repoPath });
        break; // Exit loop if cancelled
      }

      // Make next LLM call using the new utility function with config
      await log(sessionId, 'mother', 'debug', 'Sending to LLM', { model: llmConfig.model, provider: llmConfig.provider, messages, repoPath });
      replyText = await callLlm(messages, llmConfig); // Update replyText
      if (!replyText) {
        messages.push({ role: 'user', content: 'LLM returned empty or malformed response' });
        await log(sessionId, 'mother', 'warn', 'Received empty/malformed response from LLM', { provider: llmConfig.provider, model: llmConfig.model, repoPath });
        // replyText is already falsy, loop will terminate naturally
      } else {
        // Add the valid response to messages history
        messages.push({ role: 'assistant', content: replyText });
        await log(sessionId, 'mother', 'debug', 'Received from LLM', { response: { content: replyText }, provider: llmConfig.provider, model: llmConfig.model, repoPath });
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Determine final status based on whether loop was aborted or completed naturally
    let finalStatusMessage: string;
    if (signal.aborted) {
      finalStatusMessage = 'Session cancelled by user request.';
      await log(sessionId, 'mother', 'info', finalStatusMessage, { repoPath });
    } else if (replyText?.includes('<solution>')) {
      finalStatusMessage = 'Solution found or investigation concluded.';
      await log(sessionId, 'mother', 'info', finalStatusMessage, { repoPath });
    } else {
      finalStatusMessage = 'Loop terminated unexpectedly (e.g., LLM error).';
       await log(sessionId, 'mother', 'warn', finalStatusMessage, { repoPath });
    }

    const finalContent = replyText || finalStatusMessage; // Use last reply or status message

    // Structured record at the end
    if (useMemoryBank) {
      await updateMemoryBank(projectId, `\n## Debug Session ${sessionId} - ${new Date().toISOString()}
${error ? `Initial Error: ${error}` : ''}
Final Status: ${finalStatusMessage}
${finalContent.includes('<solution>') ? finalContent : `Last Response/Status: ${finalContent}`}
Scenarios Spawned: ${scenarioCounter}
Duration: ${Math.round((Date.now() - startTime) / 1000)}s`, 'progress');
    }

    return finalContent; // Return the last reply or status

  } catch (err) {
    const caughtError = err instanceof Error ? err : new Error(String(err));
    // Check if the error was due to cancellation signal during an operation
     if (signal.aborted) {
       await log(sessionId, 'mother', 'info', `Operation aborted during execution: ${caughtError.message}`, { repoPath });
       // Optionally update progress log for aborted state
       if (useMemoryBank) {
         await updateMemoryBank(projectId, `\n## Debug Session ${sessionId} - ABORTED - ${new Date().toISOString()}\nError during abort: ${caughtError.message}`, 'progress');
       }
       return 'Session cancelled during operation.'; // Return specific cancellation message
     } else {
       // Log and record other errors
       await log(sessionId, 'mother', 'error', `Failed: ${caughtError.message}`, { repoPath, stack: caughtError.stack });
       if (useMemoryBank) {
         await updateMemoryBank(projectId, `\n## Debug Session ${sessionId} - FAILED - ${new Date().toISOString()}\nError: ${caughtError.message}\nStack: ${caughtError.stack}`, 'progress');
       }
       throw caughtError; // Re-throw unexpected errors
     }
  } finally {
     // Ensure any remaining scenario PIDs are cleaned up if the mother agent exits unexpectedly
     // (though the 'exit' handler should cover most cases)
     if (scenarioPids.size > 0) {
       await log(sessionId, 'mother', 'warn', `Mother agent exiting with ${scenarioPids.size} scenario PIDs still in registry.`, { pids: Array.from(scenarioPids) });
       // Optionally attempt to kill them here, though 'cancel' is the primary mechanism
     }
  }
}
