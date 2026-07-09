import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotifyService } from '../../infra/notify/notify.service';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { BillingConfigService } from './billing-config.service';
import { BillingExpiryService } from './billing-expiry.service';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
} from './providers/payment-provider';
import { SepayProvider } from './providers/sepay.provider';
import { VnpayProvider } from './providers/vnpay.provider';

@Module({
  imports: [AuthModule], // JwtAuthGuard cần JwtService + SessionsService
  controllers: [BillingController],
  providers: [
    BillingService,
    BillingConfigService,
    BillingExpiryService,
    NotifyService,

    // ─── Cổng thanh toán ────────────────────────────────────────────────
    // THÊM CỔNG MỚI (VNPay, MoMo…) = tạo class implements PaymentProvider rồi:
    //   1) khai báo class ở providers bên dưới (như SepayProvider/VnpayProvider)
    //   2) thêm nó vào factory PAYMENT_PROVIDER (tham số + inject + mảng trả về)
    // Lõi BillingService gom mảng này thành registry theo `key` — không sửa gì thêm.
    SepayProvider,
    VnpayProvider,
    {
      provide: PAYMENT_PROVIDER,
      useFactory: (
        sepay: SepayProvider,
        vnpay: VnpayProvider,
      ): PaymentProvider[] => [sepay, vnpay],
      inject: [SepayProvider, VnpayProvider],
    },
  ],
  exports: [BillingConfigService], // AdminModule dùng để sửa cấu hình ở UI
})
export class BillingModule {}
