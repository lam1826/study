# Ôn Tập Việt Quiz

Website ôn tập cá nhân bằng tiếng Việt với ngân hàng câu hỏi, bài thi, tự luận và thư viện tài liệu. Bản hosted dùng Cloudflare Worker, D1 và R2 do ChatGPT Sites quản lý. Quyền quản trị được kiểm tra phía máy chủ bằng email đăng nhập ChatGPT của chủ website, đối chiếu với biến môi trường bí mật `QUIZ_OWNER_EMAIL`. Người học đăng nhập có dữ liệu bài làm riêng.

## Phát triển

Chạy `npm run check`, `npm test` và `npm run build` bằng Node.js 24. Bản dựng đặt tại `dist/server/index.js`. `npm run dev` dựng rồi chạy bản local tại http://localhost:8787 (chỉ máy này; thêm `--host=0.0.0.0` để thử bằng điện thoại cùng mạng) với D1 giả lập bằng SQLite (`.dev/`), R2 trong bộ nhớ và tài khoản thử; thêm `--admin` để đăng nhập với vai trò chủ trang, `--latency=60` để giả lập độ trễ D1. Bản local không có tệp tài liệu gốc. Worker cần binding `DB` (D1) và `BUCKET` (R2) và danh tính do ChatGPT Sites cấp. Cài đặt schema từ `drizzle/` khi xuất bản. Môi trường local và hosted dùng dữ liệu riêng.

## Hai loại câu trắc nghiệm

- **Câu hỏi chính** (`tier: "main"`): câu trong file đề trắc nghiệm của chương (đáp án tô đỏ).
- **Câu hỏi nâng cao** (`tier: "extra"`): câu bổ sung, nâng cao soạn theo giáo trình của chương; có nhãn "Nâng cao".

Khi chương có câu nâng cao, trang Trắc nghiệm hiện lựa chọn Câu hỏi chính / Câu hỏi nâng cao / Cả hai nhóm kèm số câu; trang đáp án tách hai nhóm; trang môn và chương ghi "30 chính · 10 nâng cao". Câu mới (cả hai loại) thêm vào `content/added/` theo hướng dẫn trong [content/added/README.md](content/added/README.md); website tự nhập một lần sau khi triển khai, `tests/added.mjs` kiểm tra định dạng trước.

## Nạp nội dung

Vào **Quản trị dữ liệu** để bổ sung môn, chương, câu hỏi và tệp. Chọn chương chính xác trước khi nhập JSON. JSON xuất từ ngân hàng có thể nhập lại. Câu trùng nội dung trong cùng chương và loại được bỏ qua; một câu tự luận cần đáp án tham khảo.

Ví dụ mỗi phần tử JSON có các trường `chapter`, `kind` (`quiz` hoặc `essay`), `tier` (`main` hoặc `extra`), `prompt`, `explanation`, và đối với trắc nghiệm, `options` gồm 2–6 chuỗi; `correctIndex` là chỉ số đáp án đơn hoặc `correctIndices` là danh sách chỉ số cho câu nhiều đáp án. `sources` là các ID tài liệu cùng chương và có thể bỏ trống. Chỉ nhập câu hỏi đã đối chiếu với tài liệu.


## Nội dung đã nhập (15/11/2026)

`content/course.json` chứa 118 câu trắc nghiệm (58 Lịch sử Đảng, 30 LAN, 30 Phân tán), 228 câu tự luận Phân tán và 47 liên kết tài liệu gốc theo chương (39 tệp, trong đó đáp án tự luận được liên kết từ 9 chương). Đáp án trắc nghiệm được đọc từ dấu màu đỏ của DOCX; có 7 câu chọn hai đáp án và 1 câu chỉ có ba phương án. Giữ nguyên nội dung nguồn, không tự thêm phương án. Hai tệp câu hỏi tự luận chương 1 trùng nội dung chỉ sinh một bộ câu hỏi.

