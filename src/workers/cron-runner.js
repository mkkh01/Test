import 'dotenv/config';
import { closeDiscoveryWorker, runDiscovery } from './discovery-worker.js';
import { closeLeadAnalysisWorker, runLeadAnalysis } from './lead-analysis-worker.js';
import { closePaymentWorker, runPaymentWorker } from './payment-worker.js';

async function main() {
  const summary = {};
  try {
    summary.payment = await runPaymentWorker({ limit: 20 });
    summary.analysis = await runLeadAnalysis({ limit: 10 });
    if (process.env.DISCOVERY_CRON_ENABLED !== 'false') summary.discovery = await runDiscovery({ fetchImpl: fetch });
    console.log(JSON.stringify({ worker: 'cron', summary }));
  } finally {
    await Promise.allSettled([closePaymentWorker(), closeLeadAnalysisWorker(), closeDiscoveryWorker()]);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(JSON.stringify({ worker: 'cron', error: String(error.message).slice(0, 1000) })); process.exitCode = 1; });
}
