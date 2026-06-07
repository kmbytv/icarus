const BASE = 'https://backend.composio.dev/api/v2';

const APP_SLUGS = {
  'notion':          'NOTION',
  'todoist':         'TODOIST',
  'google-calendar': 'GOOGLECALENDAR',
  'github':          'GITHUB',
};

function headers(key) {
  return { 'x-api-key': key, 'Content-Type': 'application/json' };
}

// Get OAuth redirect URL for an app
export async function initiateConnection(app, composioKey) {
  const appSlug = APP_SLUGS[app];
  if (!appSlug) throw new Error(`Unknown app: ${app}`);

  const res = await fetch(`${BASE}/connectedAccounts`, {
    method: 'POST',
    headers: headers(composioKey),
    body: JSON.stringify({ appName: appSlug, authMode: 'OAUTH2' }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Composio error');
  return { redirectUrl: data.redirectUrl, connectionId: data.connectionId };
}

// Check connection status for one or all apps
export async function getConnectionStatus(composioKey, app = null) {
  const url = app
    ? `${BASE}/connectedAccounts?appName=${APP_SLUGS[app]}&showActiveOnly=true`
    : `${BASE}/connectedAccounts?showActiveOnly=true`;

  const res = await fetch(url, { headers: headers(composioKey) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Composio error');

  if (app) {
    return { connected: (data.items?.length ?? 0) > 0 };
  }

  // Return map { notion: true, todoist: false, ... }
  const connected = new Set((data.items ?? []).map(i => i.appName));
  const result = {};
  for (const [name, slug] of Object.entries(APP_SLUGS)) {
    result[name] = connected.has(slug);
  }
  return result;
}

// Get all available tools for connected apps as OpenAI function definitions
export async function getComposioTools(composioKey) {
  const status = await getConnectionStatus(composioKey);
  const connectedApps = Object.entries(status)
    .filter(([, v]) => v)
    .map(([name]) => APP_SLUGS[name]);

  if (connectedApps.length === 0) return [];

  const res = await fetch(
    `${BASE}/actions?apps=${connectedApps.join(',')}&limit=50`,
    { headers: headers(composioKey) }
  );
  const data = await res.json();
  if (!res.ok) return [];

  return (data.items ?? []).map(action => ({
    type: 'function',
    function: {
      name: `composio__${action.name}`,
      description: action.description ?? action.name,
      parameters: action.parameters ?? { type: 'object', properties: {} },
    },
  }));
}

// Execute a Composio action
export async function executeComposioAction(actionName, args, composioKey) {
  const res = await fetch(`${BASE}/actions/${actionName}/execute`, {
    method: 'POST',
    headers: headers(composioKey),
    body: JSON.stringify({ input: args }),
  });
  const data = await res.json();
  if (!res.ok) return { error: data.message || 'Execution failed' };
  return data.response ?? data;
}

export function isComposioTool(name) {
  return name.startsWith('composio__');
}
