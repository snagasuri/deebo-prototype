// src/util/mcp.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFile } from 'fs/promises';
import { join } from 'path';
import { DEEBO_ROOT } from '../index.js';
import { getProjectId } from './sanitize.js';
import { log } from './logger.js'; // Import the log function

// Map to track active connections
const activeConnections: Map<string, Promise<Client>> = new Map();

export async function connectMcpTool(name: string, toolName: string, sessionId: string, repoPath: string): Promise<Client> {
  const connectionKey = `${name}-${toolName}-${sessionId}`;
  
  const existingConnection = activeConnections.get(connectionKey);
  if (existingConnection) {
    return existingConnection;
  }

  const connectionPromise = (async () => {
    const config = JSON.parse(await readFile(join(DEEBO_ROOT, 'config', 'tools.json'), 'utf-8'));
    let toolConfig = { ...config.tools[toolName] };
    
    // Check if we should use Windows fallback for git-mcp
    const isWindows = process.platform === 'win32';
    if (isWindows && toolName === 'git-mcp' && toolConfig.windowsFallback) {
      // First try to check if the primary tool (uvx) is available
      try {
        // Check if DEEBO_UVX_PATH is set and valid, otherwise try finding uvx in PATH
        if (!process.env.DEEBO_UVX_PATH || process.env.DEEBO_UVX_PATH === 'uvx') {
          const { execSync } = await import('child_process');
          execSync('uvx --version', { stdio: 'ignore' }); // Throws if uvx not found
        }
        // If we reach here, uvx is likely available, so don't use fallback
      } catch (error) {
        console.log(`uvx not found or DEEBO_UVX_PATH not set, using windowsFallback for ${toolName}`);
        toolConfig = { ...toolConfig.windowsFallback };
      }
    }

    // Build paths for placeholder replacement
    const projectId = getProjectId(repoPath);
    const memoryPath = join(DEEBO_ROOT, 'memory-bank', projectId);
    const memoryRoot = join(DEEBO_ROOT, 'memory-bank');
    
    // Normalize paths for Windows and replace placeholders in command
    let npxCommand = process.env.DEEBO_NPX_PATH || 'npx';
    let uvxCommand = process.env.DEEBO_UVX_PATH || 'uvx';
    
    if (isWindows) {
      // If path has VSCode in it, try npm global bin
      if (npxCommand.toLowerCase().includes('microsoft vs code')) {
        try {
          const { execSync } = await import('child_process');
          const npmBinPath = execSync('npm bin -g').toString().trim();
          const npxCmd = join(npmBinPath, 'npx.cmd');
          // Check if the npx.cmd exists
          await access(npxCmd);
          npxCommand = npxCmd;
        } catch {
          npxCommand = 'npx.cmd';
        }
      }
      // Add .cmd extension if using bare command name
      if (npxCommand === 'npx') npxCommand = 'npx.cmd';
      if (uvxCommand === 'uvx') uvxCommand = 'uvx.cmd';
    }

    toolConfig.command = toolConfig.command
      .replace(/{npxPath}/g, npxCommand)
      .replace(/{uvxPath}/g, uvxCommand);

    // Replace placeholders in arguments  
    toolConfig.args = toolConfig.args.map((arg: string) =>
      arg.replace(/{repoPath}/g, repoPath)
         .replace(/{memoryPath}/g, memoryPath)
         .replace(/{memoryRoot}/g, memoryRoot)
    );

    const transport = new StdioClientTransport({
      command: toolConfig.command,
      args: toolConfig.args
    });

    const client = new Client(
      { name, version: '1.0.0' },
      { capabilities: { tools: true } }
    );
    await client.connect(transport);
    return client;
  })();

  activeConnections.set(connectionKey, connectionPromise);
  connectionPromise.catch(() => {
    activeConnections.delete(connectionKey);
  });

  return connectionPromise;
}

export async function connectRequiredTools(agentName: string, sessionId: string, repoPath: string): Promise<{
  gitClient: Client;
  filesystemClient: Client;
}> {
  // Reverted: Always use desktopCommander
  const filesystemToolName = 'desktopCommander';
  const filesystemAgentName = `${agentName}-desktop-commander`;

  // Removed log line for connecting filesystem tool

  const [gitClient, filesystemClient] = await Promise.all([
    connectMcpTool(`${agentName}-git`, 'git-mcp', sessionId, repoPath),
    connectMcpTool(filesystemAgentName, filesystemToolName, sessionId, repoPath) // Always connect to desktopCommander
  ]);

  return { gitClient, filesystemClient }; // Return the connected clients
}
