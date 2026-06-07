import { Composio } from '@composio/core';

let _composio = null;
let _currentKey = null;

function getClient(apiKey) {
  if (!apiKey) throw new Error('Composio API key not provided');
  if (_currentKey !== apiKey) {
    _composio = new Composio({ apiKey });
    _currentKey = apiKey;
  }
  return _composio;
}

const TOOLKIT_MAP = {
  'notion':          'notion',
  'todoist':         'todoist',
  'google-calendar': 'googlecalendar',
  'github':          'github',
};

// Get authConfigId for a toolkit (uses default Composio-managed config)
async function getAuthConfigId(composio, toolkit) {
  const configs = await composio.authConfigs.list({ toolkit });
  const config = configs.items?.[0];
  if (!config) throw new Error(`No auth config found for ${toolkit}`);
  return config.id;
}

// Initiate OAuth — returns { redirectUrl }
export async function initiateConnection(app, composioKey) {
  const toolkit = TOOLKIT_MAP[app];
  if (!toolkit) throw new Error(`Unknown app: ${app}`);

  const composio = getClient(composioKey);
  const authConfigId = await getAuthConfigId(composio, toolkit);
  const connection = await composio.connectedAccounts.link('default', authConfigId);

  return { redirectUrl: connection.redirectUrl, connectionId: connection.connectedAccountId };
}

// Check status for one app or all
export async function getConnectionStatus(composioKey, app = null) {
  const composio = getClient(composioKey);

  try {
    const accounts = await composio.connectedAccounts.list({ userIds: ['default'] });
    const connectedToolkits = new Set(
      (accounts.items ?? [])
        .filter(a => a.status === 'ACTIVE')
        .map(a => a.toolkit?.toLowerCase())
    );

    if (app) {
      const toolkit = TOOLKIT_MAP[app];
      return { connected: connectedToolkits.has(toolkit?.toLowerCase()) };
    }

    const result = {};
    for (const [name, slug] of Object.entries(TOOLKIT_MAP)) {
      result[name] = connectedToolkits.has(slug.toLowerCase());
    }
    return result;
  } catch {
    if (app) return { connected: false };
    return Object.fromEntries(Object.keys(TOOLKIT_MAP).map(k => [k, false]));
  }
}

// Get tools for connected apps in OpenAI function format
export async function getComposioTools(composioKey) {
  try {
    const composio = getClient(composioKey);
    const status = await getConnectionStatus(composioKey);
    const connectedToolkits = Object.entries(status)
      .filter(([, v]) => v)
      .map(([name]) => TOOLKIT_MAP[name]);

    if (connectedToolkits.length === 0) return [];

    const tools = await composio.tools.get('default', {
      toolkits: connectedToolkits,
      limit: 30,
    });

    return Array.isArray(tools) ? tools : [];
  } catch (err) {
    console.error('[composio] getComposioTools error:', err.message);
    return [];
  }
}

// Execute a Composio tool by its slug (e.g. NOTION_CREATE_PAGE)
export async function executeComposioAction(toolSlug, args, composioKey) {
  try {
    const composio = getClient(composioKey);
    const result = await composio.tools.execute(toolSlug, {
      userId: 'default',
      arguments: args,
      dangerouslySkipVersionCheck: true,
    });
    return result.data ?? result;
  } catch (err) {
    return { error: err.message };
  }
}

// Composio tools have uppercase slugs like NOTION_CREATE_PAGE
export function isComposioTool(name) {
  return typeof name === 'string' && /^[A-Z][A-Z0-9_]+$/.test(name) && name.includes('_');
}
