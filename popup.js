// Booking Invoice — Popup Script

let scrapedData = null;

document.getElementById('scrape-btn').addEventListener('click', async () => {
  const btn = document.getElementById('scrape-btn');
  const status = document.getElementById('status');
  const preview = document.getElementById('data-preview');
  const previewBtn = document.getElementById('preview-btn');

  btn.disabled = true;
  btn.textContent = '⏳ Analyse...';
  status.textContent = '';
  status.className = 'status';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab.url.match(/booking\.com/)) {
      status.textContent = '⚠️ Cette page n\'est pas Booking.com';
      status.className = 'status error';
      btn.disabled = false;
      btn.textContent = '🔍 Analyser la page';
      return;
    }

    const response = await chrome.tabs.sendMessage(tab.id, { action: 'scrape' });
    
    if (!response || Object.keys(response).length === 0) {
      status.textContent = '⚠️ Rafraîchissez la page Booking puis réessayez';
      status.className = 'status error';
      btn.disabled = false;
      btn.textContent = '🔍 Analyser la page';
      return;
    }

    scrapedData = response;

    // Show preview
    const lines = [];
    if (response.booking_ref) lines.push(`<b>N° résa :</b> ${response.booking_ref}`);
    if (response.guest_name) lines.push(`<b>Client :</b> ${response.guest_name}`);
    if (response.checkin && response.checkout) lines.push(`<b>Séjour :</b> ${response.checkin} → ${response.checkout}`);
    if (response.nights) lines.push(`<b>Nuits :</b> ${response.nights}`);
    if (response.rate_per_night) lines.push(`<b>Tarif/nuit TTC :</b> ${response.rate_per_night.toFixed(2)} €`);
    if (response.taxe_sejour) lines.push(`<b>Taxe séjour :</b> ${response.taxe_sejour.toFixed(2)} €`);
    if (response.description) lines.push(`<b>Logement :</b> ${response.description}`);
    
    preview.innerHTML = lines.join('<br>');
    preview.style.display = 'block';
    
    status.textContent = `✅ ${Object.keys(response).length} champs trouvés`;
    status.className = 'status success';
    previewBtn.disabled = false;
  } catch (err) {
    status.textContent = '⚠️ Rafraîchissez la page Booking puis réessayez';
    status.className = 'status error';
  }

  btn.disabled = false;
  btn.textContent = '🔍 Analyser la page';
});

document.getElementById('preview-btn').addEventListener('click', () => {
  if (!scrapedData) return;

  const params = new URLSearchParams();
  if (scrapedData.booking_ref) params.set('booking_ref', scrapedData.booking_ref);
  if (scrapedData.guest_name) params.set('guest_name', scrapedData.guest_name);
  if (scrapedData.checkin) params.set('checkin', scrapedData.checkin);
  if (scrapedData.checkout) params.set('checkout', scrapedData.checkout);
  if (scrapedData.nights) params.set('nights', String(scrapedData.nights));
  if (scrapedData.description) params.set('description', scrapedData.description);
  if (scrapedData.rate_per_night) params.set('rate_per_night', String(scrapedData.rate_per_night));
  if (scrapedData.taxe_sejour) params.set('taxe_sejour', String(scrapedData.taxe_sejour));
  if (scrapedData.tva_rate) params.set('tva_rate', String(scrapedData.tva_rate));
  if (scrapedData.issue_date) params.set('issue_date', scrapedData.issue_date);
  if (scrapedData.payment_method) params.set('payment_method', scrapedData.payment_method);

  chrome.tabs.create({ url: `http://192.168.0.161:5042/api/invoice?${params.toString()}` });
});
