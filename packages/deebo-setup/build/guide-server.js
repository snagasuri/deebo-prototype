import { readFileSync } from 'fs';
// Simple MCP server that provides access to the Deebo guide
export class DeeboGuideServer {
    guidePath;
    constructor(guidePath) {
        this.guidePath = guidePath;
    }
    // The only tool this server provides - reading the guide content
    async readDeeboGuide() {
        try {
            return readFileSync(this.guidePath, 'utf8');
        }
        catch (error) {
            throw new Error(`Failed to read Deebo guide: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    // MCP server interface implementation
    getToolDefinitions() {
        return {
            read_deebo_guide: {
                name: 'read_deebo_guide',
                description: 'Returns the contents of the Deebo guide for AI assistants to help users with installation for Deebo the agentic debugging system and usage.',
                input: {}, // No parameters needed
                output: {
                    type: 'object',
                    properties: {
                        guide: {
                            type: 'string',
                            description: 'The complete Deebo guide content'
                        }
                    },
                    required: ['guide']
                }
            }
        };
    }
    // Handle tool execution
    async executeTool(toolName) {
        if (toolName !== 'read_deebo_guide') {
            throw new Error(`Unknown tool: ${toolName}`);
        }
        const guide = await this.readDeeboGuide();
        return { guide };
    }
}
// Create and export the server factory function
export function createGuideServer(guidePath) {
    return new DeeboGuideServer(guidePath);
}
