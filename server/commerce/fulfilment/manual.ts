// Manual fulfilment (Brazil for now): nothing is sent anywhere. The order waits in the operations
// page with its production sheet (operations.ts) until an operator has handed the file to a local
// lab and framer, then they move it on by hand: sent to production → shipped → delivered.

import type { FulfilmentAdapter } from './types';

export const manualFulfilment: FulfilmentAdapter = {
  route: 'manual',
  async submit() {
    return {
      partnerStatus: 'awaiting_operator',
      sentToProduction: false,
      note: 'Manual fulfilment: send the production sheet and print file to the local lab, then mark the order as in production.',
    };
  },
};
