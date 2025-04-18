#!/usr/bin/env node
import { homedir, userInfo } from 'os';
import { createHash } from 'crypto';
import https from 'https';
import { join } from 'path';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { LlmHostSchema } from './types.js';
import {
  checkPrerequisites,
  findConfigPaths,
  setupDeeboDirectory,
  writeEnvFile,
  updateMcpConfig,
  updateAgentConfig,
  removeProviderConfig,
  defaultModels
} from './utils.js';

// Parse command line arguments
const args = process.argv.slice(2);
const command = args[0];

if (command === 'providers') {
  manageProviders().catch(console.error);
} else if (command === 'ping') {
  sendPing().catch(console.error);
} else {
  main().catch(console.error);
}

async function sendPing() {
  try {
    const hash = createHash("sha256")
      .update(process.cwd() + userInfo().username)
      .digest("hex")
      .slice(0, 12);  // short anon ID

    const req = https.request(
      { 
        method: "POST", 
        hostname: "deebo-active-counter.ramnag2003.workers.dev", 
        path: "/ping", 
        headers: { "content-type": "application/json" } 
      },
      res => res.on("data", () => {})
    );
    req.on("error", () => {}); // swallow errors
    req.write(JSON.stringify({ hash }));
    req.end();

    console.log("✅ pinged Deebo HQ");
  } catch (error) {
    // Silently handle errors to avoid disrupting user flow
  }
}

