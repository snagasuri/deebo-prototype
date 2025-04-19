#!/usr/bin/env node
import { homedir, userInfo } from 'os';
import { createHash } from 'crypto';
import https from 'https';
import { join } from 'path';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { LlmHostSchema } from './types.js';
import { checkPrerequisites, findConfigPaths, setupDeeboDirectory, writeEnvFile, updateMcpConfig, defaultModels } from './utils.js';
// Optional ping for analytics
async function sendPing() {
    try {
        const hash = createHash("sha256")
            .update(process.cwd() + userInfo().username)
            .digest("hex")
            .slice(0, 12);
        const req = https.request({
            method: "POST",
            hostname: "deebo-active-counter.ramnag2003.workers.dev",
            path: "/ping",
            headers: { "content-type": "application/json" }
        }, res => res.on("data", () => { }));
        req.on("error", () => { });
        req.write(JSON.stringify({ hash }));
        req.end();
    }
    catch (error) { }
}
async function main() {
    try {
        process.stdout.write('\\u001b[2J\\u001b[0;0H');
        console.log(chalk.blue('==== Deebo Setup ====\
'));
        await checkPrerequisites();
        const configPaths = await findConfigPaths();
        // Get Mother agent config
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
        // Get Scenario agent config
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
        const { apiKey: mKey } = await inquirer.prompt([{
                type: 'password',
                name: 'apiKey',
                message: `Enter your ${motherHost.toUpperCase()}_API_KEY:`
            }]);
        motherApiKey = mKey;
        if (scenarioHost !== motherHost) {
            const { apiKey: sKey } = await inquirer.prompt([{
                    type: 'password',
                    name: 'apiKey',
                    message: `Enter your ${scenarioHost.toUpperCase()}_API_KEY:`
                }]);
            scenarioApiKey = sKey;
        }
        else {
            scenarioApiKey = motherApiKey;
        }
        // Setup paths and config
        const home = homedir();
        const deeboPath = join(home, '.deebo');
        const envPath = join(deeboPath, '.env');
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
        await setupDeeboDirectory(config);
        await writeEnvFile(config);
        await updateMcpConfig(config);
        await sendPing().catch(() => { });
        console.log(chalk.green('\
✔ Deebo installation complete!'));
        console.log(chalk.blue('\
Next steps:'));
        console.log('1. Restart your MCP client (Cline/Claude Desktop)');
        console.log('2. Run npx deebo-doctor to verify the installation');
    }
    catch (error) {
        console.error(chalk.red('\
✖ Installation failed:'));
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}
main().catch(console.error);
