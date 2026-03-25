import type { IamService } from '@/modules/iam/iam.service';
import type { LedgerService } from '@/modules/ledger/ledger.service';
import type { PaymentContract } from '@/modules/payments/contracts';
import { PaymentsRepository } from '@/modules/payments/payments.repository';
import { createPaymentsRoutes } from '@/modules/payments/payments.routes';
import { PaymentsService } from '@/modules/payments/payments.service';

export interface PaymentsModule {
  service: PaymentsService;
  contract: PaymentContract;
  routes: ReturnType<typeof createPaymentsRoutes>;
}

export function createPaymentsModule(
  iamService: IamService,
  ledgerService: LedgerService,
): PaymentsModule {
  const repository = new PaymentsRepository();
  const service = new PaymentsService(repository, ledgerService);

  return {
    service,
    contract: service,
    routes: createPaymentsRoutes({
      paymentsService: service,
      iamService,
    }),
  };
}
