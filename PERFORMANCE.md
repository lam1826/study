# Hiệu năng: đo trước/sau (18/11/2026)

## Cách đo

- **Trước**: commit `4c918bb`. **Sau**: nhánh `feature/on-tap-viet-quiz-improve`.
- Cả hai chạy bằng `scripts/dev.mjs` (D1 giả lập bằng `node:sqlite`, tài khoản giả lập), thêm **60 ms trễ cho mỗi lượt gọi D1** để thấy rõ các lượt nối tiếp. Server ghi số lượt D1 của từng yêu cầu vào header `x-dev-d1-round-trips`.
- Trình duyệt: khung Browser của Claude desktop, đo bằng `performance` và `MutationObserver`. Số mili giây ở local chỉ để so sánh; trên website thật, mỗi yêu cầu HTTP còn cộng thêm độ trễ mạng. Đo bằng `curl` từ máy phát triển tới website hiện tại: một phản hồi nhỏ (401/404/tệp tĩnh) mất 0,3–0,9 s, có lúc tới 4 s. Vì vậy **bớt một yêu cầu phải chờ** quan trọng hơn bớt vài mili giây dựng giao diện.
- Số lượt D1 được khóa bằng test trong `tests/quiz.mjs`, để lần sửa sau không làm chậm lại mà không ai biết.

## Kết quả

| Thao tác | Trước | Sau |
|---|---|---|
| Mở trang `/` | HTML 236 KB (gzip 60,6 KB) **mỗi lần mở**, vì JS 88 KB + CSS 30 KB nhúng trong trang `no-store`. Byte đầu tiên chỉ gửi sau khi đọc xong D1: 8 lượt D1 khi worker đã chạy, 11 lượt (5 nối tiếp) khi worker vừa khởi động | HTML 120 KB (gzip 28,7 KB). JS/CSS là tệp có mã băm, lưu đệm `immutable`: lần đầu tải song song với lúc server đọc D1, từ lần thứ hai không tải lại. Khung trang gửi ngay (TTFB local 9 ms so với 178 ms). 1 lượt D1 (worker đang chạy), 2 lượt (worker vừa khởi động) |
| Bắt đầu làm bài | 2 yêu cầu nối tiếp: `POST /api/attempt` (3 D1) rồi `GET /api/attempt/:id` (2 D1): 430 ms | 1 yêu cầu (2 D1), bài làm trả về ngay: 172–182 ms |
| Chuyển câu (đề 30 câu) | Dựng lại toàn bộ khu nội dung: 72 phần tử; 2,6–3,9 ms gồm layout | Chỉ thay thẻ câu hỏi, cập nhật ô số tại chỗ: 20 phần tử; 2,3–2,5 ms |
| Chọn đáp án | Dựng lại 79 phần tử; lưu `PATCH` 3 D1 | 26–30 phần tử; `PATCH` 2 D1 (vẫn gộp nhiều lựa chọn vào một lượt lưu) |
| Tự luận: mở đáp án | `GET /api/essay/:id` (2 D1) | 1 D1; tải sẵn câu trước và câu sau trong nền |
| Tự luận: bấm "Câu tiếp" | 3 yêu cầu: tải câu (phải chờ) + **tải lại toàn bộ dữ liệu khởi động** (~28 KB gzip, 8 D1, do lần lưu "đã xem" đánh dấu dữ liệu cũ) + lưu trạng thái | Hiện ngay (1–2 ms) vì câu đã được tải sẵn; nền chỉ còn tải sẵn câu kế và lưu "đã xem". Quay lại câu trước: 0 yêu cầu |
| Mở lại "Đáp án trắc nghiệm"/"Đáp án tự luận" của chương | Luôn gọi lại API (2 D1) | Giữ trong bộ nhớ của phiên 5 phút: 0 yêu cầu, 13 ms. Quản trị lưu thay đổi thì xóa bộ nhớ này |
| Trang kế tiếp sau khi tạo bài làm | Tải lại toàn bộ dữ liệu khởi động (9 D1) | Không: bài mới được thêm vào lịch sử ngay trên máy |
| "Đánh dấu đã thuộc" trong danh sách tự luận | Lưu rồi tải lại toàn bộ dữ liệu | Lưu rồi cập nhật dữ liệu đang có trên máy |
| Đáp án tự luận cả chương (36 câu, 375 px, vòng 4) | Mở sẵn 36/36 đáp án: trang cao 73.369 px, 1.577 phần tử, ~2.002 px mỗi câu, câu đầu ở y≈620 | Hiện đề + ý chính, đáp án đầy đủ dựng khi mở: 24.912 px, 972 phần tử, ~677 px mỗi câu, câu đầu ở y=492 |
| Danh sách tự luận / Tài liệu / Thống kê (375 px, vòng 4) | 6.210 / 9.916 / 4.805 px | 3.462 / 6.025 / 3.016 px (hàng gọn, bộ lọc thu về một dòng) |

## Đã sửa ở đâu

- `worker/index.mjs`: dữ liệu khởi động đọc bằng **một `db.batch`**; tạo bài làm gộp kiểm tra chương + ngân hàng câu + bài trước vào một batch và trả luôn bài làm; mở bài làm chỉ đọc lại khi có thay đổi; trang `/` stream khung trước, dữ liệu sau.
- `worker/content.mjs`: worker mới khởi động kiểm tra ba mốc nhập nội dung bằng một truy vấn.
- `worker/study.mjs`: trang đáp án và câu tự luận đọc kiểm tra + dữ liệu bằng một batch.
- `scripts/build.mjs`: trang liên kết `/style.<hash>.css` và `/app.<hash>.js` thay vì nhúng.
- `web/app.js`, `web/study.js`: dựng lại từng phần khi chuyển câu; bộ nhớ đáp án theo chương; tải sẵn câu tự luận kề bên (bỏ qua khi bật tiết kiệm dữ liệu); bỏ các lần tải lại toàn bộ dữ liệu không cần.

## Còn cần đo trên website thật

- Độ trễ D1 thực tế (vị trí cơ sở dữ liệu so với nơi worker chạy) và việc ChatGPT Sites có chuyển tiếp phản hồi stream ngay hay gom lại rồi mới gửi. Nếu bị gom, trang vẫn đúng: lần đầu chậm hơn khoảng một lượt mạng vì phải tải JS/CSS sau HTML; từ lần sau JS/CSS lấy từ bộ nhớ đệm.
- Thời gian khởi động worker: gói `dist/server/index.js` khoảng 1,26 MB vì chứa toàn bộ nội dung để nhập. Lần sửa này chưa động tới phần đó.
