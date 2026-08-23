const checkoutNotice = document.getElementById('checkoutNotice');
const formStatus = document.getElementById('formStatus');

for (const button of document.querySelectorAll('.choose-product')) {
  button.addEventListener('click', () => {
    const product = button.dataset.product;
    const labels = { starter: 'Starter — 3 USDT', complete: 'Complete — 7 USDT', agency: 'Agency — 12 USDT' };
    checkoutNotice.textContent = `${labels[product]} selected. Payment checkout will be connected in the next integration phase.`;
    document.getElementById('intake').scrollIntoView({ behavior: 'smooth' });
  });
}

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
