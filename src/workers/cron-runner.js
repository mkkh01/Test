import 'dotenv/config';
import { closeDiscoveryWorker, runDiscovery } from './discovery-worker.js';
import { closeLeadAnalysisWorker, runLeadAnalysis } from './lead-analysis-worker.js';
import { closePaymentWorker, runPaymentWorker } from './payment-worker.js';
import { closeOutreachWorker, runOutreachWorker } from './outreach-worker.js';

async function runStep(name, fn) {
  try {
    return await fn();
  } catch (error) {
    return { mode: 'error', step: name, error: String(error.message).slice(0, 1000) };
  }
}

export async function runCronOnce() {
  const summary = {};
  // Discover first so lead_analyze jobs created in this cycle can be claimed immediately.
  summary.discovery = process.env.DISCOVERY_CRON_ENABLED === 'false'
    ? { mode: 'disabled', reason: 'DISCOVERY_CRON_ENABLED=false' }
    : await runStep('discovery', () => runDiscovery({ fetchImpl: fetch }));
  summary.analysis = await runStep('analysis', () => runLeadAnalysis({ limit: 10 }));
  summary.payment = await runStep('payment', () => runPaymentWorker({ limit: 20 }));
  summary.outreach = await runStep('outreach', () => runOutreachWorker({ limit: 1 }));
  return summary;
}

async function main() {
  try {
    const summary = await runCronOnce();
    console.log(JSON.stringify({ worker: 'cron', summary }));
    const failed = Object.values(summary).some((result) => result?.mode === 'error');
    if (failed) process.exitCode = 1;
  } finally {
    await Promise.allSettled([closePaymentWorker(), closeLeadAnalysisWorker(), closeDiscoveryWorker(), closeOutreachWorker()]);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(JSON.stringify({ worker: 'cron', error: String(error.message).slice(0, 1000) })); process.exitCode = 1; });
}
