import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { DEEBO_ROOT } from '../index.js';
import { getProjectId } from './sanitize.js';

// Write logs to memory bank structure
import { appendFileSync } from 'fs';
import { join } from 'path';
import { DEEBO_ROOT } from '../index.js';

const DEBUG_LOG_PATH = process.env.DEBUG_LOG_PATH || join(DEEBO_ROOT, 'debug.log');

export function safeLog(...args: any[]) {
  const msg = `[${new Date().toISOString()}] ${args.map(String).join(' ')}\n`;
  try {
    appendFileSync(DEBUG_LOG_PATH, msg);
  } catch (err) {
    // Silently fail to avoid corrupting stdout/stderr
  }
}

export async function log(sessionId: string, name: string, level: string, message: string, data?: any) {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    agent: name,
    level,
    message,
    data
  }) + '\n';

  // Data will be written to memory-bank/projectId/sessions/sessionId/logs/agentName.log
  const projectId = getProjectId(data?.repoPath);
  if (projectId) {
    const logPath = join(DEEBO_ROOT, 'memory-bank', projectId, 'sessions', sessionId, 'logs', `${name}.log`);
    await writeFile(logPath, entry, { flag: 'a' });
  }
}

// Simple console logging
export function consoleLog(level: string, message: string, data?: any) {
  console.log(`[${level}] ${message}`, data || '');
}
