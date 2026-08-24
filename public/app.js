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
const downloadPanel = document.getElementById('downloadPanel');
const downloadMessage = document.getElementById('downloadMessage');
const downloadLink = document.getElementById('downloadLink');
const formStatus = document.getElementById('formStatus');

const productLabels = {
  starter: { slug: 'client-payment-scope-protection-starter', label: 'Starter — 3 USDT' },
  complete: { slug: 'client-payment-scope-protection-complete', label: 'Complete — 7 USDT' },
  agency: { slug: 'client-payment-scope-protection-agency', label: 'Agency — 12 USDT' }
};

let activeOrder = null;

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
  setStatus(paymentStatus, 'After sending the exact amount, paste the TRON TxID below.', '#687386');
  paymentPanel?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function renderDownload(order) {
  if (!order?.downloadUrl) return;
  downloadPanel?.classList.remove('hidden');
  if (downloadMessage) downloadMessage.textContent = 'Payment confirmed. Your digital kit is ready.';
  if (downloadLink) downloadLink.href = order.downloadUrl;
  txidForm?.classList.add('hidden');
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
  setStatus(paymentStatus, 'Checking the transaction on TRON…');
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
    if (!response.ok && result.status !== 'confirming') throw new Error(result.error || result.message || 'The payment could not be verified.');
    setStatus(paymentStatus, result.message || 'Payment found. We are waiting for more confirmations.', '#b26a00');
  } catch (error) {
    setStatus(paymentStatus, error.message, '#b42318');
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
