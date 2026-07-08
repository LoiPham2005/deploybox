# Cấu hình thanh toán (nâng cấp PRO)

Kiến trúc cắm nhiều cổng (`PaymentProvider`). Hiện có **SePay** (VietQR chuyển khoản)
đang dùng; **VNPay** đã dựng sẵn, chỉ cần điền credential + test sandbox là bật được.

Bật/tắt nút mua cho owner ở **Admin → Tính năng → "Cho phép mua Nâng cấp Pro"**
(`billing_pro_upgrade`). Admin luôn không giới hạn, không thấy nút này.

## Chung

```bash
PRO_PRICE_VND=99000            # giá 1 tháng (VND)
PAYMENT_PROVIDER_DEFAULT=sepay # cổng mặc định khi khách bấm "Mua Pro"
```

## SePay — VietQR chuyển khoản (đang dùng)

1. Đăng ký https://sepay.vn, liên kết tài khoản ngân hàng nhận tiền.
2. Vào **Webhooks** → tạo webhook:
   - URL: `https://api.sneakup.io.vn/api/v1/billing/webhook/sepay`
   - Đặt **API Key** (chuỗi bí mật bất kỳ) → dán vào `SEPAY_WEBHOOK_APIKEY`.
3. Điền `.env` trên VPS:

```bash
SEPAY_ACCOUNT=00000406601                 # số tài khoản nhận tiền
SEPAY_BANK=TPBank                         # mã ngân hàng
SEPAY_HOLDER=PHAM DUC LOI                  # tên chủ TK (chỉ để hiển thị)
SEPAY_QR_BASE=https://qr.sepay.vn/img     # mặc định, không cần đổi
SEPAY_WEBHOOK_APIKEY=<key đặt ở bước 2>
```

**Luồng:** khách bấm Mua Pro → app sinh VietQR (số tiền + nội dung = mã đơn `DBPRO…`)
→ khách quét chuyển khoản → SePay bắn webhook → app khớp mã đơn trong nội dung CK +
đúng số tiền → kích hoạt PRO (cộng dồn hạn nếu còn hạn). Xác thực webhook bằng header
`Authorization: Apikey <SEPAY_WEBHOOK_APIKEY>`. Chống trùng theo id giao dịch SePay.

> SePay gửi webhook cho MỌI khoản tiền vào tài khoản — app chỉ kích hoạt khi nội dung
> CK chứa mã đơn đang chờ; giao dịch lạ được bỏ qua (trả 200).

## VNPay — redirect (điền sau, test sandbox trước)

```bash
VNPAY_TMN_CODE=<mã merchant>
VNPAY_HASH_SECRET=<secret ký HMAC-SHA512>
VNPAY_PAY_URL=https://sandbox.vnpayment.vn/paymentv2/vpcpay.html  # prod: đổi sang vpcpay thật
VNPAY_RETURN_URL=https://sneakup.io.vn/settings/billing
```

IPN URL khai với VNPay: `https://api.sneakup.io.vn/api/v1/billing/webhook/vnpay`.
Thuật toán ký theo chuẩn VNPay 2.1.0 (`vnpay.provider.ts`) — **test ở sandbox trước khi
bật thật**. Khi đã cấu hình, đổi `PAYMENT_PROVIDER_DEFAULT=vnpay` hoặc cho khách chọn.

## Thêm cổng mới (MoMo, ZaloPay…)

1. Tạo `apps/api/src/modules/billing/providers/<ten>.provider.ts` — class
   `implements PaymentProvider` (xem `sepay.provider.ts` / `vnpay.provider.ts`).
2. Đăng ký ở `billing.module.ts`: thêm class vào `providers` + vào factory
   `PAYMENT_PROVIDER` (tham số + `inject` + mảng trả về).
3. Thêm biến `.env` tương ứng vào `config/config.schema.ts`.

Lõi (tạo đơn, kích hoạt PRO, hết hạn, nhắc gia hạn) **không cần sửa**.

## Hết hạn / gia hạn

- Trả trước theo tháng (1/3/6/12). SePay không tự động thu → **gia hạn thủ công**.
- Job nền (mỗi 6h): nhắc trước **3 ngày** (email + Telegram), quá hạn + **ân hạn 3 ngày**
  → tự hạ FREE. App đang chạy vẫn chạy, chỉ chặn tạo mới vượt hạn mức.
- Admin nâng tay (Admin Panel → team → Nâng PRO) = comp, `planExpiresAt=null`, không hết hạn.