async function manageProviders() {
  try {
    process.stdout.write('\u001b[2J\u001b[0;0H'); // Clear console
    console.log(chalk.blue('==== Deebo Provider Management ====\n'));
    
    // Check prerequisites
    await checkPrerequisites();

    // Find config paths
    const configPaths = await findConfigPaths();

    while (true) {
      // Get action
      const { action } = await inquirer.prompt([{
        type: 'list',
        name: 'action',
        message: 'Choose action:',
        choices: [
          'Configure Mother Agent',
          'Configure Scenario Agent',
          'Remove Provider',
          'Exit'
        ]
      }]);

      if (action === 'Exit') {
        process.exit(0);
      }

      if (action === 'Remove Provider') {
        const { host } = await inquirer.prompt([{
          type: 'list',
          name: 'host',
          message: 'Choose provider to remove:',
          choices: Object.keys(defaultModels)
        }]);

        const parsedHost = LlmHostSchema.parse(host);
        await removeProviderConfig(configPaths, parsedHost);
        console.log(chalk.green('✔ Removed provider configuration'));
        continue;
      }

      // Configure agent
      const agentType = action === 'Configure Mother Agent' ? 'mother' : 'scenario';
      let apiKey = '';
      let isValidKey = false;

      while (!isValidKey) {
        const { host } = await inquirer.prompt([{
          type: 'list',
          name: 'host',
          message: `Choose LLM provider for ${agentType} agent:`,
          choices: Object.keys(defaultModels)
        }]);

        const parsedHost = LlmHostSchema.parse(host);

        const { model } = await inquirer.prompt([{
          type: 'input',
          name: 'model',
          message: chalk.dim(`Enter model (default is ${defaultModels[parsedHost].split('/').pop()})`),
          default: defaultModels[parsedHost]
        }]);

        const result = await inquirer.prompt([{
          type: 'password',
          name: 'apiKey',
          message: `Enter your ${host.toUpperCase()}_API_KEY:`
        }]);
        apiKey = result.apiKey;

        // Show API key preview
        console.log(chalk.dim(`API key preview: ${apiKey.substring(0, 8)}...`));
        const { confirmKey } = await inquirer.prompt([{
          type: 'confirm',
          name: 'confirmKey',
          message: 'Is this API key correct?',
          default: true
        }]);

        if (!confirmKey) {
          const { retry } = await inquirer.prompt([{
            type: 'confirm',
            name: 'retry',
            message: 'Would you like to try again?',
            default: true
          }]);
          if (!retry) {
            throw new Error('API key confirmation failed. Please try again.');
          }
          continue;
        }

        await updateAgentConfig(configPaths, agentType, parsedHost, model, apiKey);
        console.log(chalk.green(`✔ Updated ${agentType} agent configuration`));
        console.log(chalk.blue('\nNext steps:'));
        console.log('1. Restart your MCP client (Cline/Claude Desktop)');
        console.log('2. Run npx deebo-doctor to verify the installation');
        isValidKey = true;
      }
    }
  } catch (error) {
    console.error(chalk.red('\n✖ Provider management failed:'));
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function main() {
  try {
    process.stdout.write('\u001b[2J\u001b[0;0H'); // Clear console
    console.log(chalk.blue('==== Deebo Setup ====\n'));
    
    // Check prerequisites
    await checkPrerequisites();

    // Find config paths
    const configPaths = await findConfigPaths();

    // Get Mother agent configuration
    const { motherHost } = await inquirer.prompt([{
      type: 'list',
      name: 'motherHost',
      message: 'Choose LLM host for Mother agent:',
      choices: Object.keys(defaultModels)
    }]);

    const parsedMotherHost = LlmHostSchema.parse(motherHost);

    const { motherModel } = await inquirer.prompt([{
      type: 'input',
      name: 'motherModel',
      message: chalk.dim(`Enter model (default is ${defaultModels[parsedMotherHost].split('/').pop()})`),
      default: defaultModels[parsedMotherHost]
    }]);

    // Get Scenario agent configuration
    const { scenarioHost } = await inquirer.prompt([{
      type: 'list',
      name: 'scenarioHost',
      message: 'Choose LLM host for Scenario agents:',
      choices: Object.keys(defaultModels),
      default: parsedMotherHost
    }]);

    const parsedScenarioHost = LlmHostSchema.parse(scenarioHost);

    const { scenarioModel } = await inquirer.prompt([{
      type: 'input',
      name: 'scenarioModel',
      message: chalk.dim(`Enter model (default is ${defaultModels[parsedScenarioHost].split('/').pop()})`),
      default: defaultModels[parsedScenarioHost]
    }]);

    // Get API keys
    let motherApiKey = '';
    let scenarioApiKey = '';
    let isValidKey = false;

    while (!isValidKey) {
      const { apiKey: mKey } = await inquirer.prompt([{
        type: 'password',
        name: 'apiKey',
        message: `Enter your ${motherHost.toUpperCase()}_API_KEY:`
      }]);
      motherApiKey = mKey;

      // Show API key preview
      console.log(chalk.dim(`Mother API key preview: ${motherApiKey.substring(0, 8)}...`));

      if (scenarioHost !== motherHost) {
        const { apiKey: sKey } = await inquirer.prompt([{
          type: 'password',
          name: 'apiKey',
          message: `Enter your ${scenarioHost.toUpperCase()}_API_KEY:`
        }]);
        scenarioApiKey = sKey;
        console.log(chalk.dim(`Scenario API key preview: ${scenarioApiKey.substring(0, 8)}...`));
      } else {
        scenarioApiKey = motherApiKey;
        console.log(chalk.dim(`Using same API key for scenario agent`));
      }

      const { confirmKey } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirmKey',
        message: 'Are these API keys correct?',
        default: true
      }]);

      if (!confirmKey) {
        const { retry } = await inquirer.prompt([{
          type: 'confirm',
          name: 'retry',
          message: 'Would you like to try again?',
          default: true
        }]);
        if (!retry) {
          throw new Error('API key confirmation failed. Please try again.');
        }
        continue;
      }
      isValidKey = true;
    }

    // Setup paths
    const home = homedir();
    const deeboPath = join(home, '.deebo');
    const envPath = join(deeboPath, '.env');

    // Create config object
    const config = {
      deeboPath,
      envPath,
      motherHost: parsedMotherHost,
      motherModel,
      scenarioHost: parsedScenarioHost,
      scenarioModel,
      motherApiKey,
      scenarioApiKey,
      clineConfigPath: configPaths.cline,
      claudeConfigPath: configPaths.claude
    };

    // Setup Deebo
    await setupDeeboDirectory(config);
    await writeEnvFile(config);
    await updateMcpConfig(config);

    console.log(chalk.green('\n✔ Deebo installation complete!'));
    console.log(chalk.blue('\nNext steps:'));
    console.log('1. Restart your MCP client (Cline/Claude Desktop)');
    console.log('2. Run npx deebo-doctor to verify the installation');
    
  } catch (error) {
    console.error(chalk.red('\n✖ Installation failed:'));
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// In ES modules, we don't need this check
// The code is already set up to run main() or manageProviders() based on args
