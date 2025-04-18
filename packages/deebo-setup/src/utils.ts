import { homedir } from 'os';
import { join } from 'path';
import { access, mkdir, readFile, writeFile } from 'fs/promises';
import { McpConfig, SetupConfig } from './types.js';
import chalk from 'chalk';
import { simpleGit as createGit } from 'simple-git';
import inquirer from 'inquirer';

// Keep only essential defaults
export const defaultModels = {
  openrouter: 'anthropic/claude-3.5-sonnet',
  anthropic: 'claude-3-5-sonnet-20241022',
  gemini: 'gemini-2.5-pro-preview-03-25'
};

export const DEEBO_REPO = 'https://github.com/snagasuri/deebo-prototype.git';

function getApiKeyEnvVar(host: string): string {
  switch (host) {
    case 'openrouter': return 'OPENROUTER_API_KEY';
    case 'anthropic': return 'ANTHROPIC_API_KEY';
    case 'gemini': return 'GEMINI_API_KEY';
    default: return 'OPENROUTER_API_KEY';
  }
}

export async function checkPrerequisites(): Promise<void> {
  const nodeVersion = process.version;
  if (nodeVersion.startsWith('v18') || nodeVersion.startsWith('v20') || nodeVersion.startsWith('v22')) {
    console.log(chalk.green('✔ Node version:', nodeVersion));
  } else {
    throw new Error('Node.js v18+ is required');
  }

  try {
    const git = createGit();
    await git.version();
    console.log(chalk.green('✔ git found'));
  } catch {
    throw new Error('git is required but not found');
  }
}

export async function findConfigPaths(): Promise<{cline?: string, claude?: string}> {
  const home = homedir();
  const isWindows = process.platform === 'win32';
  
  // Validate APPDATA on Windows
  if (isWindows && !process.env.APPDATA) {
    throw new Error('APPDATA environment variable not set');
  }
  
  // Windows needs special care with APPDATA
  let clinePath;
  let claudePath;
  if (isWindows) {
    const appData = process.env.APPDATA;
    if (!appData) {
      throw new Error('APPDATA environment variable is not set');
    }
    // Normalize Windows paths
    clinePath = join(appData, 'Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json').replace(/\\/g, '/');
    claudePath = join(appData, 'Claude/claude_desktop_config.json').replace(/\\/g, '/');
  } else {
    // Mac paths unchanged
    clinePath = join(home, 'Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json');
    claudePath = join(home, 'Library/Application Support/Claude/claude_desktop_config.json');
  }

  const result: {cline?: string, claude?: string} = {};

  try {
    await access(clinePath);
    result.cline = clinePath;
    console.log(chalk.green('✔ Cline config found'));
  } catch {}

  result.claude = claudePath;
  
  if (!result.cline && !result.claude) {
    throw new Error('No Cline or Claude Desktop configuration found');
  }

  return result;
}

export async function setupDeeboDirectory(config: SetupConfig): Promise<void> {
  if (await access(config.deeboPath).then(() => true).catch(() => false)) {
    const { confirm } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirm', 
      message: 'Deebo is already installed. Update to latest version?',
      default: true
    }]);

    if (!confirm) {
      console.log(chalk.yellow('Installation cancelled.'));
      process.exit(0);
    }

    const { rm } = await import('fs/promises');
    await rm(config.deeboPath, { recursive: true, force: true });
  }

  await mkdir(config.deeboPath, { recursive: true });
  console.log(chalk.green('✔ Created Deebo directory'));

  const git = createGit();
  await git.clone(DEEBO_REPO, config.deeboPath);
  console.log(chalk.green('✔ Cloned Deebo repository'));

  const { execSync } = await import('child_process');
  execSync('npm install && npm run build', { cwd: config.deeboPath, stdio: 'inherit' });
  console.log(chalk.green('✔ Installed dependencies and built project'));
}

export async function writeEnvFile(config: SetupConfig): Promise<void> {
  const motherApiKeyVar = getApiKeyEnvVar(config.motherHost);
  const scenarioApiKeyVar = getApiKeyEnvVar(config.scenarioHost);
  
  const envContent = `# Required System Config
NODE_ENV=development
USE_MEMORY_BANK=true

# Mother Agent Config
MOTHER_HOST=${config.motherHost}
MOTHER_MODEL=${config.motherModel}
${motherApiKeyVar}=${config.motherApiKey}

# Scenario Agent Config  
SCENARIO_HOST=${config.scenarioHost}
SCENARIO_MODEL=${config.scenarioModel}
${scenarioApiKeyVar}=${config.scenarioApiKey}`;

  await writeFile(config.envPath, envContent);
  console.log(chalk.green('✔ Created environment file'));
}

export async function updateMcpConfig(config: SetupConfig): Promise<void> {
  const deeboConfig = {
    autoApprove: [],
    disabled: false,
    timeout: 30,
    command: 'node',
    args: [
      '--experimental-specifier-resolution=node',
      '--experimental-modules',
      '--max-old-space-size=4096',
      join(config.deeboPath, 'build/index.js')
    ],
    env: {
      NODE_ENV: 'development',
      USE_MEMORY_BANK: 'true',
      MOTHER_HOST: config.motherHost,
      MOTHER_MODEL: config.motherModel,
      SCENARIO_HOST: config.scenarioHost,
      SCENARIO_MODEL: config.scenarioModel,
      [getApiKeyEnvVar(config.motherHost)]: config.motherApiKey,
      [getApiKeyEnvVar(config.scenarioHost)]: config.scenarioApiKey
    },
    transportType: 'stdio'
  };

  if (config.clineConfigPath) {
    try {
      let clineConfig: McpConfig;
      try {
        // Try to read existing config first
        const content = await readFile(config.clineConfigPath, 'utf8');
        clineConfig = JSON.parse(content);
        if (!clineConfig.mcpServers) {
          clineConfig.mcpServers = {};
        }
      } catch {
        // Only create new config if file doesn't exist or can't be parsed
        clineConfig = { mcpServers: {} };
      }
      
      // Add/update deebo while preserving other servers
      clineConfig.mcpServers.deebo = deeboConfig;
      await writeFile(config.clineConfigPath, JSON.stringify(clineConfig, null, 2));
      console.log(chalk.green('✔ Updated Cline configuration'));
    } catch (error) {
      console.error(chalk.yellow('⚠ Warning: Failed to update Cline configuration'));
      console.error(error instanceof Error ? error.message : String(error));
    }
  }

  if (config.claudeConfigPath) {
    try {
      let claudeConfig: McpConfig;
      try {
        // Try to read existing Claude config first
        const content = await readFile(config.claudeConfigPath, 'utf8');
        claudeConfig = JSON.parse(content);
        if (!claudeConfig.mcpServers) {
          claudeConfig.mcpServers = {};
        }
      } catch {
        // Only create new config if file doesn't exist or can't be parsed
        claudeConfig = { mcpServers: {} };
        const claudeDir = config.claudeConfigPath.substring(0, config.claudeConfigPath.lastIndexOf(process.platform === 'win32' ? '\\\\' : '/'));
        await mkdir(claudeDir, { recursive: true });
      }

      // Add/update deebo while preserving other servers
      claudeConfig.mcpServers.deebo = deeboConfig;
      await writeFile(config.claudeConfigPath, JSON.stringify(claudeConfig, null, 2));
      console.log(chalk.green('✔ Created Claude Desktop configuration'));
    } catch (error) {
      console.error(chalk.yellow('⚠ Warning: Could not create Claude Desktop configuration'));
      console.error(chalk.yellow(`Error: ${error instanceof Error ? error.message : String(error)}`));
    }
  }
}