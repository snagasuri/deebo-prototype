import { homedir } from 'os';
import { join } from 'path';
import { access, mkdir, readFile, writeFile } from 'fs/promises';
import chalk from 'chalk';
import { simpleGit as createGit } from 'simple-git';
import inquirer from 'inquirer';
export const defaultModels = {
    openrouter: 'anthropic/claude-3.5-sonnet',
    anthropic: 'claude-3-5-sonnet-20241022',
    gemini: 'gemini-2.5-pro-preview-03-25'
};
export const DEEBO_REPO = 'https://github.com/snagasuri/deebo-prototype.git';
export async function checkPrerequisites() {
    // Check Node version
    const nodeVersion = process.version;
    if (nodeVersion.startsWith('v18') || nodeVersion.startsWith('v20') || nodeVersion.startsWith('v22')) {
        console.log(chalk.green('✔ Node version:', nodeVersion));
    }
    else {
        throw new Error('Node.js v18+ is required');
    }
    // Check git
    try {
        const git = createGit();
        await git.version();
        console.log(chalk.green('✔ git found'));
    }
    catch {
        throw new Error('git is required but not found');
    }
}
export async function findConfigPaths() {
    const home = homedir();
    const isWindows = process.platform === 'win32';
    // Define paths based on platform
    let clinePath = '';
    let claudePath = '';
    if (isWindows) {
        // Windows paths
        clinePath = join(process.env.APPDATA || '', 'Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json');
        // Use a default path for claude regardless of whether it exists
        claudePath = join(process.env.APPDATA || '', 'Claude/claude_desktop_config.json');
    }
    else {
        // macOS/Linux paths
        clinePath = join(home, 'Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json');
        claudePath = join(home, 'Library/Application Support/Claude/claude_desktop_config.json');
    }
    const result = {};
    // Check if Cline config exists
    try {
        await access(clinePath);
        result.cline = clinePath;
        console.log(chalk.green('✔ Cline config found'));
    }
    catch { }
    // For Claude Desktop config, we don't need to check if it exists
    // Just return the path and let the calling function handle creation if needed
    result.claude = claudePath;
    // Only require one of the configs to be found, for flexibility
    if (!result.cline && !result.claude) {
        throw new Error('No Cline or Claude Desktop configuration found');
    }
    return result;
}
export async function setupDeeboDirectory(config) {
    let needsCleanup = false;
    try {
        await access(config.deeboPath);
        // Directory exists, ask for confirmation
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
        needsCleanup = true;
    }
    catch (err) {
        // Directory doesn't exist, create it
        await mkdir(config.deeboPath, { recursive: true });
    }
    // Clean up if needed
    if (needsCleanup) {
        const { rm } = await import('fs/promises');
        await rm(config.deeboPath, { recursive: true, force: true });
        console.log(chalk.green('✔ Removed existing installation'));
        await mkdir(config.deeboPath, { recursive: true });
    }
    console.log(chalk.green('✔ Created Deebo directory'));
    // Clone repository
    const git = createGit();
    await git.clone(DEEBO_REPO, config.deeboPath);
    console.log(chalk.green('✔ Cloned Deebo repository'));
    // Install dependencies
    const { execSync } = await import('child_process');
    try {
        execSync('npm install', { cwd: config.deeboPath });
        console.log(chalk.green('✔ Installed dependencies'));
    }
    catch (error) {
        console.error(chalk.yellow('⚠ Warning: Dependency installation encountered an issue'));
        console.error(error instanceof Error ? error.message : String(error));
    }
    // Build project
    try {
        execSync('npm run build', { cwd: config.deeboPath });
        console.log(chalk.green('✔ Built project'));
    }
    catch (error) {
        console.error(chalk.yellow('⚠ Warning: Build process encountered an issue'));
        console.error(error instanceof Error ? error.message : String(error));
    }
    // Create config directory if it doesn't exist
    const configDir = join(config.deeboPath, 'config');
    try {
        await mkdir(configDir, { recursive: true });
    }
    catch (err) {
        // Ignore if already exists
    }
    // Install required MCP tools
    try {
        // Install desktop-commander
        console.log(chalk.blue('Installing desktop-commander...'));
        const isWindows = process.platform === 'win32';
        if (isWindows) {
            // On Windows, don't try to write directly to Claude config
            console.log(chalk.blue('Using direct installation without config writing on Windows...'));
            try {
                execSync('npx @wonderwhy-er/desktop-commander@latest --version', { cwd: config.deeboPath });
                console.log(chalk.green('✔ Verified desktop-commander accessibility'));
            }
            catch (e) {
                console.log(chalk.blue('Installing desktop-commander package...'));
                execSync('npm install -g @wonderwhy-er/desktop-commander@latest', { cwd: config.deeboPath });
                console.log(chalk.green('✔ Installed desktop-commander globally'));
            }
        }
        else {
            // Standard setup on non-Windows platforms
            execSync('npx @wonderwhy-er/desktop-commander@latest setup', { cwd: config.deeboPath });
            console.log(chalk.green('✔ Installed desktop-commander'));
        }
    }
    catch (error) {
        console.error(chalk.yellow('⚠ Warning: Failed to install desktop-commander'));
        console.error(chalk.yellow('This is not a critical error. Deebo can still function.'));
    }
    try {
        // Install git-mcp
        console.log(chalk.blue('Installing git-mcp...'));
        const isWindows = process.platform === 'win32';
        if (isWindows) {
            // For Windows, first install uv via PowerShell
            try {
                execSync('powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"', { cwd: config.deeboPath });
                console.log(chalk.green('✔ Installed uv'));
                // Then use uvx to install mcp-server-git
                execSync('uvx mcp-server-git --help', { cwd: config.deeboPath });
            }
            catch (uvError) {
                console.error(chalk.yellow('⚠ Warning: Failed to install uv or mcp-server-git'));
                console.error(uvError instanceof Error ? uvError.message : String(uvError));
                // Fallback to pip as a last resort
                console.log(chalk.blue('Trying fallback installation via pip...'));
                execSync('pip install mcp-server-git', { cwd: config.deeboPath });
            }
        }
        else {
            execSync('curl -LsSf https://astral.sh/uv/install.sh | sh && uvx mcp-server-git --help', { cwd: config.deeboPath });
        }
        console.log(chalk.green('✔ Installed git-mcp'));
    }
    catch (error) {
        console.error(chalk.yellow('⚠ Warning: Failed to install git-mcp'));
        console.error(error instanceof Error ? error.message : String(error));
    }
}
export async function writeEnvFile(config) {
    const motherApiKeyVar = getApiKeyEnvVar(config.motherHost);
    const scenarioApiKeyVar = getApiKeyEnvVar(config.scenarioHost);
    const envContent = `MOTHER_HOST=${config.motherHost}
MOTHER_MODEL=${config.motherModel}
SCENARIO_HOST=${config.scenarioHost}
SCENARIO_MODEL=${config.scenarioModel}
${motherApiKeyVar}=${config.motherApiKey}
${scenarioApiKeyVar}=${config.scenarioApiKey}
USE_MEMORY_BANK=true
NODE_ENV=development`;
    try {
        await writeFile(config.envPath, envContent);
        console.log(chalk.green('✔ Created environment file'));
    }
    catch (error) {
        console.error(chalk.red('✖ Failed to create environment file'));
        console.error(error instanceof Error ? error.message : String(error));
        throw error;
    }
    // Create tools.json file
    const toolsContent = {
        "tools": {
            "desktopCommander": {
                "installCommand": "npx @wonderwhy-er/desktop-commander@latest setup",
                "checkCommand": "npx @wonderwhy-er/desktop-commander@latest --version"
            },
            "git-mcp": {
                "installCommand": process.platform === 'win32'
                    ? "powershell -ExecutionPolicy ByPass -c \"irm https://astral.sh/uv/install.ps1 | iex\" && uvx mcp-server-git --help"
                    : "curl -LsSf https://astral.sh/uv/install.sh | sh && uvx mcp-server-git --help",
                "checkCommand": process.platform === 'win32'
                    ? "uvx mcp-server-git --help || pip show mcp-server-git"
                    : "uvx mcp-server-git --version"
            }
        }
    };
    try {
        await writeFile(join(config.deeboPath, 'config/tools.json'), JSON.stringify(toolsContent, null, 2));
        console.log(chalk.green('✔ Created tools configuration'));
    }
    catch (error) {
        console.error(chalk.yellow('⚠ Warning: Failed to create tools configuration'));
        console.error(error instanceof Error ? error.message : String(error));
    }
}
export async function updateMcpConfig(config) {
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
    // Update Cline config if available
    if (config.clineConfigPath) {
        try {
            const content = await readFile(config.clineConfigPath, 'utf8');
            let clineConfig;
            try {
                clineConfig = JSON.parse(content);
            }
            catch (parseError) {
                // Create new config if parsing fails
                clineConfig = { mcpServers: {} };
            }
            // Create mcpServers object if it doesn't exist
            if (!clineConfig.mcpServers) {
                clineConfig.mcpServers = {};
            }
            clineConfig.mcpServers.deebo = deeboConfig;
            await writeFile(config.clineConfigPath, JSON.stringify(clineConfig, null, 2));
            console.log(chalk.green('✔ Updated Cline configuration'));
        }
        catch (error) {
            console.error(chalk.yellow('⚠ Warning: Failed to update Cline configuration'));
            console.error(error instanceof Error ? error.message : String(error));
        }
    }
    // Always create Claude config, even if path doesn't exist yet
    if (config.claudeConfigPath) {
        try {
            // Create empty default config
            const claudeConfig = { mcpServers: {} };
            // Create the parent directory forcefully
            const isWindows = process.platform === 'win32';
            const separator = isWindows ? '\\' : '/';
            const claudeDir = config.claudeConfigPath.substring(0, config.claudeConfigPath.lastIndexOf(separator));
            // Make sure the directory exists
            await mkdir(claudeDir, { recursive: true });
            // Set up Deebo in the config
            claudeConfig.mcpServers.deebo = deeboConfig;
            // Write the file
            await writeFile(config.claudeConfigPath, JSON.stringify(claudeConfig, null, 2));
            console.log(chalk.green('✔ Created Claude Desktop configuration'));
        }
        catch (error) {
            console.error(chalk.yellow('⚠ Warning: Could not create Claude Desktop configuration'));
            console.error(chalk.yellow(`Error: ${error instanceof Error ? error.message : String(error)}`));
            console.error(chalk.yellow('You may need to manually create the Claude Desktop config directory.'));
        }
    }
}
function getDefaultModel(host) {
    switch (host) {
        case 'openrouter':
            return 'anthropic/claude-3.5-sonnet';
        case 'anthropic':
            return 'claude-3-sonnet-20240229';
        case 'gemini':
            return 'gemini-1.5-pro';
        default:
            return 'anthropic/claude-3.5-sonnet';
    }
}
function getApiKeyEnvVar(host) {
    switch (host) {
        case 'openrouter':
            return 'OPENROUTER_API_KEY';
        case 'anthropic':
            return 'ANTHROPIC_API_KEY';
        case 'gemini':
            return 'GEMINI_API_KEY';
        default:
            return 'OPENROUTER_API_KEY';
    }
}
export async function updateAgentConfig(configPaths, agentType, host, model, apiKey) {
    const envVar = getApiKeyEnvVar(host);
    const hostEnvVar = `${agentType.toUpperCase()}_HOST`;
    const modelEnvVar = `${agentType.toUpperCase()}_MODEL`;
    // Update Cline config if available
    if (configPaths.cline) {
        const clineConfig = JSON.parse(await readFile(configPaths.cline, 'utf8'));
        if (clineConfig.mcpServers.deebo) {
            clineConfig.mcpServers.deebo.env[envVar] = apiKey;
            clineConfig.mcpServers.deebo.env[hostEnvVar] = host;
            clineConfig.mcpServers.deebo.env[modelEnvVar] = model;
            await writeFile(configPaths.cline, JSON.stringify(clineConfig, null, 2));
            console.log(chalk.green('✔ Updated Cline configuration'));
        }
    }
    // Update Claude config if available
    if (configPaths.claude) {
        const claudeConfig = JSON.parse(await readFile(configPaths.claude, 'utf8'));
        if (claudeConfig.mcpServers.deebo) {
            claudeConfig.mcpServers.deebo.env[envVar] = apiKey;
            claudeConfig.mcpServers.deebo.env[hostEnvVar] = host;
            claudeConfig.mcpServers.deebo.env[modelEnvVar] = model;
            await writeFile(configPaths.claude, JSON.stringify(claudeConfig, null, 2));
            console.log(chalk.green('✔ Updated Claude Desktop configuration'));
        }
    }
}
export async function removeProviderConfig(configPaths, host) {
    const envVar = getApiKeyEnvVar(host);
    // Update Cline config if available
    if (configPaths.cline) {
        const clineConfig = JSON.parse(await readFile(configPaths.cline, 'utf8'));
        if (clineConfig.mcpServers.deebo?.env[envVar]) {
            delete clineConfig.mcpServers.deebo.env[envVar];
            await writeFile(configPaths.cline, JSON.stringify(clineConfig, null, 2));
            console.log(chalk.green('✔ Updated Cline configuration'));
        }
    }
    // Update Claude config if available
    if (configPaths.claude) {
        const claudeConfig = JSON.parse(await readFile(configPaths.claude, 'utf8'));
        if (claudeConfig.mcpServers.deebo?.env[envVar]) {
            delete claudeConfig.mcpServers.deebo.env[envVar];
            await writeFile(configPaths.claude, JSON.stringify(claudeConfig, null, 2));
            console.log(chalk.green('✔ Updated Claude Desktop configuration'));
        }
    }
}
function isHostInUse(env, host) {
    return env.MOTHER_HOST === host || env.SCENARIO_HOST === host;
}
