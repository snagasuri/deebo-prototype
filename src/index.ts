import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFile, mkdir, readdir, access, writeFile } from 'fs/promises';
import { config } from 'dotenv';
import { dirname, join } from 'path';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { runMotherAgent } from './mother-agent.js';
import { getProjectId } from './util/sanitize.js';
import { writeObservation } from './util/observations.js';
import { exec, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { homedir } from "node:os";

const execPromise = promisify(exec);

function winRoamingBin(): string {
  // VS Code spawns MCP servers with a clean env (no APPDATA)
  const base = process.env.APPDATA ?? path.join(homedir(), "AppData", "Roaming");
  return path.join(base, "npm");
}

// Function to find tool paths during initialization
async function findToolPaths() {
  const isWindows = process.platform === 'win32';
  
  let npxPath, uvxPath;

  if (isWindows) {
    try {
      const npxPaths = (await execPromise('cmd.exe /c where npx.cmd')).stdout.trim().split('\n');
      // Favor Program Files to get direct executable
      const foundNpxPath = npxPaths.find(p => p.includes('Program Files'));
      if (!foundNpxPath) {
        throw new Error('Could not find npx.cmd in Program Files');
      }
      npxPath = path.normalize(foundNpxPath).trim();

      uvxPath = path.normalize((await execPromise('cmd.exe /c where uvx.exe')).stdout.trim().split('\n')[0]).trim();
    } catch (err) {
      throw new Error(`Failed to find tool paths: ${err}`);
    }
  }else {
    npxPath = (await execPromise('which npx')).stdout.trim();
    uvxPath = (await execPromise('which uvx')).stdout.trim();
  }

  // Store normalized paths
  process.env.DEEBO_NPX_PATH = npxPath;
  process.env.DEEBO_UVX_PATH = uvxPath;

  // Get npm bin directory for Windows desktop-commander.cmd
  const npmBin = isWindows
    ? winRoamingBin()                                  // Use homedir() when VS Code strips env
    : path.dirname(npxPath);                           // same folder as npx on *nix

  process.env.DEEBO_NPM_BIN = npmBin;                 // <-- expose for later
  
  return { npxPath, uvxPath, npmBin };
}

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

// Track terminated PIDs across all tools
const terminatedPids = new Set<number>();

// Load environment variables from .env file
config();

// Validate required environment variables
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
        text:
          `Session ${sessionId} started!\n\n` +
          `Looking for resources? Ask your agent to read Deebo guide, or check out the Deebo GitHub:\n` +
          `https://github.com/snagasuri/deebo-prototype\n\n` +
          `Reminder: Deebo updates frequently.\n` +
          `Run npx deebo-setup@latest or pull the latest from GitHub occasionally to get bug fixes and improvements!`
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
      // track whether we've already shown the hint
      const entry = processRegistry.get(sessionId) || {} as any;
      let hintText = "";
      if (!entry.hasShownCheckHint) {
        hintText = "hint: wait around 30 seconds on first check\n\n";
        entry.hasShownCheckHint = true;
        processRegistry.set(sessionId, entry);
      }

      // locate the session dir
      const sessionDir = await findSessionDir(sessionId);
      if (!sessionDir) {
        return {
          content: [{ 
            type: "text",
            text: hintText + `Session ${sessionId} not found`
          }]
        };
      }

      // Get time metrics and mother status
      const logsDir = join(sessionDir, 'logs');
      const motherLogPath = join(logsDir, 'mother.log');
      const motherLog = await readFile(motherLogPath, 'utf8');
      const motherLines = motherLog.split('\n').filter(Boolean);

      if (!motherLines.length) return { content: [{ type: "text", text: hintText + 'Session initializing' }] };

      const firstEvent = JSON.parse(motherLines[0]);
      const durationMs = Date.now() - new Date(firstEvent.timestamp).getTime();

      // Determine status by scanning for solution tag, cancellation, or errors
      let status = 'in_progress';
      let lastValidEvent: any = null;
      let solutionContent = '';

      // First pass - find completion indicators
      for (const line of motherLines.reverse()) {
        try {
          const event = JSON.parse(line);
          if (!lastValidEvent) lastValidEvent = event;

          const content = event.data?.response || event.message || '';
          
          // Check for process spawn and termination with comprehensive pattern
          const SCENARIO_PID_PATTERN = /(?:Spawned|Removed|Terminated|Cancelled) Scenario .* PID (\d+)/;
          const pidMatch = content.match(SCENARIO_PID_PATTERN);
          if (pidMatch) {
            const pid = parseInt(pidMatch[1]);
            if (content.match(/(Removed|Terminated|Cancelled)/)) {
              terminatedPids.add(pid);
            }
          }
          
          // Check for session cancellation
          if (content.includes('Session cancelled by user request')) {
            status = 'cancelled';
            break;
          }
          
          // Check for solution tag with improved regex
          const solutionMatch = content.match(/<solution>\s*([\s\S]*?)\s*<\/solution>/);
          if (solutionMatch && solutionMatch[1].trim()) {
            status = 'completed';
            solutionContent = solutionMatch[1].trim();
            break;
          }
          
          // Check for completion message
          if (content === 'Solution found or investigation concluded.') {
            status = 'completed';
            // Continue searching for actual solution content
            continue;
          }
          
          // Only mark as failed if we haven't found a solution
          if (event.level === 'error' && status !== 'completed') {
            status = 'failed';
          }
        } catch (e) {
          continue;
        }
      }

      // If status is still 'in_progress' after scan, check the last valid event's level
      if (status === 'in_progress' && lastValidEvent?.level === 'error') {
        status = 'failed';
      }

      // Helper functions for PID mapping and status
      function buildScenarioPIDMapping(motherLines: string[]): Map<string, number> {
        const mapping = new Map<string, number>();
        for (const line of motherLines) {
          try {
            const event = JSON.parse(line);
            const message = event.message || '';
            const matches = message.match(/Spawned Scenario ([^ ]+) with PID (\d+)/);
            if (matches) {
              const [_, scenarioId, pidStr] = matches;
              mapping.set(scenarioId, parseInt(pidStr));
            }
          } catch (e) {
            continue;
          }
        }
        return mapping;
      }

      function getScenarioStatus(scenarioId: string, pidMapping: Map<string, number>): string {
        const pid = pidMapping.get(scenarioId);
        if (!pid) return 'Unknown';
        return terminatedPids.has(pid) ? 'Terminated' : 'Running';
      }

      // Build PID mapping from mother log
      const pidMapping = buildScenarioPIDMapping(motherLines);

      // Count scenario statuses
      const reportsDir = join(sessionDir, 'reports');
      const scenarioLogs = await readdir(logsDir);
      const reportFiles = await readdir(reportsDir);
      
      // Count scenarios by status
      let runningCount = 0;
      let terminatedCount = 0;
      let reportedCount = reportFiles.length;

      // Check each scenario's status using the PID mapping
      for (const logFile of scenarioLogs.filter(f => f.startsWith('scenario-'))) {
        const scenarioId = logFile.replace('scenario-', '').replace('.log', '');
        const status = getScenarioStatus(scenarioId, pidMapping);
        
        if (status === 'Terminated') {
          terminatedCount++;
        } else if (!reportFiles.includes(scenarioId + '.json')) {
          runningCount++;
        }
      }

      // build clickable links with absolute paths
      const normalizedPath = sessionDir.split(path.sep).join('/'); // Normalize to forward slashes
      const projectId = normalizedPath.split("/memory-bank/")[1].split("/")[0];
      const progressMdPath = path.resolve(join(DEEBO_ROOT, "memory-bank", projectId, "progress.md"));
      const progressLink = `${progressMdPath}`;
      const motherLink = `${path.resolve(motherLogPath)}`;

      // Build the pulse
      let pulse = hintText;
      pulse += `=== Deebo Session Pulse: ${sessionId} ===\n`;
      pulse += `Timestamp: ${new Date().toISOString()}\n`;
      pulse += `Overall Status: ${status}\n`;
      pulse += `Session Duration: ${Math.floor(durationMs / 1000)}s\n\n`;

      pulse += `--- Mother Agent ---\n`;
      pulse += `Status: ${status === 'in_progress' ? 'working' : status}\n`;
      pulse += `Last Activity: ${lastValidEvent ? lastValidEvent.timestamp : 'N/A'}\n`;
      pulse += `Mother Log: ${motherLink}\n`;
      
      if (status === 'completed') {
        pulse += `Progress Log: ${progressLink}\n\n`;
        if (solutionContent) {
          pulse += `MOTHER SOLUTION:\n`;
          pulse += `<<<<<<< SOLUTION\n`;
          pulse += solutionContent + '\n';
          pulse += `======= SOLUTION END >>>>>>>\n\n`;
        } else {
          pulse += `STATUS COMPLETE BUT SOLUTION CONTENT NOT FOUND\n`;
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

        pulse += `  Full report: ${path.resolve(join(reportsDir, `${scenarioId}.json`))}\n\n`;
      }

      // Process unreported scenarios (either running or terminated without report)
      const unreportedScenarios = scenarioLogs
        .filter(f => f.startsWith('scenario-'))
        .filter(f => !reportFiles.includes(f.replace('scenario-', '').replace('.log', '.json')));
      
      for (const file of unreportedScenarios) {
        const scenarioId = file.replace('scenario-', '').replace('.log', '');
        
        let scenarioLog;
        try {
          scenarioLog = await readFile(join(logsDir, file), 'utf8');
        } catch (e) {
          continue; // Skip if log file doesn't exist
        }
        
        const scenarioLines = scenarioLog.split('\n').filter(Boolean);
        if (!scenarioLines.length) continue;

        // Get hypothesis and events from scenario log
        let hypothesis = 'Unknown hypothesis';
        let firstEvent, lastEvent;
        
        try {
          // Extract hypothesis and events
          for (const line of scenarioLines) {
            try {
              const event = JSON.parse(line);
              if (event.data?.hypothesis) {
                hypothesis = event.data.hypothesis;
              }
              if (!firstEvent) firstEvent = event;
              lastEvent = event;
            } catch (e) {
              continue;
            }
          }

          // Calculate runtime and add to pulse
          const runtime = Math.floor((Date.now() - new Date(firstEvent.timestamp).getTime()) / 1000);
          pulse += `* Scenario: ${scenarioId}\n`;
          pulse += `  Status: ${getScenarioStatus(scenarioId, pidMapping)}\n`;
          pulse += `  Hypothesis: "${hypothesis}"\n`;
          pulse += `  Runtime: ${runtime}s\n`;
          pulse += `  Latest Activity: ${lastEvent.message}\n`;
          pulse += `  Log: ${path.resolve(join(logsDir, file))}\n\n`;
        } catch (e) {
          // Skip scenarios with invalid JSON
          continue;
        }
      }

      pulse += `--- End Session Pulse ---\n\n`;

      if (status === 'completed' || status === 'failed') {
        pulse += `\n=======================================\n`;
        pulse += `Not the result you were looking for?\n`;
        pulse += `Start another session and guide Deebo with what you learned!\n`;
        pulse += `Need a refresher? Ask your agent to read Deebo Guide, or check out the GitHub:\n`;
        pulse += `https://github.com/snagasuri/deebo-prototype\n`;
        pulse += `=======================================\n`;
      }

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
          terminatedPids.add(pid); // Add to terminated set right away
          // console.log(`Sent SIGTERM to scenario PID ${pid}`); // Removed informational log
        } catch (err: any) {
          // Ignore errors if process is already gone (e.g., ESRCH)
          if (err.code !== 'ESRCH') {
            // console.warn(`Failed to send SIGTERM to scenario PID ${pid}: ${err.message}`); // Removed console.warn
            failedKills++;
          } else {
            // Process already gone
            terminatedPids.add(pid); // Still mark as terminated if process is already gone
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
  "Adds an external observation to an agent in the debugging session. If agentId is not specified, defaults to 'mother'. This allows other tools or human insights to be incorporated into the ongoing investigation. Observations are logged and considered by the agent in subsequent reasoning steps.",
  {
    observation: z.string(),
    sessionId: z.string(),
    agentId: z.string().optional()
  },
  async ({ observation, sessionId, agentId = 'mother' }, extra) => {
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
