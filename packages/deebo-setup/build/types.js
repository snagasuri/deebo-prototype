import { z } from 'zod';
// LLM host validation
export const LlmHostSchema = z.enum(['openrouter', 'anthropic', 'gemini']);
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
