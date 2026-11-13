/**
 * products/anugerahmax.js
 *
 * PruBSN AnugerahMax with the Medic TotalCare medical rider.
 */

'use strict';

module.exports = {
  id: 'anugerahmax',
  name: 'PruBSN AnugerahMax',
  match: (data) => /anugerahmax/i.test((data.metadata && data.metadata.productName) || ''),
  productPage: 'https://www.prubsn.com.my/en/protection/prubsn-anugerahmax/',
  breakdownLabels: {
    medical: { title: 'Medic TotalCare', text: 'Your medical card' },
    basic: { title: 'AnugerahMax basic plan', text: 'Death and total permanent disability cover' },
    wakalah: { title: 'Wakalah certificate charge', text: 'Certificate administration and service' },
    riders: { title: 'Riders and add-ons', text: 'Such as accident cover, as chosen in your quotation' },
  },
};
