# Thêm câu hỏi: câu hỏi chính và câu hỏi nâng cao

Website chia câu trắc nghiệm thành hai loại (trường `tier`):

| Loại | `tier` | Nguồn | Hiển thị |
|---|---|---|---|
| Câu hỏi chính | `main` | Câu trong **file đề trắc nghiệm** của chương (ví dụ `Công-nghệ-mạng-Lan-bài-1.docx`; đáp án là phần tô đỏ) | Nhóm "Câu hỏi chính" |
| Câu hỏi nâng cao | `extra` | Câu **bổ sung, nâng cao** soạn theo **giáo trình** của chương (PDF bài giảng) | Nhóm "Câu hỏi nâng cao", có nhãn "Nâng cao" |

Khi một chương có câu nâng cao, trang Trắc nghiệm tự hiện lựa chọn **Câu hỏi chính / Câu hỏi nâng cao / Cả hai nhóm** (kèm số câu); trang đáp án tách hai nhóm; trang môn và chương ghi "30 chính · 10 nâng cao".

## Cách thêm

1. Mỗi chương một tệp `content/added/<mã-chương>.json` (ví dụ `lan-2.json`). Mã chương có trong `content/course.json` (`lan-1`…`lan-9`, `history-1`, `history-2`, `distributed-1`…`distributed-9`).
2. Chương chưa có trong `content/course.json` (ví dụ Bài 3 Lịch sử Đảng) phải khai báo trong `index.json`:
   ```json
   {"chapters": [{"id": "history-3", "subject": "history", "title": "Bài 3. …"}]}
   ```
   Nếu chương đó đã được tạo trên website với cùng mã, tên trên website được giữ nguyên. Nếu trùng tên với một chương khác mã, chương không được tạo và câu của nó bị bỏ qua (không làm hỏng website).
3. Mỗi tệp là một mảng câu:
   ```json
   [
     {
       "tier": "main",
       "prompt": "Loại băng thông nào được đề cập đến trong Ethernet 10BASE-T?",
       "options": ["1 Mbps", "10 Mbps", "100 Mbps", "1 Gbps"],
       "correct": 1,
       "explanation": "Lý do đáp án đúng, vì sao các phương án khác sai.\n\nNguồn đối chiếu: chapter01(1).pdf, trang PDF 4, mục 1.1.1.",
       "sources": ["e4ed5483-2a2a-524d-a3cc-84fd3fda42b1"],
       "from": "Công-nghệ-mạng-Lan-bài-1.docx, câu 1"
     }
   ]
   ```
   - `correct`: vị trí phương án đúng, đếm từ 0; câu nhiều đáp án dùng mảng, ví dụ `[0, 2]`.
   - `options`: 2–6 phương án, không trùng nhau.
   - `explanation`: phần giải thích, dòng cuối bắt buộc dạng `Nguồn đối chiếu: <tài liệu>, trang …`. Nếu đáp án trong file đề có điểm chưa khớp giáo trình, giữ đáp án đó và thêm một câu "Lưu ý: …" (website tô màu cam).
   - `sources`: mã tài liệu của **cùng chương** (xem `content/course.json` → `documents`); để `[]` nếu chưa có.
   - `from`: ghi chú nơi lấy câu (không hiển thị).
4. Chạy `npm run build`, `npm run check`, `npm test`, `npm run build`. `tests/added.mjs` báo lỗi nếu: sai chương, sai `tier`, phương án trùng, `correct` sai vị trí, thiếu lời giải hoặc dòng nguồn, hoặc **đề trùng với câu đã có trong chương** (website sẽ bỏ qua câu trùng).
5. Triển khai. Lần chạy đầu sau triển khai, website tự nhập các câu mới **một lần** (mã phiên bản tính từ nội dung các tệp). Câu đã có cùng đề trong chương không bị ghi đè; muốn sửa câu đã nhập thì sửa trong trang Quản trị.

## Lưu ý

- Không sửa câu trong `content/course.json` để thêm câu mới; thêm vào thư mục này.
- Trang Quản trị → "Nhập câu hỏi" (JSON) cũng nhận `tier` `main`/`extra` nếu cần nhập nhanh không qua triển khai.
