Tính năng nên làm (xếp theo đáng tiền)
1. Bác sĩ lỗi deploy — AI đọc log lỗi rồi chỉ cách sửa 🌟 (làm cái này trước)
Deploy fail → AI đọc build log → giải thích bằng tiếng Việt + gợi ý sửa cụ thể:

"Build thiếu devDependencies (rimraf). Sửa: đổi lệnh cài thành npm ci --include=dev."

Đây là điểm khác biệt lớn nhất so với Coolify/Vercel, và là nỗi đau thật của bạn. Claude giỏi nhất đúng mảng này.

2. Tự nhận diện cấu hình khi tạo project
Kết nối repo → AI đọc package.json + cấu trúc file → tự đoán: framework (Next.js/NestJS/Vite), lệnh build, lệnh start, port, biến môi trường cần có. Bỏ được bước config tay — thứ đã gây ra một nửa số lỗi deploy của bạn.

3. Copilot hỗ trợ (chat)
User hỏi "app tôi sao bị 502", "thêm HTTPS kiểu gì" → AI trả lời dựa trên trạng thái project của họ. Về cơ bản là "tôi" thành một tính năng trong app.

Phụ (làm sau): tóm tắt log dài 2000 dòng thành 3 dòng; gợi ý tối ưu ("app restart 5 lần → có thể thiếu RAM"); tự sinh Dockerfile.