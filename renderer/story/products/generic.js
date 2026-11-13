/**
 * products/generic.js
 *
 * Fallback wording for any product without its own profile.
 */

'use strict';

module.exports = {
  id: 'generic',
  name: 'PruBSN takaful plan',
  match: () => false,
  productPage: 'https://www.prubsn.com.my/en/',
  // Labels for the monthly breakdown donut (storyModel.js `breakdown` keys).
  breakdownLabels: {
    medical: { title: 'Medical card', text: 'Hospital and treatment bills' },
    basic: { title: 'Basic plan', text: 'Death and total permanent disability cover' },
    wakalah: { title: 'Wakalah certificate charge', text: 'Certificate administration and service' },
    riders: { title: 'Riders and add-ons', text: 'Extra protection chosen in your quotation' },
  },
};
