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
    
    // Replace placeholders in command with basic commands on Mac/Linux for better compatibility
    toolConfig.command = toolConfig.command
      .replace(/{npxPath}/g, process.platform === 'win32' ? 
        (process.env.DEEBO_NPX_PATH || 'npx.cmd') : 
        'npx')
      .replace(/{uvxPath}/g, process.platform === 'win32' ? 
        (process.env.DEEBO_UVX_PATH || 'uvx.cmd') : 
        'uvx');

    // Replace placeholders in arguments  
    toolConfig.args = toolConfig.args.map((arg: string) =>
      arg.replace(/{repoPath}/g, repoPath)
         .replace(/{memoryPath}/g, memoryPath)
         .replace(/{memoryRoot}/g, memoryRoot)
    );

    // Configure transport with explicit environment for Windows
    const transportConfig = {
      command: toolConfig.command,
      args: toolConfig.args,
      shell: process.platform === 'win32', // Use shell on Windows
      windowsHide: false, // Don't hide Windows terminal processes
      windowsVerbatimArguments: true, // Use verbatim arguments on Windows
      env: (process.platform === 'win32' ? {
        // Convert all environment variables to strings
        ...Object.entries(process.env).reduce((acc, [key, value]) => {
          acc[key] = value ?? ''; // Replace undefined with empty string
          return acc;
        }, {} as Record<string, string>)
      } : process.env) as Record<string, string> // Cast the final result
    };

    const transport = new StdioClientTransport(transportConfig);

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
