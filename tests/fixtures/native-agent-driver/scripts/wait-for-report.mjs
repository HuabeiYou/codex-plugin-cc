// Test-only observer: wait outside the Mod turn.step hook's short time budget.
import fs from 'node:fs';

const [reportFile, priorRequestId] = process.argv.slice(2);
const deadline = setTimeout(() => { console.error('Feedback report did not complete within 150 seconds.'); process.exit(1); }, 150_000);
const timer = setInterval(() => {
  try {
    const checkpoint = JSON.parse(fs.readFileSync(reportFile + '.checkpoint.json', 'utf8'));
    if (checkpoint.requestId === priorRequestId || !checkpoint.result) return;
    clearInterval(timer); clearTimeout(deadline);
    if (checkpoint.result.status !== 'completed') throw new Error('Feedback failed: ' + checkpoint.result.status);
    if (!fs.readFileSync(reportFile, 'utf8').startsWith('Codex task completed')) throw new Error('Completed report is missing.');
    console.log(JSON.stringify({ ...checkpoint.ready, resultStatus: checkpoint.result.status }));
  } catch (error) {
    clearInterval(timer); clearTimeout(deadline);
    console.error(error.message); process.exitCode = 1;
  }
}, 100);
