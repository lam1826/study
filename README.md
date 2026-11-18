# Ôn Tập Việt Quiz

Website ôn tập cá nhân bằng tiếng Việt với ngân hàng câu hỏi, bài thi, tự luận và thư viện tài liệu. Bản hosted dùng Cloudflare Worker, D1 và R2 do ChatGPT Sites quản lý. Quyền quản trị được kiểm tra phía máy chủ bằng email đăng nhập ChatGPT của chủ website, đối chiếu với biến môi trường bí mật `QUIZ_OWNER_EMAIL`. Người học đăng nhập có dữ liệu bài làm riêng.

## Phát triển

Chạy `npm run check` và `npm run build` bằng Node.js. Bản dựng đặt tại `dist/server/index.js`. Worker cần binding `DB` (D1) và `BUCKET` (R2) và danh tính do ChatGPT Sites cấp. Cài đặt schema từ `drizzle/` khi xuất bản. Môi trường local và hosted dùng dữ liệu riêng.

## Nạp nội dung

Vào **Quản trị dữ liệu** để bổ sung môn, chương, câu hỏi và tệp. Chọn chương chính xác trước khi nhập JSON. JSON xuất từ ngân hàng có thể nhập lại. Câu trùng nội dung trong cùng chương và loại được bỏ qua; một câu tự luận cần đáp án tham khảo.

Ví dụ mỗi phần tử JSON có các trường `chapter`, `kind` (`quiz` hoặc `essay`), `tier` (`main` hoặc `extra`), `prompt`, `explanation`, và đối với trắc nghiệm, `options` gồm 2–6 chuỗi; `correctIndex` là chỉ số đáp án đơn hoặc `correctIndices` là danh sách chỉ số cho câu nhiều đáp án. `sources` là các ID tài liệu cùng chương và có thể bỏ trống. Chỉ nhập câu hỏi đã đối chiếu với tài liệu.


## Nội dung đã nhập (15/11/2026)

`content/course.json` chứa 118 câu trắc nghiệm (58 Lịch sử Đảng, 30 LAN, 30 Phân tán), 228 câu tự luận Phân tán và 47 liên kết tài liệu gốc theo chương (39 tệp, trong đó đáp án tự luận được liên kết từ 9 chương). Đáp án trắc nghiệm được đọc từ dấu màu đỏ của DOCX; có 7 câu chọn hai đáp án và 1 câu chỉ có ba phương án. Giữ nguyên nội dung nguồn, không tự thêm phương án. Hai tệp câu hỏi tự luận chương 1 trùng nội dung chỉ sinh một bộ câu hỏi.

Tái tạo bằng `python3 scripts/extract-content.py <thư-mục-tài-liệu>` (cần python-docx). Dataset được nhập có đánh dấu phiên bản, ngoài migration, theo nhóm 50 câu; không ghi đè câu đã sửa. Tệp gốc nằm trong R2. Điểm nhập dịch vụ `/api/content-import?id=<id>` chỉ nhận PUT với bearer secret `CONTENT_IMPORT_TOKEN`, trước `CONTENT_IMPORT_EXPIRES_AT` (epoch milliseconds), đúng ID, kích thước và SHA-256 trong manifest. Không truyền danh tính người dùng giả; không có secret thì điểm nhập bị khóa. Không lưu giá trị secret trong source.

Khởi động gửi CSS, JavaScript và dữ liệu cần thiết trong cùng trang HTML riêng tư; không chờ ba lượt mạng nối tiếp. Chuyển mục dùng dữ liệu trong bộ nhớ và cập nhật nền. Chọn đáp án cập nhật ngay, lưu theo nhóm, có thử lại khi mất mạng; nộp bài chờ xác nhận lưu. API lưu chỉ trả xác nhận nhỏ thay vì toàn bộ đề. Tự luận tải hiển thị 20 câu mỗi lượt. `npm test` kiểm tra nhập dữ liệu, đáp án nhiều lựa chọn, chấm điểm, bảo vệ nguồn và bài làm cá nhân.

Chế độ Luyện tập trả đáp án trong đề để hiển thị đúng/sai ngay khi bấm, không chờ lưu qua mạng. Câu nhiều đáp án dùng nút Kiểm tra đáp án sau khi chọn đủ. Có thể thay lựa chọn để ôn tập; kết quả bài luyện tập tính theo các đáp án đang chọn khi nộp. Chế độ Thi thử không gửi đáp án hay giải thích xuống trình duyệt trước khi nộp hoặc hết giờ.

Lời giải trắc nghiệm được đối chiếu với bài giảng và lưu tại `content/explanations.json`, kèm trang tài liệu và lưu ý cho câu mâu thuẫn/thiếu căn cứ. Bản cập nhật lời giải chỉ sửa trường explanation của câu gốc khớp ID/nội dung; giữ nguyên đáp án, điểm và lịch sử. Bài làm cũ có lời giải mẫu được hiển thị lời giải đã đối chiếu.

## Không gian học tự luận và quản trị mở rộng

`web/study.js` và `worker/study.mjs` cung cấp học từng ý, bài viết tự lưu, tự đối chiếu và tiến độ. `content/essay-guides.json` chứa đủ 228 hướng dẫn theo tài liệu gốc; `content/chapter-overviews.json` chứa tổng quan/định hướng chương. Schema bổ sung ở migration `0002_study_workspace.sql`; backfill nội dung có revision marker riêng.

Vào **Cài đặt → Sao lưu và khôi phục** bằng tài khoản chủ trang để sao lưu cả D1 và các tệp R2. Bản khôi phục gộp theo ID và giữ các mục mới, có checkpoint trước khôi phục. JSON tải về tham chiếu các bản sao tệp trong R2, không chứa byte tệp. Bản sao chỉ chủ website truy cập được.

Bộ kiểm thử dùng Node.js 24 với SQLite tích hợp. Chi tiết đối chiếu chức năng, kiến trúc tương đương và giới hạn xác minh tại `SPEC-AUDIT.md`.

## Xem đáp án từng câu hoặc cả chương

Trong Tự luận, nút **Xem đáp án** mở nội dung của một câu, có **Câu trước / Câu tiếp**. Nút **Xem toàn bộ đáp án chương** mở tất cả câu và đáp án đầy đủ của chương trên một trang, phân nhóm chính/bổ sung, có mục lục chuyển tới từng câu và mở/thu gọn toàn bộ. Không giới hạn ở 20 câu của danh sách; không ảnh hưởng bài làm đã lưu. Không có chức năng giọng đọc.

### Xem đáp án trắc nghiệm
Vào Trắc nghiệm → chọn môn/chương → Xem đáp án trắc nghiệm. Trang `#quizanswers/<chapter>` hỗ trợ xem từng câu hoặc cả chương, lọc nhóm chính/bổ sung, hiện/ẩn đáp án, đánh dấu đủ các phương án đúng và hiển thị giải thích/nguồn. Xem đáp án không ghi lượt làm hay thay đổi tiến độ; chế độ thi thử vẫn chỉ trả đáp án sau khi nộp bài.
