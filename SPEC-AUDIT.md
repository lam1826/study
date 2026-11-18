# Đối chiếu đặc tả — 17/11/2026

## Chức năng đã triển khai

| Phần | Kết quả |
|---|---|
| 1–4: cấu trúc, môn, chương, dashboard | 3 môn, 20 chương; mô tả/biểu tượng; đếm riêng trắc nghiệm/tự luận; tổng quan từng chương; thêm/sửa/sắp xếp; xóa mục trống; tiến độ và hoạt động gần đây |
| 5: trắc nghiệm | Luyện tập phản hồi ngay, thi có giờ và giấu đáp án, ôn câu sai từ nhiều bài; sửa đúng rồi nộp thì loại khỏi danh sách cần ôn; ID phương án ổn định khi đảo; ưu tiên câu chính khi kết hợp; kết quả và tỷ lệ đúng |
| 6: tự luận | 228 đáp án đầy đủ, giữ phần trả lời nguồn, thêm giải thích/ví dụ và trang tài liệu; mã câu; ý chính; hai tab chính/bổ sung; tìm/lọc trạng thái; hiện/ẩn, sao chép, in, thu gọn; học từng ý; viết và tự lưu; tự đối chiếu checklist; 6 trạng thái |
| 7: tài liệu | Xem/tải/tìm/sắp xếp/đổi tên/thay thế/xóa; PDF, DOCX, văn bản, Markdown, ảnh; nguồn của tự luận mở tab mới |
| 8: quản trị | Danh sách chính/bổ sung tách theo bộ lọc; lọc chương/loại; soạn mã và ý chính; đáp án tối đa 500.000 ký tự, vượt giới hạn bị từ chối nguyên vẹn, không cắt; nhập JSON chia nhóm 100, chống trùng, xuất JSON/CSV |
| 9: thống kê | Đúng/sai/điểm/lịch sử/câu hay sai; tự luận đã học/xem/viết/thuộc/cần ôn; thanh tiến độ theo chương và môn |
| 10–11: danh tính và dữ liệu | Danh tính ChatGPT; D1 + R2; bài làm/tiến độ riêng theo người dùng; quản trị kiểm tra tại server; sao lưu dữ liệu và tệp, khôi phục gộp theo ID có checkpoint trước khôi phục |
| 12: tài liệu gửi qua ChatGPT | Đọc và đối chiếu tài liệu, phân môn/chương, soạn nội dung, kiểm tra trùng, nhập dữ liệu đã kiểm duyệt. Không quảng cáo có AI tự động chạy trong trang |
| 13: giao diện | Sidebar và menu điện thoại; bố cục đối chiếu 2 cột trên desktop, 1 cột trên mobile; Markdown cơ bản, tiêu đề, đậm, mã, văn bản công thức giữ nguyên |

## Các quyết định giữ dữ liệu

- Migration 0002 chỉ thêm cột/bảng; không sửa migration cũ hoặc xóa dữ liệu.
- ID câu hỏi, đáp án đúng và tệp cũ giữ nguyên. Nội dung mới cập nhật đúng ID + normalized của 228 câu gốc, có revision marker; các lần khởi động sau không ghi đè chỉnh sửa quản trị.
- Bài tự luận cũ có nội dung được chuyển trạng thái đã tự trả lời; cờ đã thuộc được giữ.
- Không xóa chương còn câu hỏi, tài liệu hoặc lịch sử để bảo toàn dữ liệu liên quan.
- Sao lưu lưu các bản sao tệp trên R2. JSON tải về chứa dữ liệu và tham chiếu tệp; không phải ZIP tệp độc lập. Khôi phục không xóa các bản ghi phát sinh sau sao lưu.
- DB dùng questions/options JSON, essays, attempts/answers/flags JSON làm các thực thể tương đương danh sách bảng gợi ý; tránh di chuyển dữ liệu không cần thiết.
- Đăng ký/đăng nhập/đăng xuất/mật khẩu do ChatGPT quản lý. Website quản lý tên hiển thị và tiến độ; không tạo mật khẩu thứ hai.

## Kiểm thử

- `npm run check`, `npm run build`, `npm test`.
- 346 câu, 7 câu nhiều đáp án, chấm đúng và bảo mật đáp án thi trước khi nộp.
- Lưu và đọc lại bài >16.000 ký tự; từ chối nội dung >500.000 ký tự mà không mất bản cũ.
- Cập nhật trạng thái riêng không xóa bài, checklist và dữ liệu hai tài khoản độc lập.
- Ôn câu sai tích lũy và giải quyết sau lượt trả lời đúng.
- Sắp xếp chương, chặn thứ tự lẫn môn, chặn xóa chương có dữ liệu.
- Backup 47 tệp giả lập cùng dữ liệu thật, khôi phục bản gốc và tự tạo checkpoint.
- Browser QA: hiện/ẩn, học từng ý, soạn/lưu/tải lại, đối chiếu, quản trị và tạo bản sao; viewport 390/320 không tràn ngang. Kiểm thử local dùng tài khoản giả lập, không tự thực hiện đăng ký/đổi mật khẩu hoặc đăng nhập trên thiết bị thật của người dùng.
