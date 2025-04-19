import { z } from 'zod';
export const LlmHostSchema = z.enum(['openrouter', 'anthropic', 'gemini']);
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
export const LlmModelSchema = z.string();
