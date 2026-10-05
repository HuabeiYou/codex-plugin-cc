const fs = require('node:fs');
const file = require('./test-config.json').trace;
if (!file) throw new Error('Navigation trace path is required.');
if (process.argv[2] === 'config') { console.log(JSON.stringify(require('./test-config.json'))); }
else if (process.argv[2] === 'claim') {
  const rows = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  const completed = rows.findLast((r) => r.type === 'turn.complete' && r.agentId && !r.isAborted);
  const launch = rows.find((r) => r.type === 'launch');
  if (!fs.existsSync(file + '.claimed')) { fs.writeFileSync(file + '.claimed', '1'); console.log('{"launch":true}'); }
  else console.log(JSON.stringify({ completed: !!completed, outputFile: launch?.outputFile }));
} else {
  const event = JSON.parse(process.argv[2]);
  if (event.type === 'restore.ownership') {
    const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
    const ready = rows.filter((r) => r.type === 'bridge.chunk').flatMap((r) => {
      try { const e = JSON.parse(r.text); return e.kind === 'ready' ? [e] : []; } catch { return []; }
    });
    if (ready.length > 1) {
      try { process.kill(ready[0].appServerPid, 0); event.priorAppServerAlive = true; }
      catch (error) { if (error.code !== 'ESRCH') throw error; event.priorAppServerAlive = false; }
    }
  }
  fs.appendFileSync(file, JSON.stringify({ at: Date.now(), hostPid: process.ppid, ...event }) + '\n');
}
