#!/usr/bin/env node
// Assemble one self-contained plugin from the maintained runtime and native Mod.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BUNDLE_ROOT = path.join(ROOT, 'output', 'codex-local-marketplace');
const MARKER = 'codex-single-plugin-bundle';
const json = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
function hashFiles(hash, directory) {
  for (const name of fs.readdirSync(directory).sort()) {
    const file = path.join(directory, name);
    hash.update(path.relative(ROOT, file));
    if (fs.statSync(file).isDirectory()) hashFiles(hash, file);
    else hash.update(fs.readFileSync(file));
  }
}

const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
};

export function buildSinglePlugin(destination = BUNDLE_ROOT) {
  const markerFile = path.join(destination, 'bundle-manifest.json');
  if (fs.existsSync(destination)) {
    if (!fs.existsSync(markerFile) || json(markerFile).generator !== MARKER) {
      throw new Error('Refusing to replace a directory not created by this bundle generator.');
    }
    fs.rmSync(destination, { recursive: true });
  }
  const official = path.join(ROOT, 'plugins', 'codex');
  const native = path.join(ROOT, 'plugins', 'codex-native-prototype');
  const pluginRoot = path.join(destination, 'plugins', 'codex');
  fs.mkdirSync(pluginRoot, { recursive: true });
  for (const name of ['agents', 'commands', 'hooks', 'skills', 'scripts', 'schemas', 'prompts', 'NOTICE', 'LICENSE', 'CHANGELOG.md']) {
    fs.cpSync(path.join(official, name), path.join(pluginRoot, name), { recursive: true });
  }
  fs.rmSync(path.join(pluginRoot, 'agents', 'codex-rescue.md'));
  fs.writeFileSync(path.join(pluginRoot, 'agents', 'worker.md'), fs.readFileSync(path.join(native, 'agents', 'worker.md'), 'utf8').replaceAll('codex-native-prototype:', 'codex:'));
  for (const command of ['rescue', 'review', 'adversarial-review']) {
    fs.writeFileSync(path.join(pluginRoot, 'commands', `${command}.md`), fs.readFileSync(path.join(native, 'commands', `${command}.md`), 'utf8').replaceAll('codex-native-prototype:', 'codex:'));
  }
  const baseManifest = json(path.join(official, '.claude-plugin', 'plugin.json'));
  const nativeManifest = json(path.join(native, '.claude-plugin', 'plugin.json'));
  const hash = createHash('sha256');
  for (const name of ['agents', 'commands', 'hooks', 'skills', 'scripts', 'schemas', 'prompts']) hashFiles(hash, path.join(official, name));
  for (const name of ['agents', 'hooks', 'scripts', 'skills', 'tests', 'commands']) hashFiles(hash, path.join(native, name));
  hash.update(fs.readFileSync(fileURLToPath(import.meta.url)));
  hash.update(fs.readFileSync(path.join(native, '.mcp.json')));
  const version = `${baseManifest.version}-native.${nativeManifest.version}.h${hash.digest('hex').slice(0, 12)}`;
  writeJson(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), {
    ...baseManifest, version,
    description: 'Codex for Claude Code: patched companion runtime, native agents, live activity, and parent supervision.',
    author: { name: 'HuabeiYou' }
  });
  const hooks = json(path.join(official, 'hooks', 'hooks.json'));
  writeJson(path.join(pluginRoot, 'hooks', 'hooks.json'), { ...hooks, modules: ['./native/register.js'] });
  fs.mkdirSync(path.join(pluginRoot, 'hooks', 'native'), { recursive: true });
  const namespace = (source) => source.replaceAll('codex-native-prototype:', 'codex:').replaceAll("'codex-native-prototype'", "'codex'");
  const register = namespace(fs.readFileSync(path.join(native, 'hooks', 'register.js'), 'utf8'))
    .replaceAll('/scripts/bridge.mjs', '/scripts/native-bridge.mjs');
  fs.writeFileSync(path.join(pluginRoot, 'hooks', 'native', 'register.js'), register);
  fs.copyFileSync(path.join(native, 'hooks', 'protocol.mjs'), path.join(pluginRoot, 'hooks', 'native', 'protocol.mjs'));
  fs.copyFileSync(path.join(native, 'hooks', 'panel.mjs'), path.join(pluginRoot, 'hooks', 'native', 'panel.mjs'));
  const bridge = fs.readFileSync(path.join(native, 'scripts', 'bridge.mjs'), 'utf8')
    .replaceAll('"../../codex/scripts/', '"./');
  fs.writeFileSync(path.join(pluginRoot, 'scripts', 'native-bridge.mjs'), bridge);
  fs.copyFileSync(path.join(native, '.mcp.json'), path.join(pluginRoot, '.mcp.json'));
  fs.copyFileSync(path.join(native, 'scripts', 'native-ready-server.mjs'), path.join(pluginRoot, 'scripts', 'native-ready-server.mjs'));
  fs.cpSync(path.join(native, 'skills'), path.join(pluginRoot, 'skills'), { recursive: true });
  fs.copyFileSync(path.join(native, 'tsconfig.json'), path.join(pluginRoot, 'tsconfig.json'));
  // Claude's test runner loads an isolated copy and does not populate the
  // source package's declarations. Retain the local SDK for bundle typechecks.
  const modTypes = path.join(native, '.claude-plugin', 'types');
  if (fs.existsSync(modTypes)) fs.cpSync(modTypes, path.join(pluginRoot, '.claude-plugin', 'types'), { recursive: true });
  fs.mkdirSync(path.join(pluginRoot, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, 'tests', 'native-mod.test.ts'), namespace(fs.readFileSync(path.join(native, 'tests', 'native-mod.test.ts'), 'utf8')));
  fs.writeFileSync(path.join(pluginRoot, 'README.md'), [
    '# Codex for Claude Code', '',
    'One plugin combines the patched companion runtime and the experimental native Mod. Claude supervises agents and reads their feedback automatically.', '',
    'Use `codex:worker` for implementation, investigation, or review with live activity. Keep one conversation per topic: send adjustments and re-reviews to its original worker with SendMessage; start new workers for new topics and independent reviews. `/codex:rescue`, `/codex:review`, and `/codex:adversarial-review` use this lifecycle; reviews remain read-only. Completed conversations are archived when the session ends with its workers idle and can be resumed later. The `/codex-native`, `/codex-native-status`, and `/codex-native-stop` commands remain available. Tasks have no fixed duration cap.', ''
  ].join('\n'));
  writeJson(path.join(destination, '.claude-plugin', 'marketplace.json'), {
    name: 'huabei-codex', owner: { name: 'HuabeiYou' },
    metadata: { description: 'Local field-test build of the Codex integration fork.', version },
    plugins: [{ name: 'codex', version, source: './plugins/codex', description: 'Patched Codex runtime and native Mod in one plugin.' }]
  });
  writeJson(markerFile, { generator: MARKER, version, plugin: 'codex@huabei-codex' });
  return { marketplaceRoot: destination, pluginRoot, version };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(JSON.stringify(buildSinglePlugin(), null, 2));
}
