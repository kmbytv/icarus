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

// Get existing auth config id, or create Composio-managed one
async function getOrCreateAuthConfigId(composio, toolkit) {
  // Try to find existing
  const existing = await composio.authConfigs.list({ toolkit });
  if (existing.items?.length > 0) return existing.items[0].id;

  // Create Composio-managed auth config
  const toolkitInfo = await composio.toolkits.getToolkitBySlug(toolkit);
  const created = await composio.authConfigs.create(toolkit, {
    type: 'use_composio_managed_auth',
    name: `${toolkitInfo?.name ?? toolkit} (KAI)`,
  });
  return created.id;
}

// Initiate OAuth via /link endpoint (not deprecated initiate)
export async function initiateConnection(app, composioKey) {
  const toolkit = TOOLKIT_MAP[app];
  if (!toolkit) throw new Error(`Unknown app: ${app}`);

  const composio = getClient(composioKey);
  const authConfigId = await getOrCreateAuthConfigId(composio, toolkit);

  // link() uses POST /api/v3/connected_accounts/link — the correct new endpoint
  const connection = await composio.connectedAccounts.link('default', authConfigId, {
    allowMultiple: true,
  });

  return { redirectUrl: connection.redirectUrl, connectionId: connection.connectedAccountId };
}

// Check connection status
export async function getConnectionStatus(composioKey, app = null) {
  const composio = getClient(composioKey);
  try {
    const accounts = await composio.connectedAccounts.list({ userIds: ['default'] });
    const items = accounts.items ?? [];

    // Log raw data to understand the shape
    console.log('[composio] accounts raw:', JSON.stringify(items.slice(0, 3), null, 2));

    // Try multiple possible field names for toolkit identifier
    const connectedToolkits = new Set(
      items
        .filter(a => {
          const s = (a.status ?? a.connectionStatus ?? '').toUpperCase();
          return s === 'ACTIVE' || s === 'CONNECTED' || s === '' || s === undefined;
        })
        .flatMap(a => [
          a.toolkit?.toLowerCase(),
          a.toolkitSlug?.toLowerCase(),
          a.appName?.toLowerCase(),
          a.app?.toLowerCase(),
          a.integration?.toolkit?.toLowerCase(),
        ])
        .filter(Boolean)
    );

    console.log('[composio] connected toolkits:', [...connectedToolkits]);

    if (app) {
      const slug = TOOLKIT_MAP[app]?.toLowerCase();
      return { connected: connectedToolkits.has(slug) };
    }

    const result = {};
    for (const [name, slug] of Object.entries(TOOLKIT_MAP)) {
      result[name] = connectedToolkits.has(slug.toLowerCase());
    }
    return result;
  } catch (err) {
    console.error('[composio] getConnectionStatus error:', err.message);
    if (app) return { connected: false };
    return Object.fromEntries(Object.keys(TOOLKIT_MAP).map(k => [k, false]));
  }
}

// Get tools for connected apps in OpenAI format
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

// Execute a Composio tool
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

// Composio tool slugs are UPPERCASE_WITH_UNDERSCORES like NOTION_CREATE_PAGE
export function isComposioTool(name) {
  return typeof name === 'string' && /^[A-Z][A-Z0-9_]+$/.test(name) && name.includes('_');
}
