import { homedir } from 'os';
import { join } from 'path';
import { access, readFile } from 'fs/promises';
import { simpleGit as createGit } from 'simple-git';
import { execSync } from 'child_process';
export const nodeVersionCheck = {
    name: 'Node.js Version',
    async check() {
        const version = process.version;
        if (version.startsWith('v18') || version.startsWith('v20') || version.startsWith('v22')) {
            return {
                name: 'Node.js Version',
                status: 'pass',
                message: `Node ${version} detected`,
            };
        }
        return {
            name: 'Node.js Version',
            status: 'fail',
            message: `Node.js v18+ required, found ${version}`,
            details: 'Install Node.js v18 or later from https://nodejs.org'
        };
    }
};
export const gitCheck = {
    name: 'Git Installation',
    async check() {
        try {
            const git = createGit();
            const version = await git.version();
            return {
                name: 'Git Installation',
                status: 'pass',
                message: `Git ${version} detected`,
            };
        }
        catch {
            return {
                name: 'Git Installation',
                status: 'fail',
                message: 'Git not found',
                details: 'Install Git from https://git-scm.com'
            };
        }
    }
};
export const mcpToolsCheck = {
    name: 'MCP Tools',
    async check() {
        const results = [];
        // Check git-mcp
        try {
            const { execSync } = await import('child_process');
            execSync('uvx mcp-server-git --help');
            results.push({
                name: 'git-mcp',
                status: 'pass',
                message: 'git-mcp installed'
            });
        }
        catch {
            results.push({
                name: 'git-mcp',
                status: 'fail',
                message: 'git-mcp not found',
                details: 'Install with: uvx mcp-server-git --help'
            });
        }
        // Check desktop-commander
        if (process.platform === 'win32') {
            // On Windows, check for the .cmd shim which is required for proper stdin/stdout handling
            // Use actual npm prefix instead of assuming %APPDATA%\npm for nvm compatibility
            let cmdPath;
            try {
                const npmPrefix = execSync('npm config get prefix').toString().trim();
                cmdPath = join(npmPrefix, 'desktop-commander.cmd');
            }
            catch {
                // Fallback to traditional roaming path if npm command fails
                const base = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
                cmdPath = join(base, 'npm', 'desktop-commander.cmd');
            }
            try {
                await access(cmdPath);
                results.push({
                    name: 'desktop-commander',
                    status: 'pass',
                    message: 'desktop-commander.cmd found',
                    details: `Path: ${cmdPath}`
                });
            }
            catch {
                results.push({
                    name: 'desktop-commander',
                    status: 'fail',
                    message: 'desktop-commander.cmd not found',
                    details: 'Install globally with: npm install -g @wonderwhy-er/desktop-commander'
                });
            }
        }
        else {
            // On non-Windows, just check if it's installed
            try {
                const { execSync } = await import('child_process');
                execSync('npx @wonderwhy-er/desktop-commander --help 2>/dev/null');
                results.push({
                    name: 'desktop-commander',
                    status: 'pass',
                    message: 'desktop-commander installed'
                });
            }
            catch {
                results.push({
                    name: 'desktop-commander',
                    status: 'fail',
                    message: 'desktop-commander not found',
                    details: 'Install with: npx @wonderwhy-er/desktop-commander setup'
                });
            }
        }
        // Aggregate results
        const allPass = results.every(r => r.status === 'pass');
        return {
            name: 'MCP Tools',
            status: allPass ? 'pass' : 'fail',
            message: allPass ? 'All MCP tools installed' : 'Some MCP tools missing',
            details: results.map(r => `${r.name}: ${r.message}`).join('\n')
        };
    }
};
export const toolPathsCheck = {
    name: 'Tool Paths',
    async check() {
        const results = [];
        const isWindows = process.platform === 'win32';
        const { execSync } = await import('child_process');
        // Check node
        try {
            const nodePath = execSync(isWindows ? 'cmd.exe /c where node.exe' : 'which node').toString().trim().split('\n')[0];
            results.push({
                name: 'node',
                status: 'pass',
                message: 'node found',
                details: `Path: ${nodePath}`
            });
        }
        catch {
            results.push({
                name: 'node',
                status: 'fail',
                message: 'node not found',
                details: 'Install Node.js from https://nodejs.org'
            });
        }
        // Check npm
        try {
            const npmPath = execSync(isWindows ? 'cmd.exe /c where npm.cmd' : 'which npm').toString().trim().split('\n')[0];
            results.push({
                name: 'npm',
                status: 'pass',
                message: 'npm found',
                details: `Path: ${npmPath}`
            });
        }
        catch {
            results.push({
                name: 'npm',
                status: 'fail',
                message: 'npm not found',
                details: 'Install Node.js to get npm'
            });
        }
        // Check npx
        try {
            const npxPath = execSync(isWindows ? 'cmd.exe /c where npx.cmd' : 'which npx').toString().trim().split('\n')[0];
            results.push({
                name: 'npx',
                status: 'pass',
                message: 'npx found',
                details: `Path: ${npxPath}`
            });
        }
        catch {
            results.push({
                name: 'npx',
                status: 'fail',
                message: 'npx not found',
                details: 'Install Node.js to get npx'
            });
        }
        // Check uvx 
        try {
            const uvxPath = execSync(isWindows ? 'cmd.exe /c where uvx.exe' : 'which uvx').toString().trim().split('\n')[0];
            results.push({
                name: 'uvx',
                status: 'pass',
                message: 'uvx found',
                details: `Path: ${uvxPath}`
            });
        }
        catch {
            results.push({
                name: 'uvx',
                status: 'fail',
                message: 'uvx not found',
                details: isWindows
                    ? 'Run in PowerShell: irm https://astral.sh/uv/install.ps1 | iex'
                    : 'Run: curl -LsSf https://astral.sh/uv/install.sh | sh'
            });
        }
        // Check git
        try {
            const gitPath = execSync(isWindows ? 'cmd.exe /c where git.exe' : 'which git').toString().trim().split('\n')[0];
            results.push({
                name: 'git',
                status: 'pass',
                message: 'git found',
                details: `Path: ${gitPath}`
            });
        }
        catch {
            results.push({
                name: 'git',
                status: 'fail',
                message: 'git not found',
                details: 'Install git from https://git-scm.com'
            });
        }
        // Check ripgrep
        try {
            const rgPath = execSync(isWindows ? 'cmd.exe /c where rg.exe' : 'which rg').toString().trim().split('\n')[0];
            results.push({
                name: 'ripgrep',
                status: 'pass',
                message: 'ripgrep found',
                details: `Path: ${rgPath}`
            });
        }
        catch {
            results.push({
                name: 'ripgrep',
                status: 'fail',
                message: 'ripgrep not found',
                details: isWindows
                    ? 'Run in Command Prompt: winget install -e --id BurntSushi.ripgrep'
                    : 'Run: brew install ripgrep'
            });
        }
        // Check environment paths
        const pathEnv = process.env.PATH || '';
        const pathSeparator = isWindows ? ';' : ':';
        const paths = pathEnv.split(pathSeparator);
        // Common tool directories that should be in PATH
        const expectedPaths = isWindows
            ? ['\\npm', '\\git', '\\nodejs']
            : ['/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin'];
        const missingPaths = expectedPaths.filter(expected => !paths.some(p => p.toLowerCase().includes(expected.toLowerCase())));
        if (missingPaths.length > 0) {
            results.push({
                name: 'PATH',
                status: 'warn',
                message: 'Some expected paths missing from PATH',
                details: `Missing: ${missingPaths.join(', ')}\nCurrent PATH: ${pathEnv}`
            });
        }
        else {
            results.push({
                name: 'PATH',
                status: 'pass',
                message: 'All expected paths found in PATH',
                details: `PATH: ${pathEnv}`
            });
        }
        // Aggregate results
        const allPass = results.every(r => r.status === 'pass');
        const hasFails = results.some(r => r.status === 'fail');
        return {
            name: 'Tool Paths',
            status: allPass ? 'pass' : hasFails ? 'fail' : 'warn',
            message: allPass
                ? 'All tool paths found'
                : hasFails
                    ? 'Some required tools missing'
                    : 'Tools found but some paths may need attention',
            details: results.map(r => `${r.name}: ${r.message}\n  ${r.details || ''}`).join('\n\n') + `\n\nTroubleshooting Tips:
1. If deebo is failing at runtime (when starting a session), it's likely the system cannot find paths for MCP tools (git-mcp and desktopCommander). Run 'where uvx' to verify uvx is in your PATH.

2. If this check says "unable to find tool paths" even after installation:
   - Make sure to add the uvx/node paths to your environment
   - On Windows, check if uvx.exe is in your PATH by running 'where uvx'
   - Try closing and reopening your terminal to refresh environment variables

3. If deebo fails in the middle of a run after spawning scenario agents:
   - Don't worry! This is not a critical failure
   - You can always start a new deebo session
   - Tell it to look at its memory bank from the previous run
   - The memory bank contains all the progress and findings so far`
        };
    }
};
export const configFilesCheck = {
    name: 'Configuration Files',
    async check(config) {
        const home = homedir();
        const isWindows = process.platform === 'win32';
        // Get VS Code and Cursor paths based on platform
        const vscodePath = isWindows
            ? join(process.env.APPDATA || '', 'Code', 'User', 'settings.json')
            : join(home, isWindows ? '' : 'Library/Application Support/Code/User/settings.json');
        const cursorPath = isWindows
            ? join(process.env.APPDATA || '', '.cursor', 'mcp.json')
            : join(home, '.cursor', 'mcp.json');
        const paths = isWindows ? {
            cline: join(process.env.APPDATA || '', 'Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json'),
            claude: join(process.env.APPDATA || '', 'Claude/claude_desktop_config.json'),
            vscode: vscodePath,
            cursor: cursorPath,
            env: join(config.deeboPath, '.env'),
            tools: join(config.deeboPath, 'config/tools.json')
        } : {
            cline: join(home, 'Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json'),
            claude: join(home, 'Library/Application Support/Claude/claude_desktop_config.json'),
            vscode: vscodePath,
            cursor: cursorPath,
            env: join(config.deeboPath, '.env'),
            tools: join(config.deeboPath, 'config/tools.json')
        };
        const results = [];
        // Check each config file
        for (const [name, path] of Object.entries(paths)) {
            try {
                await access(path);
                const content = await readFile(path, 'utf8');
                // Parse JSON if applicable
                if (name !== 'env') {
                    const json = JSON.parse(content);
                    // Check if Deebo is configured in MCP configs
                    if ((name === 'cline' || name === 'claude') && (!json.mcpServers?.deebo)) {
                        results.push({
                            name,
                            status: 'fail',
                            message: `${name} config exists but Deebo not configured`,
                            details: `Path: ${path}\nAdd Deebo configuration to mcpServers`
                        });
                        continue;
                    }
                    // Check tools.json structure
                    if (name === 'tools' && (!json.tools?.desktopCommander || !json.tools?.['git-mcp'])) {
                        results.push({
                            name,
                            status: 'fail',
                            message: `${name} config exists but missing required tools`,
                            details: `Path: ${path}\nMissing one or more required tools: desktopCommander, git-mcp`
                        });
                        continue;
                    }
                }
                results.push({
                    name,
                    status: 'pass',
                    message: `${name} config found and valid`,
                    details: `Path: ${path}`
                });
            }
            catch {
                results.push({
                    name,
                    status: 'fail',
                    message: `${name} config not found or invalid`,
                    details: `Expected at: ${path}`
                });
            }
        }
        // Check if at least one MCP config is valid (cline, claude, vscode, or cursor)
        const mcpResults = results.filter(r => ['cline', 'claude', 'vscode', 'cursor'].includes(r.name));
        const hasMcpConfig = mcpResults.some(r => r.status === 'pass');
        // Check if core configs (env, tools) are valid
        const coreResults = results.filter(r => r.name === 'env' || r.name === 'tools');
        const corePass = coreResults.every(r => r.status === 'pass');
        return {
            name: 'Configuration Files',
            status: (hasMcpConfig && corePass) ? 'pass' : 'fail',
            message: hasMcpConfig ? 'All configuration files valid' : 'No valid MCP configuration found',
            details: results.map(r => `${r.name}: ${r.message}\n${r.details || ''}`).join('\n\n')
        };
    }
};
export const apiKeysCheck = {
    name: 'API Keys',
    async check(config) {
        const envPath = join(config.deeboPath, '.env');
        try {
            const content = await readFile(envPath, 'utf8');
            const lines = content.split('\n');
            const results = [];
            // Check each potential API key
            const keyChecks = {
                OPENROUTER_API_KEY: 'sk-or-v1-',
                OPENAI_API_KEY: 'sk-',
                ANTHROPIC_API_KEY: 'sk-ant-',
                GEMINI_API_KEY: 'AI'
            };
            for (const [key, prefix] of Object.entries(keyChecks)) {
                const line = lines.find(l => l.startsWith(key));
                if (!line) {
                    results.push({
                        name: key,
                        status: 'warn',
                        message: `${key} not found`
                    });
                    continue;
                }
                const value = line.split('=')[1]?.trim();
                if (!value || !value.startsWith(prefix)) {
                    results.push({
                        name: key,
                        status: 'warn',
                        message: `${key} may be invalid`,
                        details: `Expected prefix: ${prefix}`
                    });
                    continue;
                }
                results.push({
                    name: key,
                    status: 'pass',
                    message: `${key} found and valid`
                });
            }
            // Aggregate results
            const allPass = results.some(r => r.status === 'pass');
            return {
                name: 'API Keys',
                status: allPass ? 'pass' : 'warn',
                message: allPass ? 'At least one valid API key found' : 'No valid API keys found',
                details: results.map(r => `${r.name}: ${r.message}`).join('\n')
            };
        }
        catch {
            return {
                name: 'API Keys',
                status: 'fail',
                message: 'Could not read .env file',
                details: `Expected at ${envPath}`
            };
        }
    }
};
export const guideServerCheck = {
    name: 'Guide Server',
    async check(config) {
        const home = homedir();
        const deeboGuidePath = join(home, '.deebo-guide'); // Changed to .deebo-guide
        const results = [];
        // Check guide server files
        const guidePath = join(deeboGuidePath, 'deebo_guide.md'); // Changed to deeboGuidePath
        const serverPath = join(deeboGuidePath, 'guide-server.js'); // Changed to deeboGuidePath
        try {
            await access(guidePath);
            results.push({
                name: 'guide_file',
                status: 'pass',
                message: 'Deebo guide file found',
                details: `Path: ${guidePath}`
            });
        }
        catch {
            results.push({
                name: 'guide_file',
                status: 'fail',
                message: 'Deebo guide file not found',
                details: `Expected at: ${guidePath}`
            });
        }
        try {
            await access(serverPath);
            results.push({
                name: 'server_file',
                status: 'pass',
                message: 'Guide server file found',
                details: `Path: ${serverPath}`
            });
        }
        catch {
            results.push({
                name: 'server_file',
                status: 'fail',
                message: 'Guide server file not found',
                details: `Expected at: ${serverPath}`
            });
        }
        // Check MCP configurations
        const isWindows = process.platform === 'win32';
        const configPaths = isWindows ? {
            cline: join(process.env.APPDATA || '', 'Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json'),
            claude: join(process.env.APPDATA || '', 'Claude/claude_desktop_config.json'),
            cursor: join(process.env.APPDATA || '', '.cursor/mcp.json')
        } : {
            cline: join(home, 'Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json'),
            claude: join(home, 'Library/Application Support/Claude/claude_desktop_config.json'),
            cursor: join(home, '.cursor/mcp.json')
        };
        for (const [name, path] of Object.entries(configPaths)) {
            try {
                const content = await readFile(path, 'utf8');
                const config = JSON.parse(content);
                const guideServer = config.mcpServers?.['deebo-guide'];
                if (!guideServer) {
                    results.push({
                        name: `${name}_config`,
                        status: 'fail',
                        message: `Guide server not configured in ${name}`,
                        details: `Path: ${path}\nMissing 'deebo-guide' in mcpServers`
                    });
                    continue;
                }
                results.push({
                    name: `${name}_config`,
                    status: 'pass',
                    message: `Guide server properly configured in ${name}`,
                    details: `Path: ${path}`
                });
            }
            catch {
                results.push({
                    name: `${name}_config`,
                    status: 'fail',
                    message: `Could not read ${name} config`,
                    details: `Expected at: ${path}`
                });
            }
        }
        // Aggregate results
        const allPass = results.every(r => r.status === 'pass');
        const hasFails = results.some(r => r.status === 'fail');
        return {
            name: 'Guide Server',
            status: allPass ? 'pass' : hasFails ? 'fail' : 'warn',
            message: allPass
                ? 'Guide server files and configuration valid'
                : 'Guide server setup incomplete',
            details: results.map(r => `${r.name}: ${r.message}\n${r.details || ''}`).join('\n\n')
        };
    }
};
export const allChecks = [
    nodeVersionCheck,
    gitCheck,
    toolPathsCheck,
    mcpToolsCheck,
    configFilesCheck,
    apiKeysCheck,
    guideServerCheck
];
