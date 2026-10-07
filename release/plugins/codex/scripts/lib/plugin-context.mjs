// Classic hooks receive plugin data paths; Mods inherit only host environment.
// Pass the path through a session/root-scoped file instead of changing globals.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

function contextFile(pluginRoot, sessionId) {
  const key = createHash('sha256').update(fs.realpathSync(pluginRoot)).update('\0').update(sessionId).digest('hex');
  return path.join(os.tmpdir(), 'codex-plugin-context', key + '.json');
}

export function publishPluginContext(pluginRoot, sessionId, pluginData) {
  if (!sessionId || !pluginData) return;
  const file = contextFile(pluginRoot, sessionId);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify({ sessionId, pluginData }), { mode: 0o600 });
}

export function pluginEnvironment(pluginRoot, env) {
  if (env.CLAUDE_PLUGIN_DATA || !env.CODEX_COMPANION_SESSION_ID) return env;
  try {
    const saved = JSON.parse(fs.readFileSync(contextFile(pluginRoot, env.CODEX_COMPANION_SESSION_ID), 'utf8'));
    if (saved.sessionId === env.CODEX_COMPANION_SESSION_ID && path.isAbsolute(saved.pluginData)) {
      return { ...env, CLAUDE_PLUGIN_DATA: saved.pluginData };
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return env;
}
