// Booking Invoice — Content Script v2
// Scrapes Booking.com extranet reservation detail pages.
// DOM structure: res-content__label / res-content__info pairs.

(function () {
  'use strict';

  if (document.getElementById('booking-invoice-btn')) return;

  // ── Helpers ─────────────────────────────────────────────────────

  function cleanLabel(text) {
    return text.replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function euroToFloat(text) {
    // "€ 100,32" or "100,32 €" → 100.32
    const m = text.match(/([\d\s,.]+)/);
    if (!m) return NaN;
    return parseFloat(m[1].replace(/\s/g, '').replace(',', '.'));
  }

  function parseBookingDate(text) {
    // "mar. 16 juin 2026" or "mer. 9 juillet 2025"
    const months = {
      'janvier':'01','février':'02','mars':'03','avril':'04',
      'mai':'05','juin':'06','juillet':'07','août':'08',
      'septembre':'09','octobre':'10','novembre':'11','décembre':'12'
    };
    const m = text.match(/(\d{1,2})\s+(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\s+(\d{4})/i);
    if (m) {
      return `${m[3]}-${months[m[2].toLowerCase()]}-${m[1].padStart(2, '0')}`;
    }
    return '';
  }

  // Scan all label/info pairs on the page
  function getLabelValuePairs() {
    const pairs = {};
    const labels = document.querySelectorAll('.res-content__label');
    for (const label of labels) {
      const key = cleanLabel(label.textContent);
      // Find the next info element (sibling or child of sibling)
      let info = label.nextElementSibling;
      // Sometimes the info is inside a parent grid cell
      if (!info || !info.classList.contains('res-content__info')) {
        const parent = label.closest('.bui-grid__column-full, .bui-grid__column-4\\@medium, .bui-grid__column-6\\@medium');
        if (parent) {
          info = parent.querySelector('.res-content__info');
        }
      }
      if (info) {
        const value = info.textContent.replace(/\s+/g, ' ').trim();
        pairs[key] = value;
      }
    }
    return pairs;
  }

  // ── Extraction ──────────────────────────────────────────────────

  function extractData() {
    const data = {};
    const pairs = getLabelValuePairs();

    // --- Booking ref ---
    data.booking_ref = pairs['numéro de réservation :'] || pairs['numéro de réservation'] || '';

    // --- Guest name ---
    // In header: "mar. 16 juin 2026 - 2 nuits - Delphine Marcellin"
    const h1 = document.querySelector('h1');
    if (h1) {
      const parts = h1.textContent.split(' - ');
      for (const part of parts) {
        const name = part.trim();
        // A name has 2-3 words, starts with uppercase, no digits
        if (/^[A-Z][a-zéèêëàâîïôûùç]+\s+[A-Z][a-zéèêëàâîïôûùç]+/.test(name) && !/\d/.test(name)) {
          data.guest_name = name;
          break;
        }
      }
    }

    // Fallback: find anywhere "Client(s)" section
    if (!data.guest_name) {
      const els = document.querySelectorAll('[class*="guest"], [class*="client"]');
      for (const el of els) {
        const text = el.textContent.trim();
        const m = text.match(/(?:Client|Voyageur|Guest)[:\s]+([A-Z][a-zéèêëàâîïôûùç]+ [A-Z][a-zéèêëàâîïôûùç]+)/i);
        if (m) { data.guest_name = m[1]; break; }
      }
    }

    // --- Guest email ---
    const emailDiv = document.querySelector('[email*="@guest.booking.com"]');
    if (emailDiv) {
      data.guest_email = emailDiv.getAttribute('email');
    }

    // --- Dates ---
    data.checkin = parseBookingDate(pairs['date d\'arrivée'] || pairs['date d\'arrivée :'] || '');
    data.checkout = parseBookingDate(pairs['date de départ'] || pairs['date de départ :'] || '');

    // --- Nights ---
    const dureeStr = pairs['durée de séjour :'] || pairs['durée de séjour'] || '';
    const nightsM = dureeStr.match(/(\d+)/);
    if (nightsM) {
      data.nights = parseInt(nightsM[1]);
    }
    if (!data.nights && data.checkin && data.checkout) {
      const ci = new Date(data.checkin);
      const co = new Date(data.checkout);
      if (!isNaN(ci) && !isNaN(co)) {
        data.nights = Math.round((co - ci) / (1000 * 60 * 60 * 24));
      }
    }

    // --- Total amount ---
    const totalStr = pairs['montant total'] || pairs['montant total :'] || '';
    const total = euroToFloat(totalStr);
    if (!isNaN(total)) {
      data.total_ttc = total;
    }

    // --- Price per night ---
    // Booking extranet doesn't always show per-night breakdown.
    // Derive from total: total / nights (approximate TTC)
    if (data.total_ttc && data.nights) {
      // The total includes tourist tax, so this is approximate
      data.rate_per_night = data.total_ttc / data.nights;
    }

    // --- Tourist tax ---
    // Search the full page for tax de séjour mention
    const taxMatch = document.body.innerText.match(/(?:taxe\s*(?:de\s*)?s[ée]jour|tourist\s*tax)[:\s]*([\d\s,.]+)\s*[€$]/i);
    if (taxMatch) {
      data.taxe_sejour = parseFloat(taxMatch[1].replace(/\s/g, '').replace(',', '.'));
    }

    // --- Property name ---
    // In h1: "Au Chevaleins" — the first span before dates
    if (h1) {
      const spans = h1.querySelectorAll('span');
      for (const span of spans) {
        const t = span.textContent.trim();
        // Property name: no digits, 3+ chars, not a date, not a name
        if (t.length > 3 && !/\d/.test(t) && !/^\d/.test(t) &&
            !/mar\.|lun\.|mer\.|jeu\.|ven\.|sam\.|dim\./i.test(t) &&
            !/janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre/i.test(t)) {
          data.description = t;
          break;
        }
      }
    }

    // Fallback: page title
    if (!data.description) {
      const title = document.title.replace('· Détails de la réservation', '').trim();
      if (title && title.length > 3) {
        data.description = title;
      }
    }

    // --- TVA ---
    data.tva_rate = 10; // default French seasonal rental

    // --- Payment ---
    data.payment_method = 'Réservation Booking.com';

    // --- Issue date ---
    data.issue_date = new Date().toISOString().split('T')[0];

    return data;
  }

  // ── UI: Floating button ──────────────────────────────────────────

  function createButton() {
    const btn = document.createElement('button');
    btn.id = 'booking-invoice-btn';
    btn.textContent = '🧾 Facture';
    btn.style.cssText = `
      position: fixed; bottom: 20px; right: 20px; z-index: 999999;
      background: #1a2d4a; color: #fff; border: none; border-radius: 12px;
      padding: 12px 20px; font-size: 15px; font-weight: 700;
      font-family: -apple-system, sans-serif; cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      transition: transform 0.15s, box-shadow 0.15s;
    `;
    btn.addEventListener('mouseenter', () => {
      btn.style.transform = 'scale(1.05)';
      btn.style.boxShadow = '0 6px 18px rgba(0,0,0,0.25)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.transform = 'scale(1)';
      btn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)';
    });
    btn.addEventListener('click', () => {
      const data = extractData();
      showPreview(data);
    });
    document.body.appendChild(btn);
  }

  // ── Send to server ──────────────────────────────────────────────

  function showPreview(data) {
    const params = new URLSearchParams();
    if (data.booking_ref) params.set('booking_ref', data.booking_ref);
    if (data.guest_name) params.set('guest_name', data.guest_name);
    if (data.guest_email) params.set('guest_email', data.guest_email);
    if (data.checkin) params.set('checkin', data.checkin);
    if (data.checkout) params.set('checkout', data.checkout);
    if (data.nights) params.set('nights', String(data.nights));
    if (data.description) params.set('description', data.description);
    if (data.rate_per_night) params.set('rate_per_night', data.rate_per_night.toFixed(2));
    if (data.taxe_sejour) params.set('taxe_sejour', data.taxe_sejour.toFixed(2));
    if (data.tva_rate) params.set('tva_rate', String(data.tva_rate));
    if (data.issue_date) params.set('issue_date', data.issue_date);
    if (data.payment_method) params.set('payment_method', data.payment_method);

    const url = `http://localhost:5042/api/invoice?${params.toString()}`;
    window.open(url, '_blank');
  }

  // ── Popup message handler ────────────────────────────────────────

  chrome.runtime?.onMessage?.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'scrape') {
      sendResponse(extractData());
    }
    return true;
  });

  // ── Init ────────────────────────────────────────────────────────
  createButton();

})();
