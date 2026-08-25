const checkoutNotice = document.getElementById('checkoutNotice');
const checkoutPanel = document.getElementById('checkoutPanel');
const checkoutForm = document.getElementById('checkoutForm');
const checkoutProduct = document.getElementById('checkoutProduct');
const checkoutTitle = document.getElementById('checkoutTitle');
const checkoutStatus = document.getElementById('checkoutStatus');
const paymentPanel = document.getElementById('paymentPanel');
const paymentOrderText = document.getElementById('paymentOrderText');
const paymentAmount = document.getElementById('paymentAmount');
const paymentNetwork = document.getElementById('paymentNetwork');
const paymentAddress = document.getElementById('paymentAddress');
const paymentExpiry = document.getElementById('paymentExpiry');
const txidForm = document.getElementById('txidForm');
const paymentTxid = document.getElementById('paymentTxid');
const paymentStatus = document.getElementById('paymentStatus');
const evidenceForm = document.getElementById('evidenceForm');
const paymentEvidenceTxid = document.getElementById('paymentEvidenceTxid');
const paymentSenderAddress = document.getElementById('paymentSenderAddress');
const paymentRecipientAddress = document.getElementById('paymentRecipientAddress');
const paymentTransferAmount = document.getElementById('paymentTransferAmount');
const paymentTransferTime = document.getElementById('paymentTransferTime');
const paymentTransferText = document.getElementById('paymentTransferText');
const paymentScreenshot = document.getElementById('paymentScreenshot');
const evidenceStatus = document.getElementById('evidenceStatus');
const downloadPanel = document.getElementById('downloadPanel');
const downloadMessage = document.getElementById('downloadMessage');
const downloadLink = document.getElementById('downloadLink');
const formStatus = document.getElementById('formStatus');

const productLabels = {
  starter: { slug: 'client-payment-scope-protection-starter', label: 'Starter — 5 USDT', priceUsdt: 5 },
  complete: { slug: 'client-payment-scope-protection-complete', label: 'Complete — 7 USDT', priceUsdt: 7 },
  agency: { slug: 'client-payment-scope-protection-agency', label: 'Agency — 10 USDT', priceUsdt: 10 },
};

async function loadLiveProductPrices() {
  try {
    const response = await fetch('/api/products', { cache: 'no-store' });
    if (!response.ok) return;
    const result = await response.json();
    const bySlug = new Map((result.products || []).map((product) => [product.slug, product]));
    for (const [key, product] of Object.entries(productLabels)) {
      const live = bySlug.get(product.slug);
      if (!live) continue;
      product.priceUsdt = Number(live.priceUsdt ?? live.price_usdt);
      product.label = `${live.tier} — ${product.priceUsdt} USDT`;
      document.querySelector(`[data-product-price="${key}"]`)?.replaceChildren(document.createTextNode(String(product.priceUsdt)));
    }
  } catch (_error) {
    // The server remains the source of truth if the price refresh fails.
  }
}

loadLiveProductPrices();

let activeOrder = null;
let statusPollTimer = null;
let downloadRedirected = false;

function setStatus(element, text, color = '#687386') {
  if (!element) return;
  element.textContent = text;
  element.style.color = color;
}

function renderPaymentInstructions(order) {
  activeOrder = order;
  paymentPanel?.classList.remove('hidden');
  if (paymentOrderText) paymentOrderText.textContent = `Order ${order.orderNumber} · Invoice ${order.invoiceNumber}`;
  if (paymentAmount) paymentAmount.textContent = `${order.amountUsdt} USDT`;
  if (paymentNetwork) paymentNetwork.textContent = order.network;
  if (paymentAddress) paymentAddress.value = order.receivingAddress;
  if (paymentExpiry) paymentExpiry.textContent = `Invoice expires: ${new Date(order.expiresAt).toLocaleString()}`;
  evidenceForm?.classList.add('hidden');
  evidenceForm?.reset();
  setStatus(evidenceStatus, '');
  setStatus(paymentStatus, 'After sending the exact USDT amount, paste the Solana transaction signature below.', '#687386');
  paymentPanel?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  startOrderStatusPolling();
}

function startOrderStatusPolling() {
  if (statusPollTimer) clearTimeout(statusPollTimer);
  if (!activeOrder?.statusUrl) return;
  let checks = 0;
  const check = async () => {
    try {
      const response = await fetch(activeOrder.statusUrl);
      const result = await response.json();
      if (result.order) {
        activeOrder = { ...activeOrder, ...result.order };
        if (result.order.status === 'paid' && result.order.downloadUrl) { renderDownload(result.order); return; }
        if (result.order.status === 'manual_review') setStatus(paymentStatus, 'Your payment evidence is under manual review. We will release the kit after the blockchain details are confirmed.', '#b26a00');
      }
    } catch (_error) {
      // A later check will retry; the customer can still use the visible form.
    }
    checks += 1;
    if (checks < 120) statusPollTimer = setTimeout(check, 15000);
  };
  check();
}

async function fileToDataUrl(file) {
  if (!file) return '';
  if (file.size <= 120 * 1024) return await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || '')); reader.onerror = reject; reader.readAsDataURL(file); });
  const bitmap = await createImageBitmap(file);
  const maxWidth = 1400;
  const scale = Math.min(1, maxWidth / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.7);
}

