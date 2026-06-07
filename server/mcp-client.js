import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.resolve(__dirname, '..', 'mcp.config.json');

// Map of serverName → { client, tools[] }
const connections = new Map();

// Resolve ${ENV_VAR} placeholders in env values
function resolveEnv(obj) {
  const result = {};
  for (const [k, v] of Object.entries(obj ?? {})) {
    result[k] = v.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? '');
  }
  return result;
}

export async function initMCP() {
  let config;
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf8');
    config = JSON.parse(raw);
  } catch {
    console.log('[mcp] no mcp.config.json found, skipping');
    return;
  }

  for (const [name, def] of Object.entries(config.servers ?? {})) {
    if (def.disabled) continue;
    // Skip if required env var is missing
    const resolvedEnv = resolveEnv(def.env);
    const hasToken = Object.values(resolvedEnv).some(v => v.trim() !== '');
    if (!hasToken) { console.log(`[mcp] skipping ${name}: no token`); continue; }

    try {
      const transport = new StdioClientTransport({
        command: def.command,
        args: def.args ?? [],
        env: { ...process.env, ...resolveEnv(def.env) },
      });

      const client = new Client({ name: `kai-${name}`, version: '1.0.0' });
      await client.connect(transport);

      const { tools } = await client.listTools();
      connections.set(name, { client, tools });
      console.log(`[mcp] connected: ${name} (${tools.length} tools)`);
    } catch (err) {
      console.error(`[mcp] failed to connect ${name}:`, err.message);
    }
  }
}

// Returns all tools in OpenAI function-calling format
export function getMCPTools() {
  const result = [];
  for (const [serverName, { tools }] of connections) {
    for (const tool of tools) {
      result.push({
        type: 'function',
        function: {
          name: `mcp__${serverName}__${tool.name}`,
          description: `[${serverName}] ${tool.description ?? ''}`,
          parameters: tool.inputSchema ?? { type: 'object', properties: {} },
        },
      });
    }
  }
  return result;
}

// Dispatch a tool call to the right MCP server
export async function callMCPTool(fullName, args) {
  // fullName: mcp__notion__create_page
  const match = fullName.match(/^mcp__(\w+)__(.+)$/);
  if (!match) return { error: `Invalid MCP tool name: ${fullName}` };

  const [, serverName, toolName] = match;
  const conn = connections.get(serverName);
  if (!conn) return { error: `MCP server "${serverName}" not connected` };

  try {
    const result = await conn.client.callTool({ name: toolName, arguments: args });
    // MCP returns { content: [{type, text}] }
    const text = result.content?.map(c => c.text ?? '').join('\n') ?? JSON.stringify(result);
    return { result: text };
  } catch (err) {
    return { error: err.message };
  }
}

export function isMCPTool(name) {
  return name.startsWith('mcp__');
}
