# Booking Invoice — Extension Chrome

Scrape une page de réservation Booking.com et génère automatiquement une facture.

## Installation

1. Ouvrir `chrome://extensions`
2. Activer le **Mode développeur** (toggle en haut à droite)
3. Cliquer **Charger l'extension non empaquetée**
4. Sélectionner le dossier `booking-invoice-extension/`

## Utilisation

1. Aller sur la page d'une réservation Booking.com
2. Un bouton flottant **🧾 Facture** apparaît en bas à droite
3. Cliquer → la facture s'ouvre dans un nouvel onglet
4. Vérifier et corriger si besoin → **Envoyer par email** ou **Imprimer**

**Prérequis :** le serveur `booking-invoice` doit tourner sur `localhost:5042`.

## Structure

```
manifest.json   — Extension manifest v3
content.js      — Content script : scrape la page + bouton flottant
popup.html      — Popup alternative avec bouton Analyser + Aperçu
popup.js        — Logique de la popup
icons/          — Icônes
```
