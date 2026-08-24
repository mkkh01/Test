import 'dotenv/config';
import { runDiscovery } from './discovery-worker.js';
import { runLeadAnalysis } from './lead-analysis-worker.js';
import { runPaymentWorker } from './payment-worker.js';

const loopIntervalMs = Math.max(30_000, Number(process.env.WORKER_LOOP_INTERVAL_MS || 60_000));
const discoveryIntervalMs = Math.max(15 * 60_000, Number(process.env.DISCOVERY_INTERVAL_MS || 30 * 60_000));
const analysisIntervalMs = Math.max(30_000, Number(process.env.LEAD_ANALYSIS_INTERVAL_MS || 60_000));
const paymentIntervalMs = Math.max(30_000, Number(process.env.PAYMENT_CHECK_INTERVAL_MS || 60_000));
let lastDiscovery = 0;
let lastAnalysis = 0;
let lastPayment = 0;
let running = false;

async function runCycle() {
  if (running) return;
  running = true;
  const now = Date.now();
  try {
    if (now - lastPayment >= paymentIntervalMs) {
      lastPayment = now;
      const result = await runPaymentWorker({ limit: 10 });
      if (result.processed) console.log(JSON.stringify({ worker: 'payment', ...result }));
    }
    if (now - lastAnalysis >= analysisIntervalMs) {
      lastAnalysis = now;
      const result = await runLeadAnalysis({ limit: 5 });
      if (result.processed) console.log(JSON.stringify({ worker: 'lead-analysis', ...result }));
    }
    if (now - lastDiscovery >= discoveryIntervalMs) {
      lastDiscovery = now;
      const result = await runDiscovery({ fetchImpl: fetch });
      console.log(JSON.stringify({ worker: 'discovery', ...result }));
    }
  } catch (error) {
    console.error(JSON.stringify({ worker: 'runner', error: String(error.message).slice(0, 1000) }));
  } finally {
    running = false;
  }
}

async function start() {
  console.log(JSON.stringify({ worker: 'runner', status: 'started', loopIntervalMs, discoveryIntervalMs, analysisIntervalMs, paymentIntervalMs }));
  while (true) {
    await runCycle();
    await new Promise((resolve) => setTimeout(resolve, loopIntervalMs));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start().catch((error) => { console.error(error); process.exitCode = 1; });
}
