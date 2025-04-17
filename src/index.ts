import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFile, mkdir, readdir, access, writeFile } from 'fs/promises';
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { runMotherAgent } from './mother-agent.js';
import { getProjectId } from './util/sanitize.js';
import { writeObservation } from './util/observations.js';
import { exec, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';

// Function to find tool paths during initialization
async function findToolPaths() {
  // Use 'where' on Windows, 'which' on other platforms
  const isWindows = process.platform === 'win32';
  const findCommand = isWindows ? 'where' : 'which';
  
  let npxPath = '';
  let uvxPath = '';
  
  try {
    // Find npx path
    try {
      npxPath = (await execPromise(`${findCommand} npx`)).stdout.trim();
      if (isWindows && npxPath.includes('\r\n')) {
        // Windows 'where' can return multiple lines, take the first one
        npxPath = npxPath.split('\r\n')[0].trim();
      }
    } catch (error) {
      // Fallback for Windows if 'where' fails
      if (isWindows) {
        npxPath = 'npx';
        console.log('Using default npx command');
      } else {
        throw error;
      }
    }
    
    // Find uvx path
    try {
      uvxPath = (await execPromise(`${findCommand} uvx`)).stdout.trim();
      if (isWindows && uvxPath.includes('\r\n')) {
        // Windows 'where' can return multiple lines, take the first one
        uvxPath = uvxPath.split('\r\n')[0].trim();
      }
    } catch (error) {
      // On Windows, we may need to fallback to Python module path
      if (isWindows) {
        try {
          // Check if uv is installed via pip
          await execPromise('pip show uv');
          uvxPath = 'python -m uv'; // Use Python module path
          console.log('Using Python module path for uv');
        } catch (pipError) {
          // If neither found, use default (which will be handled by the fallback in mcp.ts)
          uvxPath = 'uvx';
          console.log('Using default uvx command');
        }
      } else {
        throw error;
      }
    }
  } catch (error) {
    console.error('Error finding tool paths:', error);
    // Set fallback values if we can't determine paths
    if (!npxPath) npxPath = 'npx';
    if (!uvxPath) uvxPath = 'uvx';
  }

  // Store paths in env for mcp.ts to use
  process.env.DEEBO_NPX_PATH = npxPath;
  process.env.DEEBO_UVX_PATH = uvxPath;

  // Write tools.json with placeholders
  const toolsConfig = {
    tools: {
      desktopCommander: {
        command: "{npxPath}",
        args: ["@wonderwhy-er/desktop-commander"]
      },
      "git-mcp": {
        command: "{uvxPath}",
        args: ["mcp-server-git", "--repository", "{repoPath}"],
        windowsFallback: {
          command: "python",
          args: [
            "-m",
            "mcp_server_git",
            "--repository",
            "{repoPath}"
          ]
        }
      }
    }
  };

  await writeFile(join(DEEBO_ROOT, 'config', 'tools.json'), 
    JSON.stringify(toolsConfig, null, 2));

  return { npxPath, uvxPath };
}

const execPromise = promisify(exec);

// Helper to find session directory
async function findSessionDir(sessionId: string): Promise<string | null> {
  const memoryBank = join(DEEBO_ROOT, 'memory-bank');
  const projects = await readdir(memoryBank);
  
  for (const project of projects) {
    const sessionPath = join(memoryBank, project, 'sessions', sessionId);
    try {
      await access(sessionPath);
      return sessionPath;
    } catch {
      continue;
    }
  }
  return null;
}

// Registry to track active sessions and their associated processes/controllers
const processRegistry = new Map<string, {
  motherController: AbortController;
  scenarioPids: Set<number>; // Store PIDs of spawned scenario agents
}>();

// Load environment variables from .env file
config();

// Validate required environment variables
if (!process.env.OPENROUTER_API_KEY) {
  throw new Error('OPENROUTER_API_KEY environment variable is required');
}
if (!process.env.MOTHER_MODEL) {
  throw new Error('MOTHER_MODEL environment variable is required');
}
if (!process.env.SCENARIO_MODEL) {
  throw new Error('SCENARIO_MODEL environment variable is required');
}


// Set up basic directories
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const DEEBO_ROOT = join(__dirname, '..');

// Create required directories
await mkdir(join(DEEBO_ROOT, 'memory-bank'), { recursive: true });

// Find and configure tool paths
await findToolPaths();

// Create MCP server
const server = new McpServer({
  name: "Deebo",
  version: "1.0.0"
});

// Register start tool - begins a debug session
server.tool(
  "start",
  "Begins an autonomous debugging session that investigates software bugs through multiple competing hypotheses. This tool launches a mother agent that analyzes errors, generates diverse hypotheses about potential causes, and spawns isolated scenario agents to test each hypothesis in separate git branches. The mother agent coordinates the investigation, evaluates scenario reports, and synthesizes a validated solution when sufficient evidence is found.",
  {
    error: z.string().describe("The error message or description of the bug to investigate"),
    repoPath: z.string().describe("Absolute path to the git repository containing the code to debug"),
    context: z.string().optional().describe("Additional context like code snippets, previous attempts, or relevant information"),
    language: z.string().optional().describe("Programming language of the code being debugged (e.g., 'typescript', 'python')"),
    filePath: z.string().optional().describe("Relative path to the specific file containing the bug, if known")
  },
  async ({ error, repoPath, context, language, filePath }, extra) => {
    const projectId = getProjectId(repoPath);
    const sessionId = `session-${Date.now()}`;
    await mkdir(join(DEEBO_ROOT, 'memory-bank', projectId, 'sessions', sessionId, 'logs'), { recursive: true });
    await mkdir(join(DEEBO_ROOT, 'memory-bank', projectId, 'sessions', sessionId, 'reports'), { recursive: true });

    // Create controller and PID set for this session
    const motherController = new AbortController();
    const scenarioPids = new Set<number>();

    // Register the session
    processRegistry.set(sessionId, {
      motherController,
      scenarioPids
    });
    // console.log(`Registered session ${sessionId}`); // Removed informational log

    // Run mother agent in background, passing the signal and PID set
    // Note: runMotherAgent signature needs to be updated in mother-agent.ts to accept these
    runMotherAgent(
      sessionId,
      error,
      context ?? "",
      language ?? "typescript",
      filePath ?? "",
      repoPath,
      motherController.signal, // Pass the signal
      scenarioPids // Pass the Set for tracking scenario PIDs
    ).catch(err => {
      console.error(`Debug session ${sessionId} failed during execution:`, err);
      // Clean up registry if mother agent fails during execution
      processRegistry.delete(sessionId);
    }).finally(() => {
      // Optional: Could also remove from registry on normal completion,
      // but cancel needs to handle the case where it's still running.
      // For now, only removing on error/cancel.
      // console.log(`Mother agent promise settled for session ${sessionId}.`); // Removed internal log
    });

    // Return session ID immediately
    return {
      content: [{
        type: "text",
        text: sessionId
      }]
    };
  }
);

// Register check tool - gets status of a debug session
server.tool(
  "check",
  "Retrieves the current status of a debugging session, providing a detailed pulse report. For in-progress sessions, the pulse includes the mother agent's current stage in the OODA loop, running scenario agents with their hypotheses, and any preliminary findings. For completed sessions, the pulse contains the final solution with a comprehensive explanation, relevant code changes, and outcome summaries from all scenario agents that contributed to the solution. Use this tool to monitor ongoing progress or retrieve the final validated fix.",
  {
    sessionId: z.string().describe("The session ID returned by the start tool when the debugging session was initiated")
  },
  async ({ sessionId }, extra) => {
    try {
      const sessionDir = await findSessionDir(sessionId);
      if (!sessionDir) {
        return {
          content: [{ 
            type: "text",
            text: `Session ${sessionId} not found`
          }]
        };
      }

      // Get time metrics and mother status
      const logsDir = join(sessionDir, 'logs');
      const motherLogPath = join(logsDir, 'mother.log');
      const motherLog = await readFile(motherLogPath, 'utf8');
      const motherLines = motherLog.split('\n').filter(Boolean);

      if (!motherLines.length) return { content: [{ type: "text", text: 'Session initializing' }] };

      const firstEvent = JSON.parse(motherLines[0]);
      const durationMs = Date.now() - new Date(firstEvent.timestamp).getTime();

      // Determine status by scanning for solution tag first, then check for errors
      let status = 'in_progress'; // Default status
      let solutionFoundInScan = false;
      let lastValidEvent: any = null; // Store the last successfully parsed event

      for (let i = motherLines.length - 1; i >= 0; i--) {
        try {
          const event = JSON.parse(motherLines[i]);
          if (!lastValidEvent) lastValidEvent = event; // Capture the last valid event

          const content = event.data?.response?.content || event.message || '';
          if (content.includes('<solution>')) {
            status = 'completed';
            solutionFoundInScan = true;
            break; // Found the solution tag
          }
          // Check for error status *after* checking for solution tag
          if (event.level === 'error') {
             status = 'failed';
             // Don't break here; allow checking earlier messages for a potential solution
             // that might have been logged before a subsequent error.
          }
        } catch (e) {
          // Skip invalid JSON lines
          continue;
        }
      }

      // If status is still 'in_progress' after scan, check the last valid event's level
      // This handles cases where the session ends without solution or explicit error log
      if (status === 'in_progress' && lastValidEvent && lastValidEvent.level === 'error') {
          status = 'failed';
      }
      // Note: If the loop completes and status is still 'in_progress', it remains 'in_progress'.

      // Count scenario statuses
      const reportsDir = join(sessionDir, 'reports');
      const scenarioLogs = await readdir(logsDir);
      const reportFiles = await readdir(reportsDir);
      
      const totalScenarios = scenarioLogs.filter(f => f.startsWith('scenario-')).length;
      const reportedScenarios = reportFiles.length;

      // Build the pulse
      let pulse = `=== Deebo Session Pulse: ${sessionId} ===\n`;
      pulse += `Timestamp: ${new Date().toISOString()}\n`;
      pulse += `Overall Status: ${status}\n`;
      pulse += `Session Duration: ${Math.floor(durationMs / 1000)}s\n\n`;

      pulse += `--- Mother Agent ---\n`;
      pulse += `Status: ${status === 'in_progress' ? 'working' : status}\n`;
      pulse += `Last Activity: ${lastValidEvent ? lastValidEvent.timestamp : 'N/A'}\n`;

      // For completed sessions, find and show solution
      if (status === 'completed') {
        // Look for solution in mother log
        let foundSolution = false;
        
        // Scan backwards for efficiency (newer entries more likely to have solution)
        for (let i = motherLines.length - 1; i >= 0; i--) {
          try {
            const line = motherLines[i];
            const event = JSON.parse(line);
            const content = event.data?.response?.content || event.message || '';
            
            // Check for solution tag in content string
            if (content.includes('<solution>')) {
              const match = content.match(/<solution>([\s\S]*?)<\/solution>/);
              if (match && match[1]) {
                pulse += `MOTHER SOLUTION:\n`;
                pulse += `<<<<<<< SOLUTION\n`;
                pulse += match[1].trim() + '\n';
                pulse += `======= SOLUTION END >>>>>>>\n\n`;
                foundSolution = true;
                break;
              }
            }
          } catch (e) {
            // Skip invalid JSON lines
            continue;
          }
        }
        
        // No solution found message
        if (!foundSolution) {
          pulse += `STATUS COMPLETE BUT NO SOLUTION TAG FOUND IN LOGS\n`;
          pulse += `Check the mother.log file for more details.\n\n`;
        }
      } else if (status === 'in_progress' || status === 'failed') {
        // For in-progress or failed, show last known stage or last message
        let stageMessage = 'No stage information found.';
        if (lastValidEvent) { // Use the last valid event captured during status scan
             stageMessage = lastValidEvent.message || JSON.stringify(lastValidEvent.data); // Show message or data
             if (lastValidEvent.message && lastValidEvent.message.includes('OODA:')) {
                 pulse += `Last Stage: ${lastValidEvent.message}\n\n`;
             } else {
                 pulse += `Last Log Message: ${stageMessage.substring(0, 100)}${stageMessage.length > 100 ? '...' : ''}\n\n`;
             }
        } else {
             pulse += `Last Stage: ${stageMessage}\n\n`;
        }

      }

      pulse += `--- Scenario Agents (${totalScenarios} Total: ${totalScenarios - reportedScenarios} Running, ${reportedScenarios} Reported) ---\n\n`;

      // Process reported scenarios
      for (const file of reportFiles) {
        const scenarioId = file.replace('.json', '');
        
        const scenarioLogPath = join(logsDir, `scenario-${scenarioId}.log`);
        let scenarioLog;
        try {
          scenarioLog = await readFile(scenarioLogPath, 'utf8');
        } catch (e) {
          continue; // Skip if log file doesn't exist
        }
        
        const scenarioLines = scenarioLog.split('\n').filter(Boolean);
        if (!scenarioLines.length) continue;

        // Get hypothesis - scan once
        let hypothesis = 'Unknown hypothesis';
        for (let i = 0; i < scenarioLines.length; i++) {
          try {
            const event = JSON.parse(scenarioLines[i]);
            if (event.data?.hypothesis) {
              hypothesis = event.data.hypothesis;
              break;
            }
          } catch (e) {
            continue;
          }
        }

        pulse += `* Scenario: ${scenarioId}\n`;
        pulse += `  Status: Reported\n`;

        if (status === 'completed') {
          // Show summary for completed scenarios in completed sessions
          try {
            const reportRaw = await readFile(join(reportsDir, `${scenarioId}.json`), 'utf8');
            const report = JSON.parse(reportRaw);
            
            // Extract key information from report
            const reportStr = typeof report === 'string' ? report : JSON.stringify(report, null, 2);
            const lines = reportStr.split('\n');
            
            // Find CONFIRMED status and INVESTIGATION section
            let confirmed = 'Unknown';
            let investigationLines: string[] = [];
            let inInvestigation = false;
            
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i].trim();
              if (line.startsWith('CONFIRMED:')) {
                confirmed = line.split(':')[1].trim();
              }
              if (line === 'INVESTIGATION:') {
                inInvestigation = true;
                continue;
              }
              if (inInvestigation && line && !line.startsWith('CONCLUSION:')) {
                investigationLines.push(line);
              }
              if (line.startsWith('CONCLUSION:')) {
                break;
              }
            }
            
            pulse += `  Outcome Summary:\n`;
            pulse += `  <<<<<<< OUTCOME ${scenarioId}\n`;
            pulse += `  HYPOTHESIS: ${hypothesis}\n\n`;
            pulse += `  CONFIRMED: ${confirmed}\n\n`;
            if (investigationLines.length > 0) {
              pulse += `  INVESTIGATION:\n`;
              pulse += `  ${investigationLines.join('\n  ')}\n`;
            }
            pulse += `  ======= OUTCOME ${scenarioId} END >>>>>>>\n`;
          } catch (e) {
            const error = e as Error;
            pulse += `  Error reading report: ${error.message}\n`;
          }
        }

        pulse += `  (Full report: ${join(reportsDir, `${scenarioId}.json`)})\n\n`;
      }

      // Process running scenarios
      const runningScenarios = scenarioLogs
        .filter(f => f.startsWith('scenario-'))
        .filter(f => !reportFiles.includes(f.replace('scenario-', '').replace('.log', '.json')));
      
      for (const file of runningScenarios) {
        const scenarioId = file.replace('scenario-', '').replace('.log', '');
        
        let scenarioLog;
        try {
          scenarioLog = await readFile(join(logsDir, file), 'utf8');
        } catch (e) {
          continue; // Skip if log file doesn't exist
        }
        
        const scenarioLines = scenarioLog.split('\n').filter(Boolean);
        if (!scenarioLines.length) continue;

        // Get hypothesis - more efficient scan
        let hypothesis = 'Unknown hypothesis';
        for (let i = 0; i < scenarioLines.length; i++) {
          try {
            const event = JSON.parse(scenarioLines[i]);
            if (event.data?.hypothesis) {
              hypothesis = event.data.hypothesis;
              break;
            }
          } catch (e) {
            continue;
          }
        }

        // First and last events
        let firstEvent, lastEvent;
        try {
          firstEvent = JSON.parse(scenarioLines[0]);
          lastEvent = JSON.parse(scenarioLines[scenarioLines.length - 1]);
          const runtime = Math.floor((Date.now() - new Date(firstEvent.timestamp).getTime()) / 1000);

          pulse += `* Scenario: ${scenarioId}\n`;
          pulse += `  Status: Running\n`;
          pulse += `  Hypothesis: "${hypothesis}"\n`;
          pulse += `  Runtime: ${runtime}s\n`;
          pulse += `  Latest Activity: ${lastEvent.message}\n`;
          pulse += `  (Log: ${join(logsDir, file)})\n\n`;
        } catch (e) {
          // Skip scenarios with invalid JSON
          continue;
        }
      }

      pulse += `--- End Session Pulse ---`;

      return {
        content: [{ 
          type: "text",
          text: pulse
        }]
      };

    } catch (err) {
      return {
        content: [{ 
          type: "text",
          text: `Error generating pulse: ${err}`
        }]
      };
    }
  }
);