Tái tạo bằng `python3 scripts/extract-content.py <thư-mục-tài-liệu>` (cần python-docx). Dataset được nhập có đánh dấu phiên bản, ngoài migration, theo nhóm 50 câu; không ghi đè câu đã sửa. Tệp gốc nằm trong R2. Điểm nhập dịch vụ `/api/content-import?id=<id>` chỉ nhận PUT với bearer secret `CONTENT_IMPORT_TOKEN`, trước `CONTENT_IMPORT_EXPIRES_AT` (epoch milliseconds), đúng ID, kích thước và SHA-256 trong manifest. Không truyền danh tính người dùng giả; không có secret thì điểm nhập bị khóa. Không lưu giá trị secret trong source.

Trang `/` gửi khung giao diện ngay, kèm liên kết tới `/style.<hash>.css` và `/app.<hash>.js` (lưu đệm vĩnh viễn theo mã băm), rồi gửi tiếp dữ liệu riêng của người học trong cùng phản hồi; trình duyệt tải JS/CSS trong lúc server đọc D1, từ lần thứ hai không tải lại. Dữ liệu khởi động đọc bằng một lượt D1. Số đo trước/sau ở `PERFORMANCE.md`. Chuyển mục dùng dữ liệu trong bộ nhớ và cập nhật nền. Chọn đáp án cập nhật ngay, lưu theo nhóm, có thử lại khi mất mạng; nộp bài chờ xác nhận lưu. API lưu chỉ trả xác nhận nhỏ thay vì toàn bộ đề. Tạo bài làm trả về luôn bài làm nên mở bài không cần yêu cầu thứ hai. Tự luận tải hiển thị 20 câu mỗi lượt. `npm test` kiểm tra nhập dữ liệu, đáp án nhiều lựa chọn, chấm điểm, bảo vệ nguồn, bài làm cá nhân, việc xáo trộn giữ đáp án đi cùng nội dung, số lượt D1 của từng API và các hàm hiển thị trong `web/answer-key.js`.

Chế độ Luyện tập trả đáp án trong đề để hiển thị đúng/sai ngay khi bấm, không chờ lưu qua mạng. Câu nhiều đáp án dùng nút Kiểm tra đáp án sau khi chọn đủ. Khi đáp án của một câu đã hiện (chọn xong câu một đáp án, hoặc bấm Kiểm tra với câu nhiều đáp án), lựa chọn của câu đó bị khóa: lựa chọn đầu tiên được tính, câu sai vào danh sách Ôn câu sai sau khi nộp; muốn làm lại thì dùng Luyện lại câu chưa đúng. Chế độ Thi thử không gửi đáp án hay giải thích xuống trình duyệt trước khi nộp hoặc hết giờ.

Lời giải trắc nghiệm được đối chiếu với bài giảng và lưu tại `content/explanations.json`, kèm trang tài liệu và lưu ý cho câu mâu thuẫn/thiếu căn cứ. Bản cập nhật lời giải chỉ sửa trường explanation của câu gốc khớp ID/nội dung; giữ nguyên đáp án, điểm và lịch sử. Bài làm cũ có lời giải mẫu được hiển thị lời giải đã đối chiếu.

## Không gian học tự luận và quản trị mở rộng

`web/study.js` và `worker/study.mjs` cung cấp học từng ý, bài viết tự lưu, tự đối chiếu và tiến độ. `content/essay-guides.json` chứa đủ 228 hướng dẫn theo tài liệu gốc; `content/chapter-overviews.json` chứa tổng quan/định hướng chương. Schema bổ sung ở migration `0002_study_workspace.sql`; backfill nội dung có revision marker riêng.

Vào **Cài đặt → Sao lưu và khôi phục** bằng tài khoản chủ trang để sao lưu cả D1 và các tệp R2. Bản khôi phục gộp theo ID và giữ các mục mới, có checkpoint trước khôi phục. JSON tải về tham chiếu các bản sao tệp trong R2, không chứa byte tệp. Bản sao chỉ chủ website truy cập được.

Bộ kiểm thử dùng Node.js 24 với SQLite tích hợp. Chi tiết đối chiếu chức năng, kiến trúc tương đương và giới hạn xác minh tại `SPEC-AUDIT.md`.

## Xem đáp án từng câu hoặc cả chương

