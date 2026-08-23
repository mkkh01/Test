const checkoutNotice = document.getElementById('checkoutNotice');
const checkoutPanel = document.getElementById('checkoutPanel');
const checkoutForm = document.getElementById('checkoutForm');
const checkoutProduct = document.getElementById('checkoutProduct');
const checkoutTitle = document.getElementById('checkoutTitle');
const checkoutStatus = document.getElementById('checkoutStatus');
const formStatus = document.getElementById('formStatus');

const productLabels = {
  starter: { slug: 'client-payment-scope-protection-starter', label: 'Starter — 3 USDT' },
  complete: { slug: 'client-payment-scope-protection-complete', label: 'Complete — 7 USDT' },
  agency: { slug: 'client-payment-scope-protection-agency', label: 'Agency — 12 USDT' }
};

for (const button of document.querySelectorAll('.choose-product')) {
  button.addEventListener('click', () => {
    const product = productLabels[button.dataset.product];
    checkoutProduct.value = product.slug;
    checkoutTitle.textContent = `Create your ${product.label} order`;
    checkoutNotice.textContent = `${product.label} selected.`;
    checkoutPanel.classList.remove('hidden');
    checkoutPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

checkoutForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  checkoutStatus.textContent = 'Creating order…';
  checkoutStatus.style.color = '#687386';
  const payload = Object.fromEntries(new FormData(checkoutForm).entries());
  try {
    const response = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to create the order.');
    checkoutStatus.textContent = result.order?.receivingAddress
      ? `Order ${result.order.orderNumber} created. Follow the USDT payment instructions shown next.`
      : 'Order created in demo mode. Payment instructions will be enabled after the wallet is configured.';
    checkoutStatus.style.color = '#0d8b65';
  } catch (error) {
    checkoutStatus.textContent = error.message;
    checkoutStatus.style.color = '#b42318';
  }
});

const intakeForm = document.getElementById('intakeForm');
intakeForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  formStatus.textContent = 'Sending…';
  formStatus.style.color = '#687386';
  const payload = Object.fromEntries(new FormData(intakeForm).entries());
  payload.consent = intakeForm.elements.consent.checked;
  try {
    const response = await fetch('/api/intake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to submit the form.');
    formStatus.textContent = 'Thank you — your brief has been received. We will reply with the next step.';
    formStatus.style.color = '#0d8b65';
    intakeForm.reset();
  } catch (error) {
    formStatus.textContent = error.message;
    formStatus.style.color = '#b42318';
  }
});