function showEvidencePanel(result = {}) {
  if (!evidenceForm) return;
  if (activeOrder?.orderNumber) activeOrder = { ...activeOrder, ...result, submitEvidenceUrl: result.submitEvidenceUrl || `/api/orders/${encodeURIComponent(activeOrder.orderNumber)}/payment-evidence` };
  if (paymentEvidenceTxid && !paymentEvidenceTxid.value) paymentEvidenceTxid.value = paymentTxid?.value.trim() || '';
  if (paymentRecipientAddress && !paymentRecipientAddress.value) paymentRecipientAddress.value = activeOrder?.receivingAddress || '';
  if (paymentTransferAmount && !paymentTransferAmount.value) paymentTransferAmount.value = activeOrder?.amountUsdt || '';
  evidenceForm.classList.remove('hidden');
  setStatus(evidenceStatus, 'You can now submit the transfer details or a screenshot for manual review.', '#b26a00');
  evidenceForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function renderDownload(order) {
  if (!order?.downloadUrl) return;
  downloadPanel?.classList.remove('hidden');
  if (downloadMessage) downloadMessage.textContent = 'Payment confirmed. Your download is starting now.';
  if (downloadLink) downloadLink.href = order.downloadUrl;
  txidForm?.classList.add('hidden');
  evidenceForm?.classList.add('hidden');
  if (!downloadRedirected) {
    downloadRedirected = true;
    window.setTimeout(() => {
      window.location.assign(new URL(order.downloadUrl, window.location.origin).href);
    }, 350);
  }
}

for (const button of document.querySelectorAll('.choose-product')) {
  button.addEventListener('click', () => {
    const product = productLabels[button.dataset.product];
    checkoutProduct.value = product.slug;
    checkoutTitle.textContent = `Create your ${product.label} order`;
    checkoutNotice.textContent = `${product.label} selected.`;
    checkoutPanel.classList.remove('hidden');
    paymentPanel?.classList.add('hidden');
    downloadPanel?.classList.add('hidden');
    downloadRedirected = false;
    checkoutPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

checkoutForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  setStatus(checkoutStatus, 'Creating order…');
  const payload = Object.fromEntries(new FormData(checkoutForm).entries());
  try {
    const response = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to create the order.');
    setStatus(checkoutStatus, `Order ${result.order.orderNumber} created. Follow the USDT instructions below.`, '#0d8b65');
    renderPaymentInstructions(result.order);
    checkoutForm.querySelector('button[type="submit"]')?.setAttribute('disabled', 'disabled');
  } catch (error) {
    setStatus(checkoutStatus, error.message, '#b42318');
  }
});

txidForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!activeOrder?.statusToken || !activeOrder.submitTxidUrl) {
    setStatus(paymentStatus, 'Create an order first.', '#b42318');
    return;
  }
  const txid = paymentTxid.value.trim();
  setStatus(paymentStatus, 'Checking the transaction on Solana…');
  try {
    const response = await fetch(activeOrder.submitTxidUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ statusToken: activeOrder.statusToken, txid })
    });
    const result = await response.json();
    if (result.status === 'confirmed' && result.order?.downloadUrl) {
      activeOrder = { ...activeOrder, ...result.order };
      setStatus(paymentStatus, 'Payment confirmed.', '#0d8b65');
      renderDownload(result.order);
      return;
    }
    if (result.paymentEvidenceRequested) showEvidencePanel(result);
    if (!response.ok && result.status !== 'confirming') throw new Error(result.error || result.message || 'The payment could not be verified.');
    setStatus(paymentStatus, result.message || 'Payment found. We are waiting for more confirmations.', '#b26a00');
  } catch (error) {
    setStatus(paymentStatus, error.message, '#b42318');
  }
});

evidenceForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!activeOrder?.statusToken || !activeOrder.submitEvidenceUrl) {
    setStatus(evidenceStatus, 'Submit one unsuccessful TxID check first.', '#b42318');
    return;
  }
  setStatus(evidenceStatus, 'Submitting your evidence securely…');
  try {
    const screenshot = await fileToDataUrl(paymentScreenshot?.files?.[0]);
    const response = await fetch(activeOrder.submitEvidenceUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        statusToken: activeOrder.statusToken,
        txid: paymentEvidenceTxid?.value.trim() || '',
        senderAddress: paymentSenderAddress?.value.trim() || '',
        recipientAddress: paymentRecipientAddress?.value.trim() || '',
        amountUsdt: paymentTransferAmount?.value || '',
        transferTime: paymentTransferTime?.value || '',
        transferText: paymentTransferText?.value.trim() || '',
        screenshotDataUrl: screenshot
      })
    });
    const result = await response.json();
    if (result.status === 'confirmed' && result.order?.downloadUrl) {
      activeOrder = { ...activeOrder, ...result.order };
      setStatus(evidenceStatus, 'Payment confirmed. Your download is starting.', '#0d8b65');
      renderDownload(result.order);
      return;
    }
    if (!response.ok) throw new Error(result.error || 'Unable to submit the evidence.');
    setStatus(evidenceStatus, result.message || 'Evidence received. We will review it before releasing the kit.', '#0d8b65');
    evidenceForm.querySelector('button[type="submit"]')?.setAttribute('disabled', 'disabled');
    startOrderStatusPolling();
  } catch (error) {
    setStatus(evidenceStatus, error.message, '#b42318');
  }
});

const intakeForm = document.getElementById('intakeForm');
intakeForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  setStatus(formStatus, 'Sending…');
  const payload = Object.fromEntries(new FormData(intakeForm).entries());
  payload.consent = intakeForm.elements.consent.checked;
  try {
    const response = await fetch('/api/intake', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to submit the form.');
    setStatus(formStatus, 'Thank you — your brief has been received. We will reply with the next step.', '#0d8b65');
    intakeForm.reset();
  } catch (error) {
    setStatus(formStatus, error.message, '#b42318');
  }
});