Trong Tự luận, nút **Xem đáp án** mở nội dung của một câu, có **Câu trước / Câu tiếp**. Nút **Xem toàn bộ đáp án chương** mở tất cả câu của chương trên một trang, phân nhóm chính/bổ sung: mỗi câu hiện đề và **Ý chính cần nhớ**; đáp án đầy đủ thu gọn, bấm **Xem đáp án đầy đủ** để mở (chỉ dựng khi mở), hoặc **Mở tất cả đáp án / Thu gọn tất cả**. Trên điện thoại có thanh Câu trước · chọn câu · Câu tiếp ở cuối màn hình. Không giới hạn ở 20 câu của danh sách; chỉ đọc, không đổi trạng thái học hay bài làm đã lưu. Không có chức năng giọng đọc.

### Xem đáp án trắc nghiệm
Vào Trắc nghiệm → chọn môn/chương → Xem đáp án trắc nghiệm. Trang `#quizanswers/<chapter>` hỗ trợ xem từng câu hoặc cả chương, lọc nhóm chính/bổ sung, hiện/ẩn đáp án, đánh dấu đủ các phương án đúng và hiển thị giải thích/nguồn. Xem đáp án không ghi lượt làm hay thay đổi tiến độ; chế độ thi thử vẫn chỉ trả đáp án sau khi nộp bài.

## Cải tiến chức năng và bố cục (vòng 4, 18/11/2026)

- **Màu theo loại nội dung**, giống nhau ở mọi trang và luôn có nhãn chữ: Đáp án (xanh lá), Giải thích (xanh dương), Ví dụ (vàng), Lưu ý (cam), Nguồn (xám). Khối có nền dịu và viền 1 px; trang đáp án có dòng chú thích màu. Trong lời giải trắc nghiệm, câu bắt đầu bằng "Lưu ý:" và câu cảnh báo về chính câu hỏi hoặc đáp án gốc (đáp án gốc có mâu thuẫn, giữ khóa chấm gốc, câu hỏi diễn đạt quá rộng, không nên học thuộc số liệu chưa có nguồn) được tách thành khối Lưu ý: 9/118 lời giải. Hàm thuần `noteParts`, có test chứng minh không mất chữ và luôn còn phần giải thích.
- **Làm bài**: sau khi hiện đáp án, trang tự đưa dòng kết luận và "Vì sao" vào tầm nhìn; màn ≥ 1200 px chia hai cột (phương án bên trái, kết luận và giải thích bên phải). Phím tắt trên máy tính: 1–6 hoặc A–F chọn, Enter nút chính, ← → chuyển câu, M đánh dấu.
- **Đáp án trắc nghiệm**: khi "Che đáp án", chạm một phương án để đoán trước; trang đếm "Tự kiểm tra: đúng x/y" và có nút **Luyện lại các câu đoán sai** (tạo lượt luyện tập chỉ gồm các câu đó; API `POST /api/attempt` nhận thêm trường tùy chọn `questionIds`). Màn ≥ 1100 px chia hai cột khi đã hiện đáp án.
- **Danh sách tự luận**: dòng chương với Đổi chương, ô tìm kiếm, chip trạng thái có số câu; mỗi câu là một hàng gọn (Xem đáp án · Tự viết · Đánh dấu đã thuộc). **Tự viết** có bộ đếm chữ và ô **Xem ý chính** bên cạnh (mở ô này được tính là đã xem đáp án).
- **Tài liệu** gom theo chương, mỗi tệp một hàng (tên · Tải xuống), bộ lọc môn/chương/sắp xếp nằm trong "Lọc và sắp xếp". **Thống kê**: một dòng tóm tắt (điểm dùng dấu phẩy thập phân), tiến độ dạng danh sách, mỗi câu hay sai có liên kết tới đáp án và "Ôn câu sai"; lịch sử ghi chế độ và điểm.
- Mỗi màn hình chỉ một nút chính; Tự luận, Tài liệu, Thống kê có đường quay lại; trang đáp án bỏ khung lồng trong thẻ.

## Màn hình học (bản cải tiến 18/11/2026)

