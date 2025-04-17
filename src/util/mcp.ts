// src/util/mcp.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFile } from 'fs/promises';
import { join } from 'path';
import { DEEBO_ROOT } from '../index.js';
import { getProjectId } from './sanitize.js';

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
    
    // Check if we should use Windows fallback
    const isWindows = process.platform === 'win32';
    if (isWindows && toolConfig.windowsFallback) {
      // First try to check if the primary tool is available
      try {
        // Just check if uvx exists for git-mcp
        if (toolName === 'git-mcp' && !process.env.DEEBO_UVX_PATH) {
          // Try to find uvx in PATH
          const { execSync } = await import('child_process');
          try {
            execSync('uvx --version', { stdio: 'ignore' });
          } catch {
            console.log(`Using windowsFallback for ${toolName} because uvx is not available`);
            toolConfig = { ...toolConfig.windowsFallback };
          }
        }
      } catch (error) {
        console.log(`Error checking for primary tool, using windowsFallback: ${error}`);
        toolConfig = { ...toolConfig.windowsFallback };
      }
    }

    // Build paths for placeholder replacement
    const projectId = getProjectId(repoPath);
    const memoryPath = join(DEEBO_ROOT, 'memory-bank', projectId);
    const memoryRoot = join(DEEBO_ROOT, 'memory-bank');
    
    // Replace placeholders in command
    toolConfig.command = toolConfig.command
      .replace(/{npxPath}/g, process.env.DEEBO_NPX_PATH || '')
      .replace(/{uvxPath}/g, process.env.DEEBO_UVX_PATH || '');

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
  const [gitClient, filesystemClient] = await Promise.all([
    connectMcpTool(`${agentName}-git`, 'git-mcp', sessionId, repoPath),
    // Switch from "filesystem-mcp" to "desktop-commander"
    connectMcpTool(`${agentName}-desktop-commander`, 'desktopCommander', sessionId, repoPath)
  ]);

  return { gitClient, filesystemClient };
}
