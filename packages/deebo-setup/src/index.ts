#!/usr/bin/env node
import { homedir } from 'os';
import { join } from 'path';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { LlmHostSchema } from './types.js';
import {
  checkPrerequisites,
  findConfigPaths,
  setupDeeboDirectory,
  writeEnvFile,
  updateMcpConfig
} from './utils.js';

async function main() {
  try {
    // Check prerequisites
    await checkPrerequisites();

    // Find config paths
    const configPaths = await findConfigPaths();

    // Get Mother agent configuration
    const defaultModels: Record<string, string> = {
      openrouter: 'anthropic/claude-3.5-sonnet',
      anthropic: 'claude-3-5-sonnet-20241022',
      gemini: 'gemini-2.5-pro-preview-03-25'
    };

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

    // Get API key
    const { apiKey } = await inquirer.prompt([{
      type: 'password',
      name: 'apiKey',
      message: `Enter your ${motherHost.toUpperCase()}_API_KEY:`
    }]);

    // Show API key preview
    console.log(chalk.dim(`API key preview: ${apiKey.substring(0, 8)}...`));
    const { confirmKey } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirmKey',
      message: 'Is this API key correct?',
      default: true
    }]);

    if (!confirmKey) {
      throw new Error('API key confirmation failed. Please try again.');
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
      apiKey,
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

main();
