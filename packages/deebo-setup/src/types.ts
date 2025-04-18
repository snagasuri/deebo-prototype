import { z } from 'zod';

export const LlmHostSchema = z.enum(['openrouter', 'anthropic', 'gemini']);
export type LlmHost = z.infer<typeof LlmHostSchema>;

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

export const LlmModelSchema = z.string();
export type LlmModel = z.infer<typeof LlmModelSchema>;

export interface SetupConfig {
  deeboPath: string;
  envPath: string;
  motherHost: LlmHost;
  motherModel: LlmModel;
  scenarioHost: LlmHost;
  scenarioModel: LlmModel;
  motherApiKey: string;
  scenarioApiKey: string;
  clineConfigPath?: string;
  claudeConfigPath?: string;
}
