import { z } from 'zod';

// LLM host validation
export const LlmHostSchema = z.enum(['openrouter', 'anthropic', 'gemini']);
export type LlmHost = z.infer<typeof LlmHostSchema>;

// MCP config schema for writing configs
export const McpConfigSchema = z.object({
  mcpServers: z.record(z.object({
    autoApprove: z.array(z.string()),
    disabled: z.boolean(),
    timeout: z.number(),
    command: z.string(),
    args: z.array(z.string()),
    env: z.record(z.string()),
    transportType: z.string()
  }))
});

export type McpConfig = z.infer<typeof McpConfigSchema>;

// Full setup config
export interface SetupConfig {
  deeboPath: string;
  envPath: string;
  motherHost: LlmHost;
  motherModel: string;
  scenarioHost: LlmHost;
  scenarioModel: string;
  motherApiKey: string;
  scenarioApiKey: string;
  clineConfigPath?: string;
  claudeConfigPath?: string;
}
