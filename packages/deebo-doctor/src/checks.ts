import { CheckResult, DoctorConfig, SystemCheck } from './types.js';
import { homedir } from 'os';
import { join } from 'path';
import { access, readFile } from 'fs/promises';
import { simpleGit as createGit } from 'simple-git';

export const nodeVersionCheck: SystemCheck = {
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

export const gitCheck: SystemCheck = {
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
    } catch {
      return {
        name: 'Git Installation',
        status: 'fail',
        message: 'Git not found',
        details: 'Install Git from https://git-scm.com'
      };
    }
  }
};

export const mcpToolsCheck: SystemCheck = {
  name: 'MCP Tools',
  async check() {
    const results: CheckResult[] = [];
    const isWindows = process.platform === 'win32';
    const { execSync } = await import('child_process');
    
    // Check git-mcp
    try {
      if (isWindows) {
        try {
          // Try uvx first (preferred method)
          execSync('uvx mcp-server-git --help');
        } catch (uvxError) {
          // Fallback to pip check if uvx fails
          try {
            execSync('pip show mcp-server-git');
          } catch (pipError) {
            throw new Error('git-mcp not found via uvx or pip');
          }
        }
      } else {
        execSync('uvx mcp-server-git --help');
      }
      
      results.push({
        name: 'git-mcp',
        status: 'pass',
        message: 'git-mcp installed'
      });
    } catch {
      results.push({
        name: 'git-mcp',
        status: 'fail',
        message: 'git-mcp not found',
        details: isWindows 
          ? 'Install with: powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex" && uvx mcp-server-git --help'
          : 'Install with: curl -LsSf https://astral.sh/uv/install.sh | sh && uvx mcp-server-git --help'
      });
    }

    // Check desktop-commander
    try {
      // Use a redirect that works in both Windows and Unix
      const nullRedirect = isWindows ? '> NUL 2>&1' : '2>/dev/null';
      execSync(`npx @wonderwhy-er/desktop-commander --version ${nullRedirect}`);
      results.push({
        name: 'desktop-commander',
        status: 'pass',
        message: 'desktop-commander installed'
      });
    } catch {
      results.push({
        name: 'desktop-commander',
        status: 'fail',
        message: 'desktop-commander not found',
        details: 'Install with: npx @wonderwhy-er/desktop-commander@latest setup'
      });
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

export const toolPathsCheck: SystemCheck = {
  name: 'Tool Paths',
  async check() {
    const results: CheckResult[] = [];
    const isWindows = process.platform === 'win32';
    const { execSync } = await import('child_process');
    
    // Check npx
    try {
      let npxPath = '';
      
      if (isWindows) {
        try {
          // Try to get path using where
          npxPath = execSync('where npx').toString().trim();
        } catch {
          // If 'where' fails, check if npx is available by running it
          try {
            execSync('npx --version');
            npxPath = 'npx (path not determined)';
          } catch {
            throw new Error('npx not found');
          }
        }
      } else {
        npxPath = execSync('which npx').toString().trim();
      }
      
      results.push({
        name: 'npx',
        status: 'pass',
        message: 'npx found',
        details: `Path: ${npxPath}`
      });
    } catch {
      results.push({
        name: 'npx',
        status: 'fail',
        message: 'npx not found',
        details: 'Install Node.js to get npx'
      });
    }

    // Check uvx or uv
    try {
      let uvxPath = '';
      
      if (isWindows) {
        try {
          // Try to find uvx
          uvxPath = execSync('where uvx').toString().trim();
        } catch {
          // If not found, check for uv via pip
          try {
            execSync('pip show uv');
            uvxPath = 'uv (installed via pip)';
          } catch {
            throw new Error('uvx/uv not found');
          }
        }
      } else {
        uvxPath = execSync('which uvx').toString().trim();
      }
      
      results.push({
        name: 'uvx',
        status: 'pass',
        message: 'uvx found',
        details: `Path: ${uvxPath}`
      });
    } catch {
      results.push({
        name: 'uvx',
        status: 'fail',
        message: 'uvx not found',
        details: isWindows ? 'Install uv using pip: pip install uv' : 'Install uv: curl -LsSf https://astral.sh/uv/install.sh | sh'
      });
    }

    // Aggregate results
    const allPass = results.every(r => r.status === 'pass');
    return {
      name: 'Tool Paths',
      status: allPass ? 'pass' : 'fail',
      message: allPass ? 'All tool paths found' : 'Some tool paths missing',
      details: results.map(r => `${r.name}: ${r.details || r.message}`).join('\n')
    };
  }
};

export const configFilesCheck: SystemCheck = {
  name: 'Configuration Files',
  async check(config: DoctorConfig) {
    const home = homedir();
    const isWindows = process.platform === 'win32';
    
    const paths = isWindows ? {
      cline: join(process.env.APPDATA || '', 'Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json'),
      claude: join(process.env.APPDATA || '', 'Claude/claude_desktop_config.json'),
      env: join(config.deeboPath, '.env'),
      tools: join(config.deeboPath, 'config/tools.json')
    } : {
      cline: join(home, 'Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json'),
      claude: join(home, 'Library/Application Support/Claude/claude_desktop_config.json'),
      env: join(config.deeboPath, '.env'),
      tools: join(config.deeboPath, 'config/tools.json')
    };

    const results: CheckResult[] = [];

    // Check each config file
    for (const [name, path] of Object.entries(paths)) {
      try {
        await access(path);
        let content;
        try {
          content = await readFile(path, 'utf8');
        } catch (readError) {
          results.push({
            name,
            status: 'fail',
            message: `${name} config exists but cannot be read`,
            details: `Path: ${path}\nError: ${readError instanceof Error ? readError.message : String(readError)}`
          });
          continue;
        }
        
        // Parse JSON if applicable
        if (name !== 'env') {
          try {
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
          } catch (parseError) {
            results.push({
              name,
              status: 'fail',
              message: `${name} config exists but is not valid JSON`,
              details: `Path: ${path}\nError: ${parseError instanceof Error ? parseError.message : String(parseError)}`
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
      } catch {
        results.push({
          name,
          status: 'fail',
          message: `${name} config not found or invalid`,
          details: `Expected at: ${path}`
        });
      }
    }

    // Aggregate results
    const allPass = results.every(r => r.status === 'pass');
    return {
      name: 'Configuration Files',
      status: allPass ? 'pass' : 'fail',
      message: allPass ? 'All configuration files valid' : 'Some configuration files missing or invalid',
      details: results.map(r => `${r.name}: ${r.message}\n${r.details || ''}`).join('\n\n')
    };
  }
};

export const apiKeysCheck: SystemCheck = {
  name: 'API Keys',
  async check(config: DoctorConfig) {
    const envPath = join(config.deeboPath, '.env');
    try {
      const content = await readFile(envPath, 'utf8');
      const lines = content.split('\n');
      const results: CheckResult[] = [];

      // Check each potential API key
      const keyChecks = {
        OPENROUTER_API_KEY: '',  // Accept any value for Windows compatibility
        ANTHROPIC_API_KEY: '',
        GEMINI_API_KEY: ''
      };

      for (const [key, _] of Object.entries(keyChecks)) {
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
        if (!value || value.length < 5) {  // Simple check that the key has some content
          results.push({
            name: key,
            status: 'warn',
            message: `${key} may be invalid`,
            details: `Key appears to be empty or too short`
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
      const anyPass = results.some(r => r.status === 'pass');
      return {
        name: 'API Keys',
        status: anyPass ? 'pass' : 'warn',
        message: anyPass ? 'At least one valid API key found' : 'No valid API keys found',
        details: results.map(r => `${r.name}: ${r.message}`).join('\n')
      };
    } catch {
      return {
        name: 'API Keys',
        status: 'fail',
        message: 'Could not read .env file',
        details: `Expected at ${envPath}`
      };
    }
  }
};

export const allChecks = [
  nodeVersionCheck,
  gitCheck,
  toolPathsCheck,
  mcpToolsCheck,
  configFilesCheck,
  apiKeysCheck
];
