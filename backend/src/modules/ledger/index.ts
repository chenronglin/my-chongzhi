import type { IamService } from '@/modules/iam/iam.service';
import type { LedgerContract } from '@/modules/ledger/contracts';
import { LedgerRepository } from '@/modules/ledger/ledger.repository';
import { createLedgerRoutes } from '@/modules/ledger/ledger.routes';
import { LedgerService } from '@/modules/ledger/ledger.service';
import type { OrderContract } from '@/modules/orders/contracts';

export interface LedgerModule {
  service: LedgerService;
  contract: LedgerContract;
  routes: ReturnType<typeof createLedgerRoutes>;
}

export function createLedgerModule(
  iamService: IamService,
  orderContract: OrderContract,
): LedgerModule {
  const repository = new LedgerRepository();
  const service = new LedgerService(repository, orderContract);

  return {
    service,
    contract: service,
    routes: createLedgerRoutes({
      ledgerService: service,
      iamService,
    }),
  };
}