- **Trắc nghiệm**: thanh trên cùng gọn (chế độ, số câu đã trả lời, giờ thi, Nộp bài), đề bài hiện ngay. Mỗi phương án có chữ cái và nhãn chữ: `✓ Đáp án đúng`, `✕ Bạn chọn · Sai`, `● Đã chọn`; màu chỉ nhắc lại nhãn. Sau khi được xem đáp án có dòng kết luận (Chính xác / Chưa đúng, kèm chữ cái bạn chọn và đáp án đúng) và khối **“Vì sao đáp án … đúng?”** tách phần lý giải với nguồn đối chiếu. Dòng “Đáp án đúng: …” trong lời giải chỉ được ẩn khi trùng khớp khóa đáp án đã lưu. Thi thử chỉ hiện các nhãn này sau khi nộp.
- **Điện thoại**: Câu trước / Câu tiếp nằm ở thanh cố định cuối màn hình; nút chính tự đổi thành Kiểm tra đáp án (câu nhiều đáp án đã chọn đủ), Nộp bài (câu cuối) hoặc Về kết quả (khi xem lại) (thay thanh điều hướng chính trong lúc làm bài và xem đáp án), ô số câu có dấu ✓/✕, phím ← → trên máy tính. Trang môn và chương chỉ hiện các nút chương đó thực sự có (Làm trắc nghiệm, Đáp án trắc nghiệm, Học tự luận, Đáp án tự luận, Tài liệu). Kiểm tra không tràn ngang ở 320 px.
- **Xem đáp án trắc nghiệm**: Từng câu (mặc định trên điện thoại) hoặc Cả chương, nhớ lựa chọn trên máy; “Che đáp án để tự kiểm tra” rồi mở từng câu.
- **Tự luận**: mở thẳng vào câu hỏi; bốn cách học (Đáp án, Học từng ý, Tự viết, Đối chiếu). Đáp án mở đầu bằng khung **Ý chính cần nhớ** đánh số, sau đó là Trả lời → Giải thích → Ví dụ → Nguồn (nguồn chữ nhỏ). Bản nháp, trạng thái và bảng tự đánh giá lưu như trước. Trạng thái đặt bằng hai nút **✓ Đã thuộc** và **↻ Cần ôn lại** (bấm lần nữa để bỏ); Sao chép, In và trạng thái chi tiết nằm trong **Thêm thao tác**. Tên tài liệu nhập từ tên tệp được hiển thị dễ đọc (dấu gạch thành khoảng trắng, kèm loại tệp); tên gốc không đổi, chủ trang đổi tên được trong Quản trị.
- Màu đáp án đúng/sai dùng tông dịu, đạt tương phản WCAG AA ở cả chế độ sáng và tối. Khung đề bài và lời giải dùng nền và viền mảnh thay cho viền trái dày; nút chính dùng một màu (`--solid`) ở cả hai chế độ; chữ nhỏ nhất ≥ 11 px.
- **Trang chủ**: mở đầu bằng việc cần ôn: bài đang làm dở (đếm đủ; hiện 2 bài gần nhất kèm liên kết xem các bài còn lại; ghi rõ chế độ, chương, số câu đã làm, thời gian còn lại), câu trắc nghiệm còn sai theo chương (mở thẳng chế độ Ôn câu sai), câu tự luận đánh dấu cần ôn, các câu học gần đây; danh sách môn và số liệu tổng nằm bên cạnh.
- **Môn → chương → làm bài**: mỗi chương chia hai nhóm Trắc nghiệm (Làm bài · Xem đáp án) và Tự luận (Học từng câu · Đáp án cả chương); chương chưa có câu hỏi được gom lại. Trang chọn chế độ chỉ hiện tên chương (bấm Đổi chương để chọn lại), nút Bắt đầu cố định cuối màn hình điện thoại; thanh điều hướng điện thoại có mục Môn học.
- **Nộp bài và kết quả**: hộp nộp bài ngay trong trang liệt kê câu chưa trả lời và câu đã đánh dấu (bấm để quay lại câu đó); thi thử nhắc khi còn 5 phút và 1 phút, tự nộp khi hết giờ. Kết quả có điểm, một câu gợi ý bước tiếp theo, và nút chính Xem lại các câu chưa đúng.
- **Nút nổi của ChatGPT Sites**: khi nền tảng chèn tiện ích nổi (ví dụ "Edit site" của chủ trang) che vùng đáy màn hình điện thoại, các thanh dưới cùng tự nới thêm đúng chiều cao của nó (biến CSS `--site-lift`, cộng vào `--safe-bottom`) để Câu trước / Câu tiếp, Bắt đầu và thanh điều hướng vẫn bấm được; tiện ích của nền tảng không bị ẩn hay sửa.
