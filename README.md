# FACTS LAB — Remotion + Gemini v3.1

Tạo kịch bản, 5 ảnh minh họa và giọng đọc tiếng Việt bằng Gemini, sau đó dựng video dọc 9:16 bằng Remotion.

## 1. Cài đặt

```powershell
npm install
Copy-Item .env.example .env
```

Mở `.env`, điền `GEMINI_API_KEY`. Không chia sẻ API key.

## 2. Chạy tạo video

```powershell
npm run generate -- "5 sự thật kỳ lạ về đại dương"
```

Script sẽ tạo:
- `public/assets/video.json`: kịch bản
- `public/assets/scenes/scene-1.png` ... `scene-5.png`: ảnh minh họa
- `public/assets/voiceover.wav`: giọng đọc tiếng Việt

## 3. Xem trước và render

```powershell
npm run dev
```

Trong Remotion Studio chọn composition `FactsVideo`.

```powershell
npm run render
```

Video xuất ra: `out/facts-video.mp4`.

## 4. Tùy chỉnh

Trong `.env`:
- `GEMINI_MODEL`: model viết kịch bản.
- `GEMINI_IMAGE_MODEL`: model tạo ảnh.
- `GEMINI_TTS_MODEL`: model đọc lời thoại.
- `GEMINI_TTS_VOICE`: giọng đọc, mặc định `Kore`.
- `GENERATE_IMAGES=false`: bỏ qua tạo ảnh.
- `GENERATE_VOICE=false`: bỏ qua tạo giọng đọc.

Nếu API báo model không khả dụng, kiểm tra tên model và quyền truy cập của API key trong Google AI Studio.

## Lưu ý chi phí và chất lượng

- Viết kịch bản bằng Gemini Flash-Lite thường có chi phí thấp.
- Tạo ảnh Gemini không có free tier theo bảng giá hiện tại. Model `gemini-3.1-flash-lite-image` có giá tham khảo khoảng **0,0336 USD/ảnh 1K** ở Standard; 5 ảnh khoảng **0,168 USD**. Giá có thể thay đổi theo model, chất lượng và chế độ xử lý.
- TTS có thể tính phí riêng tùy model và hạn mức tài khoản.
- Kịch bản facts do AI tạo vẫn cần kiểm chứng trước khi đăng. Hình ảnh là minh họa, không phải bằng chứng khoa học.
