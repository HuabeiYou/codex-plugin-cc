// No tools or model calls. Claude waits for MCP initialization before adopting
// background agents; hold that boundary until this host's Mod is installed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const pluginRoot = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));

function hostIdentity(pid) {
  if (process.platform === 'linux') {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
  }
  if (process.platform === 'win32') return execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${pid}).StartTime.ToUniversalTime().Ticks`
  ], { encoding: 'utf8', timeout: 2000, windowsHide: true }).trim();
  return execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], {
    encoding: 'utf8', timeout: 2000, env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' }
  }).trim();
}

export function readinessPath(root, pid) {
  const key = createHash('sha256').update(fs.realpathSync(root)).digest('hex');
  return path.join(os.tmpdir(), `codex-mod-ready-${process.getuid?.() ?? 'user'}`, `${key}-${pid}.json`);
}

export function markReady(root, pid, identity) {
  const file = readinessPath(root, pid);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  const record = { identity, markedAt: Date.now(), hostPid: pid };
  fs.writeFileSync(temporary, JSON.stringify(record), { mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, file);
  return record;
}

export async function waitReady(root, pid, identity, timeoutMs = 10000) {
  const file = readinessPath(root, pid);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const record = JSON.parse(fs.readFileSync(file, 'utf8')); if (record.identity === identity) return record; }
    catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Codex Mod did not initialize in this Claude host.');
}

async function serve() {
  const pid = process.ppid;
  if (process.argv[2] === '--clear') { fs.rmSync(readinessPath(pluginRoot, pid), { force: true }); return; }
  const identity = hostIdentity(pid);
  if (!identity) throw new Error('Could not identify the Claude host.');
  if (process.argv[2] === '--mark') { console.log(JSON.stringify(markReady(pluginRoot, pid, identity))); return; }
  const trace = process.argv[2] === '--trace' ? process.argv[3] : null;
  const record = (type, extra = {}) => {
    if (trace) fs.appendFileSync(trace, JSON.stringify({ type, at: Date.now(), hostPid: pid, ...extra }) + '\n');
  };
  const lines = readline.createInterface({ input: process.stdin });
  for await (const line of lines) {
    let request;
    try { request = JSON.parse(line); } catch { continue; }
    if (!request || typeof request !== 'object') continue;
    if (!('id' in request)) continue;
    try {
      let result = {};
      if (request.method === 'initialize') {
        record('readiness.initialize');
        const ready = await waitReady(pluginRoot, pid, identity);
        record('readiness.release', { markedAt: ready.markedAt });
        result = { protocolVersion: request.params.protocolVersion, capabilities: {},
          serverInfo: { name: 'codex-native-ready', version: '1.0.0' } };
      } else if (request.method === 'tools/list') result = { tools: [] };
      else if (request.method !== 'ping') {
        console.log(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } }));
        continue;
      }
      console.log(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
    } catch (error) {
      console.log(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32603, message: error.message } }));
    }
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  serve().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
