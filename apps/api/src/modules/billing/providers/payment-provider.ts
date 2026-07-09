/**
 * Lớp trừu tượng cổng thanh toán.
 *
 * THÊM CỔNG MỚI (VNPay, MoMo, ZaloPay…) = tạo 1 class `implements PaymentProvider`
 * rồi đăng ký ở `billing.module.ts`. Lõi billing (tạo đơn, kích hoạt PRO, hết hạn)
 * KHÔNG cần sửa — chỉ làm việc với interface này.
 */

/** Token DI để gom mọi provider lại (NestJS multi-provider). */
export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

/** 1 đơn cần thu tiền — lõi tạo ra, đưa cho cổng để mở phiên trả. */
export interface PaymentOrder {
  orderCode: string; // mã đơn duy nhất (dùng làm nội dung CK / vnp_TxnRef)
  amount: number; // VND
  months: number;
  description: string;
}

/** Cách khách trả tiền — QR/chuyển khoản (SePay) hoặc redirect sang cổng (VNPay). */
export type ChargeResult =
  | {
      kind: 'qr';
      qrUrl: string; // ảnh VietQR đã gắn số tiền + nội dung
      transferContent: string; // = orderCode
      bankName: string;
      bankAccount: string;
      holder: string;
    }
  | { kind: 'redirect'; url: string };

/** Đầu vào khi cổng gọi callback/webhook/IPN về (POST body hoặc GET query). */
export interface CallbackInput {
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
  body: unknown;
}

/** Kết quả đã chuẩn hoá sau khi provider đọc callback. */
export interface CallbackResult {
  ok: boolean; // xác thực (chữ ký / apikey) hợp lệ?
  paid: boolean; // giao dịch thành công (tiền đã vào)?
  /** Cổng xác định CHÍNH XÁC mã đơn (vd VNPay vnp_TxnRef). null nếu không chắc. */
  orderCode: string | null;
  /** Nội dung tự do để lõi TỰ DÒ mã đơn trong đó (vd SePay: nội dung CK). */
  rawContent: string | null;
  providerTxnId: string | null; // id giao dịch bên cổng — chống xử lý trùng
  amount: number | null; // VND thực nhận
  note?: string;
}

/** Kết cục xử lý callback (lõi quyết định) → provider dịch sang body ack riêng. */
export type CallbackOutcome =
  | 'success'
  | 'already_paid'
  | 'not_found'
  | 'invalid_amount'
  | 'invalid_sig'
  | 'ignored';

export interface PaymentProvider {
  readonly key: string; // 'sepay' | 'vnpay' | …
  /** Đã có đủ cấu hình (DB/.env) để dùng chưa. */
  isConfigured(): Promise<boolean>;
  /** Mở phiên thanh toán cho đơn → trả cách khách trả tiền. */
  createCharge(order: PaymentOrder): Promise<ChargeResult>;
  /** Đọc callback từ cổng → chuẩn hoá kết quả cho lõi. */
  parseCallback(input: CallbackInput): Promise<CallbackResult>;
  /** Body trả về cho cổng theo kết cục (VNPay cần {RspCode,Message}). Không có = {success}. */
  ack?(outcome: CallbackOutcome): unknown;
}
