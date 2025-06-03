import { homedir } from 'os';
import { join, dirname } from 'path';
import { access, mkdir, readFile, writeFile } from 'fs/promises';
import chalk from 'chalk';
import { simpleGit as createGit } from 'simple-git';
import inquirer from 'inquirer';
export const DEEBO_REPO = 'https://github.com/snagasuri/deebo-prototype.git';
export async function checkPrerequisites() {
    // Check Node version
    const nodeVersion = process.version;
    const major = Number(nodeVersion.slice(1).split('.')[0]);
    if (major >= 18) {
        console.log(chalk.green('✔ Node version:', nodeVersion));
    }
    else {
        throw new Error(`Node.js v18+ is required (found ${nodeVersion})`);
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
    // Check ripgrep and install desktopCommander
    const platform = process.platform;
    try {
        const { execSync } = await import('child_process');
        try {
            execSync('rg --version', { stdio: 'ignore' });
            console.log(chalk.green('✔ ripgrep found'));
        }
        catch {
            console.log(chalk.yellow('⚠ ripgrep not found. Installing...'));
            switch (platform) {
                case 'win32':
                    try {
                        // Use cmd.exe with /c flag to execute winget in proper Windows shell context
                        execSync('cmd.exe /c winget install -e --id BurntSushi.ripgrep', {
                            stdio: 'inherit',
                            windowsHide: true
                        });
                    }
                    catch {
                        console.log(chalk.yellow('\nAutomatic ripgrep installation failed.'));
                        console.log('Please install ripgrep manually using one of these methods:');
                        console.log('1. Download from: https://github.com/BurntSushi/ripgrep/releases');
                        console.log('2. Run in Command Prompt: winget install -e --id BurntSushi.ripgrep');
                        console.log('3. Run in PowerShell: scoop install ripgrep');
                        throw new Error('ripgrep installation required');
                    }
                    break;
                case 'darwin':
                    try {
                        execSync('brew install ripgrep', { stdio: 'inherit' });
                    }
                    catch {
                        console.log(chalk.yellow('\nAutomatic ripgrep installation failed.'));
                        console.log('Please install ripgrep manually:');
                        console.log('brew install ripgrep');
                        throw new Error('ripgrep installation required');
                    }
                    break;
                default:
                    console.log('Please install ripgrep using your system package manager:');
                    console.log('Ubuntu/Debian: sudo apt-get install ripgrep');
                    console.log('Fedora: sudo dnf install ripgrep');
                    console.log('Or visit: https://github.com/BurntSushi/ripgrep#installation');
                    throw new Error('ripgrep installation required');
            }
        }
    }
    catch (error) {
        if (error instanceof Error && error.message === 'ripgrep installation required') {
            throw error;
        }
        console.log(chalk.yellow('⚠ Could not check for ripgrep'));
        throw new Error('Failed to check for ripgrep installation');
    }
    // Check uvx
    try {
        const { execSync } = await import('child_process');
        try {
            execSync('uvx --version', { stdio: 'ignore' });
            console.log(chalk.green('✔ uvx found'));
        }
        catch {
            console.log(chalk.yellow('⚠ uvx not found. Installing...'));
            switch (platform) {
                case 'win32':
                    try {
                        execSync('powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"', {
                            stdio: 'inherit',
                            windowsHide: true
                        });
                    }
                    catch {
                        console.log(chalk.yellow('\nAutomatic uvx installation failed.'));
                        console.log('Please install uvx manually:');
                        console.log('1. Run in PowerShell: irm https://astral.sh/uv/install.ps1 | iex');
                        console.log('2. Or visit: https://github.com/astral/uv#installation');
                        throw new Error('uvx installation required');
                    }
                    break;
                case 'darwin':
                default:
                    try {
                        execSync('curl -LsSf https://astral.sh/uv/install.sh | sh', { stdio: 'inherit' });
                    }
                    catch {
                        console.log(chalk.yellow('\nAutomatic uvx installation failed.'));
                        console.log('Please install uvx manually:');
                        console.log('curl -LsSf https://astral.sh/uv/install.sh | sh');
                        console.log('Or visit: https://github.com/astral/uv#installation');
                        throw new Error('uvx installation required');
                    }
            }
        }
    }
    catch (error) {
        if (error instanceof Error && error.message === 'uvx installation required') {
            throw error;
        }
        console.log(chalk.yellow('⚠ Could not check for uvx'));
        throw new Error('Failed to check for uvx installation');
    }
    // Install desktopCommander globally on Windows for proper .cmd shim
    if (platform === 'win32') {
        try {
            const { execSync } = await import('child_process');
            try {
                execSync('npm install -g @wonderwhy-er/desktop-commander', { stdio: 'inherit' });
                console.log(chalk.green('✔ Installed desktopCommander globally'));
            }
            catch {
                console.log(chalk.yellow('\nAutomatic desktopCommander installation failed.'));
                console.log('Please install manually: npm install -g @wonderwhy-er/desktop-commander');
            }
        }
        catch (error) {
            console.log(chalk.yellow('⚠ Could not install desktopCommander'));
        }
    }
}
export async function findConfigPaths() {
    const home = homedir();
    const platform = process.platform;
    // Get VS Code settings path based on platform
    let vscodePath;
    if (platform === 'win32') {
        // Use proper Windows default paths
        const appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
        vscodePath = join(appData, 'Code', 'User');
    }
    else if (platform === 'linux') {
        vscodePath = join(home, '.config', 'Code', 'User');
    }
    else {
        vscodePath = join(home, 'Library', 'Application Support', 'Code', 'User');
    }
    // Create VS Code settings directory if it doesn't exist
    try {
        await mkdir(vscodePath, { recursive: true });
        console.log(chalk.green('✔ Created VS Code settings directory'));
    }
    catch (err) {
        console.log(chalk.yellow('⚠ Could not create VS Code settings directory'));
    }
    // Get Cursor path based on platform
    let cursorPath;
    if (platform === 'win32') {
        // Use proper Windows default paths
        const appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
        cursorPath = join(appData, '.cursor');
    }
    else {
        cursorPath = join(home, '.cursor');
    }
    // Create Cursor directory if it doesn't exist
    try {
        await mkdir(cursorPath, { recursive: true });
        console.log(chalk.green('✔ Created Cursor settings directory'));
    }
    catch (err) {
        console.log(chalk.yellow('⚠ Could not create Cursor settings directory'));
    }
    let candidates = [];
    if (platform === 'win32') {
        // Standard VS Code
        candidates.push({
            cline: join(process.env.APPDATA || '', 'Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json'),
            claude: join(process.env.APPDATA || '', 'Claude/claude_desktop_config.json'),
            vscode: join(vscodePath, 'settings.json'),
            cursor: join(cursorPath, 'mcp.json')
        });
        // VS Code Insiders
        candidates.push({
            cline: join(process.env.APPDATA || '', 'Code - Insiders/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json'),
            claude: join(process.env.APPDATA || '', 'Claude/claude_desktop_config.json'),
            vscode: join(vscodePath, 'settings.json'),
            cursor: join(cursorPath, 'mcp.json')
        });
    }
    else if (platform === 'linux') {
        // Remote‐SSH / WSL
        candidates.push({
            cline: join(home, '.vscode-server/data/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json'),
            claude: join(home, '.vscode-server/data/User/globalStorage/saoudrizwan.claude-dev/settings/claude_desktop_config.json'),
            vscode: join(vscodePath, 'settings.json'),
            cursor: join(cursorPath, 'mcp.json')
        });
        // Local VS Code
        candidates.push({
            cline: join(home, '.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json'),
            claude: join(home, '.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/claude_desktop_config.json'),
            vscode: join(vscodePath, 'settings.json'),
            cursor: join(cursorPath, 'mcp.json')
        });
    }
    else {
        // macOS
        candidates.push({
            cline: join(home, 'Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json'),
            claude: join(home, 'Library/Application Support/Claude/claude_desktop_config.json'),
            vscode: join(vscodePath, 'settings.json'),
            cursor: join(cursorPath, 'mcp.json')
        });
    }
    const result = {
        // Always include VS Code path since we created the directory
        vscode: join(vscodePath, 'settings.json')
    };
    for (const { cline, claude, cursor } of candidates) {
        try {
            await access(cline);
            result.cline = cline;
            console.log(chalk.green(`✔ Cline config found at ${cline}`));
        }
        catch {
            // not found here
        }
        try {
            await access(claude);
            result.claude = claude;
            console.log(chalk.green(`✔ Claude Desktop config found at ${claude}`));
        }
        catch {
            // not found here
        }
        try {
            await access(cursor);
            result.cursor = cursor;
            console.log(chalk.green(`✔ Cursor config found at ${cursor}`));
        }
        catch {
            // not found here
        }
        // stop as soon as we find something
        if (result.cline || result.claude || result.cursor)
            break;
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
    // On Windows, temporarily remove the preinstall script before installing
    if (process.platform === 'win32') {
        const pkgPath = join(config.deeboPath, 'package.json');
        const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
        const originalPreinstall = pkg.scripts.preinstall;
        delete pkg.scripts.preinstall;
        await writeFile(pkgPath, JSON.stringify(pkg, null, 2));
        try {
            execSync('npm install', { cwd: config.deeboPath, stdio: 'inherit' });
            console.log(chalk.green('✔ Installed dependencies'));
            // Restore the preinstall script
            pkg.scripts.preinstall = originalPreinstall;
            await writeFile(pkgPath, JSON.stringify(pkg, null, 2));
        }
        catch (err) {
            // Restore the preinstall script even if install fails
            pkg.scripts.preinstall = originalPreinstall;
            await writeFile(pkgPath, JSON.stringify(pkg, null, 2));
            throw err;
        }
    }
    else {
        execSync('npm install', { cwd: config.deeboPath, stdio: 'inherit' });
        console.log(chalk.green('✔ Installed dependencies'));
    }
    // Build project
    execSync('npm run build', { cwd: config.deeboPath, stdio: 'inherit' });
    console.log(chalk.green('✔ Built project'));
}
export async function writeEnvFile(config) {
    let envContent = `MOTHER_HOST=${config.motherHost}
MOTHER_MODEL=${config.motherModel}
SCENARIO_HOST=${config.scenarioHost}
SCENARIO_MODEL=${config.scenarioModel}
${getApiKeyEnvVar(config.motherHost)}=${config.motherApiKey}`;
    // Add scenario API key if different from mother
    if (config.scenarioHost !== config.motherHost && config.scenarioApiKey) {
        envContent += `\n${getApiKeyEnvVar(config.scenarioHost)}=${config.scenarioApiKey}`;
    }
    envContent += `\nUSE_MEMORY_BANK=true
NODE_ENV=development`;
    await writeFile(config.envPath, envContent);
    console.log(chalk.green('✔ Created environment file'));
}
function maskApiKey(key) {
    if (!key)
        return '';
    const start = key.substring(0, 8);
    const end = key.substring(key.length - 4);
    return `${start}...${end}`;
}
function getDisplayConfig(config, deeboConfig) {
    const displayConfig = {
        deebo: JSON.parse(JSON.stringify(deeboConfig))
    };
    // Mask API keys in env
    const motherKeyVar = getApiKeyEnvVar(config.motherHost);
    if (displayConfig.deebo.env[motherKeyVar]) {
        displayConfig.deebo.env[motherKeyVar] = maskApiKey(config.motherApiKey);
    }
    if (config.scenarioHost !== config.motherHost && config.scenarioApiKey) {
        const scenarioKeyVar = getApiKeyEnvVar(config.scenarioHost);
        if (displayConfig.deebo.env[scenarioKeyVar]) {
            displayConfig.deebo.env[scenarioKeyVar] = maskApiKey(config.scenarioApiKey);
        }
    }
    return displayConfig;
}
export async function updateMcpConfig(config) {
    const serverConfig = {
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
            ...(config.scenarioHost !== config.motherHost && config.scenarioApiKey ? {
                [getApiKeyEnvVar(config.scenarioHost)]: config.scenarioApiKey
            } : {})
        },
        transportType: 'stdio'
    };
    const fullConfig = {
        deebo: serverConfig
    };
    // Create display config with masked API keys
    const displayConfig = getDisplayConfig(config, serverConfig);
    // Update Cline config if available
    if (config.clineConfigPath) {
        const clineConfig = JSON.parse(await readFile(config.clineConfigPath, 'utf8'));
        clineConfig.mcpServers.deebo = serverConfig;
        await writeFile(config.clineConfigPath, JSON.stringify(clineConfig, null, 2));
        console.log(chalk.green('✔ Updated Cline configuration'));
    }
    // Update Claude config if available
    if (config.claudeConfigPath) {
        const claudeConfig = JSON.parse(await readFile(config.claudeConfigPath, 'utf8'));
        claudeConfig.mcpServers.deebo = serverConfig;
        await writeFile(config.claudeConfigPath, JSON.stringify(claudeConfig, null, 2));
        console.log(chalk.green('✔ Updated Claude Desktop configuration'));
    }
    // Update Cursor config if available
    if (config.cursorConfigPath) {
        try {
            let cursorConfig = { mcpServers: {} };
            try {
                // Try to read existing config
                cursorConfig = JSON.parse(await readFile(config.cursorConfigPath, 'utf8'));
            }
            catch {
                // File doesn't exist or is empty, use empty config
            }
            // Add Deebo config without overwriting other servers
            cursorConfig.mcpServers = {
                ...cursorConfig.mcpServers,
                deebo: serverConfig
            };
            // Create parent directory if it doesn't exist
            await mkdir(dirname(config.cursorConfigPath), { recursive: true });
            // Write config file
            await writeFile(config.cursorConfigPath, JSON.stringify(cursorConfig, null, 2));
            console.log(chalk.green('✔ Updated Cursor configuration'));
            console.log(chalk.dim(`  Config file: ${config.cursorConfigPath}`));
        }
        catch (err) {
            console.log(chalk.yellow('⚠ Could not update Cursor configuration'));
            console.log(chalk.dim(err instanceof Error ? err.message : String(err)));
        }
    }
    // Update VS Code settings if available
    if (config.vscodePath) {
        try {
            let settings = {};
            try {
                settings = JSON.parse(await readFile(config.vscodePath, 'utf8'));
            }
            catch {
                // File doesn't exist or is empty, use empty object
            }
            // Add MCP settings while preserving existing settings
            const existingSettings = settings;
            existingSettings.mcp = existingSettings.mcp || {};
            existingSettings.mcp.servers = existingSettings.mcp.servers || {};
            existingSettings.mcp.servers.deebo = serverConfig;
            existingSettings['chat.mcp.enabled'] = true;
            // Write settings file with merged settings
            const mergedSettings = {
                ...existingSettings
            };
            // Create parent directory if it doesn't exist
            await mkdir(dirname(config.vscodePath), { recursive: true });
            // Write settings file with merged settings
            await writeFile(config.vscodePath, JSON.stringify(mergedSettings, null, 2));
            console.log(chalk.green('✔ Updated VS Code settings'));
            console.log(chalk.dim(`  Settings file: ${config.vscodePath}`));
        }
        catch (err) {
            console.log(chalk.yellow('⚠ Could not update VS Code settings'));
            console.log(chalk.dim(err instanceof Error ? err.message : String(err)));
        }
    }
    return { fullConfig, displayConfig };
}
function getDefaultModel(host) {
    switch (host) {
        case 'openrouter':
            return 'anthropic/claude-3.5-sonnet';
        case 'anthropic':
            return 'claude-3-sonnet-20240229';
        case 'gemini':
            return 'gemini-2.5-pro-preview-03-25';
        default:
            return 'anthropic/claude-3.5-sonnet';
    }
}
function getApiKeyEnvVar(host) {
    switch (host) {
        case 'openrouter':
            return 'OPENROUTER_API_KEY';
        case 'openai':
            return 'OPENAI_API_KEY';
        case 'anthropic':
            return 'ANTHROPIC_API_KEY';
        case 'gemini':
            return 'GEMINI_API_KEY';
        default:
            return 'OPENROUTER_API_KEY';
    }
}
// Removed the pingInstallation function - implemented directly in index.ts
