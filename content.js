// Booking Invoice — Content Script v3
// Scrapes Booking.com extranet reservation detail page.
// Uses res-room-block accordion + price table for full detail.

(function () {
  'use strict';

  if (document.getElementById('booking-invoice-btn')) return;

  // ── Helpers ─────────────────────────────────────────────────────

  function euroToFloat(text) {
    const m = text.match(/([\d\s,.]+)/);
    if (!m) return NaN;
    return parseFloat(m[1].replace(/\s/g, '').replace(',', '.'));
  }

  function parseBookingDate(text) {
    // "mar. 16 juin 2026" or "mar.\u00A016\u00A0juin\u00A02026" (with &nbsp;)
    const months = {
      'janvier':'01','février':'02','mars':'03','avril':'04',
      'mai':'05','juin':'06','juillet':'07','août':'08',
      'septembre':'09','octobre':'10','novembre':'11','décembre':'12'
    };
    // Normalize: remove dots after weekday, collapse whitespace/nbsp
    const clean = text.replace(/\w+\.\s*/, '').replace(/\s+/g, ' ');
    const m = clean.match(/(\d{1,2})\s+(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\s+(\d{4})/i);
    if (m) {
      return `${m[3]}-${months[m[2].toLowerCase()]}-${m[1].padStart(2, '0')}`;
    }
    return '';
  }

  function textOf(sel, parent) {
    const el = (parent || document).querySelector(sel);
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  // ── Scraping ─────────────────────────────────────────────────────

  function extractData() {
    const data = {};

    // --- Expand accordion if needed ---
    const roomBlock = document.querySelector('.res-room-block');
    if (!roomBlock) {
      return fallbackExtract(data);
    }

    const accordionRow = roomBlock.closest('.bui-accordion__row');
    if (accordionRow && !accordionRow.classList.contains('bui-is-active')) {
      // Click to expand
      const btn = accordionRow.querySelector('button');
      if (btn) btn.click();
      // Content may take a moment to render; the popup flow handles this
    }

    // --- Property / room name ---
    data.description = textOf('.res-room-title__name', roomBlock) || '';

    // --- Total price (from header) ---
    const totalEl = roomBlock.querySelector('.bui-price-display__value');
    if (totalEl) {
      data.total_ttc = euroToFloat(totalEl.textContent);
    }

    // --- Dates from subtitle ---
    const subtitleItems = roomBlock.querySelectorAll('.res-room-subtitle__item');
    for (const item of subtitleItems) {
      const icon = item.querySelector('svg');
      const span = item.querySelector('span:last-child');
      if (!icon || !span) continue;
      const iconClass = icon.getAttribute('class') || '';
      const dateText = span.textContent.replace(/\s+/g, ' ').trim();
      if (iconClass.includes('check_in')) {
        data.checkin = parseBookingDate(dateText);
      } else if (iconClass.includes('check_out')) {
        data.checkout = parseBookingDate(dateText);
      }
    }

    // --- Nights ---
    if (data.checkin && data.checkout) {
      const ci = new Date(data.checkin);
      const co = new Date(data.checkout);
      if (!isNaN(ci) && !isNaN(co)) {
        data.nights = Math.round((co - ci) / (1000 * 60 * 60 * 24));
      }
    }

    // --- Guest name ---
    // From overview section labels
    const overviewLabels = roomBlock.querySelectorAll('.res-room-block-overview__label');
    for (const label of overviewLabels) {
      const text = label.textContent.trim();
      if (text === 'Nom du client') {
        const info = label.nextElementSibling;
        if (info && info.classList.contains('res-room-block-overview__info')) {
          data.guest_name = info.textContent.replace(/\s+/g, ' ').trim();
        }
      }
    }

    // --- Booking ref ---
    const refEl = document.querySelector('.res-content__info');
    if (refEl && /^\d{6,}$/.test(refEl.textContent.trim())) {
      data.booking_ref = refEl.textContent.trim();
    }

    // --- Guest email ---
    const emailDiv = document.querySelector('[email*="@guest.booking.com"]');
    if (emailDiv) {
      data.guest_email = emailDiv.getAttribute('email');
    }

    // --- Price table ---
    const table = roomBlock.querySelector('.res-room-block__table');
    if (table) {
      const rows = table.querySelectorAll('.bui-table__row');

      // Collect per-night prices
      const nightlyRates = [];
      let rateDescription = '';

      for (const row of rows) {
        const cells = row.querySelectorAll('.bui-table__cell');
        if (cells.length < 2) continue;

        const firstCell = cells[0].textContent.trim();
        const lastCell = cells[cells.length - 1].textContent.trim();

        // Skip header rows
        if (row.closest('thead')) continue;

        // Per-night row: has date in first cell, "Standard Rate" in second
        if (firstCell.match(/\d+\s*[-–]\s*\d+/)) {
          const rate = euroToFloat(lastCell);
          if (!isNaN(rate)) nightlyRates.push(rate);
          // Get rate description from second cell
          const secondCell = cells[1] ? cells[1].textContent.trim() : '';
          if (secondCell && !rateDescription && !secondCell.match(/^\d/)) {
            rateDescription = secondCell;
          }
        }

        // Taxe de séjour row
        const rowText = row.textContent.replace(/\s+/g, ' ').trim();
        if (rowText.match(/taxe\s*(de\s*)?s[eé]jour/i)) {
          const tax = euroToFloat(lastCell);
          if (!isNaN(tax)) data.taxe_sejour = tax;
        }

        // Subtotal
        if (row.classList.contains('res-room-row-subtotal')) {
          data.subtotal = euroToFloat(lastCell);
        }

        // VAT
        if (rowText.match(/TVA/i)) {
          const vatMatch = rowText.match(/(\d+[\.,]?\d*)\s*%\s*(de\s*)?TVA/);
          if (vatMatch) data.tva_rate = parseFloat(vatMatch[1].replace(',', '.'));
        }
      }

      // Rate per night (TTC) — use median to avoid outliers
      if (nightlyRates.length > 0) {
        nightlyRates.sort((a, b) => a - b);
        data.rate_per_night = nightlyRates[0]; // lowest = per-night TTC
      }
    }

    // --- Description from rate type ---
    if (rateDescription) {
      data.description = `Nuitée — ${rateDescription}`;
    } else if (!data.description) {
      data.description = 'Nuitée — tarif normal';
    }

    // --- VAT default ---
    if (!data.tva_rate) data.tva_rate = 10;

    // --- Payment ---
    data.payment_method = 'Carte bancaire';

    // --- Issue date ---
    data.issue_date = new Date().toISOString().split('T')[0];

    return data;
  }

  // Fallback: use res-content__label / res-content__info pairs
  function fallbackExtract(data) {
    const labels = document.querySelectorAll('.res-content__label');
    for (const label of labels) {
      const key = label.textContent.replace(/\s+/g, ' ').trim().toLowerCase();
      let info = label.nextElementSibling;
      if (!info || !info.classList.contains('res-content__info')) {
        const parent = label.closest('.bui-grid__column-full, .bui-grid__column-4\\@medium, .bui-grid__column-6\\@medium');
        if (parent) info = parent.querySelector('.res-content__info');
      }
      if (!info) continue;
      const val = info.textContent.replace(/\s+/g, ' ').trim();

      if (key.includes('numéro de réservation')) data.booking_ref = val;
      if (key.includes('date d\'arrivée')) data.checkin = parseBookingDate(val);
      if (key.includes('date de départ')) data.checkout = parseBookingDate(val);
      if (key.includes('durée de séjour')) {
        const m = val.match(/(\d+)/);
        if (m) data.nights = parseInt(m[1]);
      }
      if (key.includes('montant total')) data.total_ttc = euroToFloat(val);
    }

    // Guest from h1
    const h1 = document.querySelector('h1');
    if (h1) {
      const parts = h1.textContent.split(' - ');
      for (const part of parts) {
        if (/^[A-Z][a-zéèêëàâîïôûùç]+\s+[A-Z]/.test(part.trim()) && !/\d/.test(part)) {
          data.guest_name = part.trim();
          break;
        }
      }
    }

    // Email
    const emailDiv = document.querySelector('[email*="@guest.booking.com"]');
    if (emailDiv) data.guest_email = emailDiv.getAttribute('email');

    if (!data.description) data.description = document.title.replace('· Détails de la réservation', '').trim();
    if (!data.tva_rate) data.tva_rate = 10;
    if (data.total_ttc && data.nights && !data.rate_per_night) {
      data.rate_per_night = data.total_ttc / data.nights;
    }
    if (!data.payment_method) data.payment_method = 'Carte bancaire';
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

    const url = `http://192.168.0.161:5042/api/invoice?${params.toString()}`;
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