server.tool(
  "cancel",
  "Terminates all processes related to a debugging session. This will stop the mother agent and all scenario agents, releasing system resources. Use this when you have your solution or want to abandon the debugging process.",
  {
    agentId: z.string().describe("ID of the agent to receive the observation (e.g., 'mother' or 'scenario-session-1712268439123-2')"),
    observation: z.string().describe("The observation content - insights, test results, or guidance to help the investigation"),
    sessionId: z.string().describe("The session ID returned by the start tool when the debugging session was initiated")
  },
  async ({ sessionId }, extra) => {
    // No need to sanitize ID when using the registry Map key
    const sessionEntry = processRegistry.get(sessionId);

    if (!sessionEntry) {
      return {
        content: [{
          type: "text",
          text: `Session ${sessionId} not found in registry. It might have already completed or failed.`
        }]
      };
    }

    const { motherController, scenarioPids } = sessionEntry;
    let killedScenarios = 0;
    let failedKills = 0;

    try {
      // 1. Signal the Mother agent to stop its loop cooperatively
      // console.log(`Signaling Mother Agent for session ${sessionId} to stop.`); // Removed informational log
      motherController.abort();

      // 2. Terminate any tracked Scenario agent processes
      // console.log(`Terminating ${scenarioPids.size} tracked Scenario Agents for session ${sessionId}.`); // Removed informational log
      for (const pid of scenarioPids) {
        try {
          // Use SIGTERM first for graceful shutdown
          process.kill(pid, 'SIGTERM');
          killedScenarios++;
          // console.log(`Sent SIGTERM to scenario PID ${pid}`); // Removed informational log
        } catch (err: any) {
          // Ignore errors if process is already gone (e.g., ESRCH)
          if (err.code !== 'ESRCH') {
            // console.warn(`Failed to send SIGTERM to scenario PID ${pid}: ${err.message}`); // Removed console.warn
            failedKills++;
          } else {
            // Process already gone
          }
        }
      }

      // Optional: Add a short delay and SIGKILL survivors if needed.
      // For simplicity, we'll rely on SIGTERM for now.

      // 3. Clean up the registry entry *after* attempting kills
      processRegistry.delete(sessionId);
      // console.log(`Removed session ${sessionId} from process registry.`); // Removed informational log

      return {
          content: [{
            type: "text",
            text: `Cancellation request sent for session ${sessionId}:\n` +
                  `- Mother agent signaled to stop.\n` +
                  `- Targeted ${killedScenarios} scenario processes (includes already exited).\n` +
                  `- ${failedKills} termination signals failed (excluding already exited).`
          }]
        };

      } catch (err: any) {
        // Handle potential errors during the cancellation process itself
        const errorMessage = err.message || String(err);
        // console.error(`Error during cancellation for session ${sessionId}: ${errorMessage}`); // Removed console.error
        // Attempt to clean up registry even if cancellation had issues
        processRegistry.delete(sessionId); // Ensure cleanup
        return {
          content: [{
            type: "text",
            text: `Error during cancellation for session ${sessionId}: ${errorMessage}. Registry entry removed.`
          }]
        };
      }
    }
  );

// Register add_observation tool
server.tool(
  "add_observation",
  "Adds an external observation to an agent in the debugging session. This allows other tools or human insights to be incorporated into the ongoing investigation. Observations are logged and considered by the agent in subsequent reasoning steps.",
  {
    agentId: z.string(),
    observation: z.string(),
    sessionId: z.string()
  },
  async ({ agentId, observation, sessionId }, extra) => {
    try {
      // Get session directory
      const sessionDir = await findSessionDir(sessionId);
      if (!sessionDir) {
        throw new Error('Session not found');
      }

      // Get repoPath from agent log
      const logFile = join(sessionDir, 'logs', `${agentId}.log`);
      const agentLog = await readFile(logFile, 'utf8');
      const firstLine = agentLog.split('\n')[0];
      const firstEvent = JSON.parse(firstLine);
      const repoPath = firstEvent.data?.repoPath;

      if (!repoPath) {
        throw new Error('Could not find repoPath in agent log');
      }

      await writeObservation(repoPath, sessionId, agentId, observation);
      return {
        content: [{
          type: "text",
          text: "Observation logged"
        }]
      };
    } catch (err) {
      throw new Error(`Observation write failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
);

// Connect transport
const transport = new StdioServerTransport();
await server.connect(transport);
