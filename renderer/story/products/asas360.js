/**
 * products/asas360.js
 *
 * PruBSN Asas360 with the Health360 medical rider (lifetime medical fund).
 */

'use strict';

module.exports = {
  id: 'asas360',
  name: 'PruBSN Asas360',
  match: (data) => /asas\s*360/i.test((data.metadata && data.metadata.productName) || ''),
  productPage: 'https://www.prubsn.com.my/en/protection/prubsn-asas-360',
};
