<div align="center">

# ⭕❌ Caro Online

**Caro / Gomoku thời gian thực: tạo phòng, gửi link, đánh ngay. Không cần tài khoản.**

[![Chơi ngay](https://img.shields.io/badge/▶_Chơi_ngay-caro--online-ff4f81?style=for-the-badge)](https://caro-online-phju.onrender.com)

![React](https://img.shields.io/badge/React_19-20232a?logo=react&logoColor=61dafb)
![TypeScript](https://img.shields.io/badge/TypeScript-3178c6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646cff?logo=vite&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind_v4-06b6d4?logo=tailwindcss&logoColor=white)
![Socket.IO](https://img.shields.io/badge/Socket.IO_4-010101?logo=socketdotio&logoColor=white)
![Node](https://img.shields.io/badge/Node_≥22.13-339933?logo=nodedotjs&logoColor=white)
![Render](https://img.shields.io/badge/Deploy-Render-46e3b7?logo=render&logoColor=black)

</div>

---

## ✨ Tính năng

| | |
| --- | --- |
| 🎯 **Chơi với bạn bè** | Bàn 15×15 / 20×20 / 30×30, năm quân liên tiếp là thắng. Link `/game/:roomId` đưa bạn bè vào thẳng phòng, người thứ ba vào xem. |
| 🤖 **Đấu Bot** | 3 cấp độ: **Dễ** (ngẫu nhiên có chủ đích), **Trung bình** (luật đe dọa), **Khó** (alpha-beta, sâu 6–9 nước trong 200 ms). |
| 🏆 **Giải đấu** | Loại trực tiếp, nhánh đấu do server quản lý, xác nhận sẵn sàng trước mỗi trận. |
| ⏱️ **Đồng hồ chống gian lận** | 15 / 30 / 60 giây mỗi lượt, server cưỡng chế. Chỉnh DevTools không có tác dụng. |
| 🔌 **Kết nối lại** | Tải lại trang, rớt mạng hay đóng tab vẫn giữ nguyên bàn cờ và đồng hồ. Mất kết nối quá 60 giây thì xử thua. |
| 💬 **Giao lưu** | Chat, sticker, reaction, cổ vũ từ khán đài và **voice chat** (WebRTC + TURN). |
| 👤 **Tài khoản (tùy chọn)** | Lịch sử ván đấu có xem lại từng nước, thống kê, XP. Ván đã chơi lúc làm khách được chuyển sang tài khoản khi đăng ký. |
| 🎖️ **Sưu tầm** | Thành tích, coin, danh hiệu, hiệu ứng tên, khung avatar và avatar tự tải lên. |
| 📱 **Mọi màn hình** | Hiệu ứng quân cờ, đếm ngược 3-2-1, pháo giấy, âm thanh. Trên điện thoại có thể kéo và phóng to bàn cờ. |

## 🧠 Điểm kỹ thuật

- **Server là nguồn sự thật.** Client chỉ gửi yêu cầu và hiển thị snapshot. Mọi thay đổi đi qua khóa theo từng phòng, nên spam click hay gửi nhiều nước cùng lúc chỉ có đúng một nước được nhận (`seq`, `NOT_YOUR_TURN`, `CELL_TAKEN`, …).
- **Đồng hồ đồng bộ kiểu NTP.** Client ước lượng độ lệch với server rồi hiển thị `deadline − serverNow`, nên hai người luôn thấy cùng một bộ đếm.
- **Payload được kiểm tra** bằng Zod, giới hạn 25 event/giây mỗi socket. Token ghế không bao giờ được broadcast.
- **Bảo mật tài khoản:** mật khẩu băm bằng scrypt, dùng JWT gắn với session trong SQLite (Turso trên production, file cục bộ khi dev, qua `@libsql/client`), giới hạn số lần đăng nhập theo IP.

## 🚀 Chạy trên máy

```bash
npm install && npm run install:all
npm run dev          # server :4000 · client :5173
```

Mở **http://localhost:5173**. Muốn tự đấu với chính mình thì mở link mời trong tab ẩn danh.

```bash
npm test             # unit + end-to-end qua socket thật
npm run typecheck
npm run build
```

## 🗂️ Cấu trúc

```
server/src/
  game/        luật chơi thuần, dò năm quân liên tiếp
  rooms/       vòng đời phòng, khóa theo phòng, snapshot công khai
  bot/         đánh giá thế cờ, sinh nước ứng viên, alpha-beta
  tournament/  giải đấu loại trực tiếp
  comms/       chat, sticker, reaction, khán đài, voice (ICE/TURN)
  accounts/    SQLite/Turso (libSQL), scrypt, JWT, REST, ghi lại ván đấu
  achievements/ rewards/ titles/ cosmetics/   thành tích và vật phẩm
  socket/      validate, xác định ghế, broadcast
client/src/
  pages/       Lobby · Game · Tournament · Profile
  components/  bàn cờ, thẻ người chơi, comms, hồ sơ, thành tích…
  hooks/ lib/  kết nối phòng, đồng bộ đồng hồ, phiên kết nối lại
```

## ☁️ Triển khai

Toàn bộ app chạy trên **Render** bằng Blueprint [`render.yaml`](render.yaml), gồm hai service:

| Service | Loại | URL |
| --- | --- | --- |
| `caro-online` | Static Site (CDN, không ngủ) | https://caro-online-phju.onrender.com |
| `caro-online-server` | Node Web Service, Singapore | https://caro-online-server-hvev.onrender.com/health |

Mỗi lần push lên `main`, Render tự deploy lại. Khi tạo mới: **New → Blueprint** → chọn repo, rồi điền `DATABASE_URL` / `DATABASE_AUTH_TOKEN` (Turso), `CLOUDINARY_URL` (avatar) và `TURN_USERNAME` / `TURN_CREDENTIAL` (voice). Các biến còn lại đã có giá trị mặc định trong `render.yaml`.

**Cơ sở dữ liệu:** tài khoản, lịch sử, thành tích và vật phẩm nằm trên [Turso](https://turso.tech) (SQLite trên cloud, gói miễn phí). Server tự tạo bảng ở lần chạy đầu. Khi dev, bỏ trống `DATABASE_URL` thì server dùng file `server/data/caro.db`.

> [!WARNING]
> Gói **Free** ngủ sau ~15 phút không có truy cập, và mỗi lần ngủ hoặc deploy sẽ xóa các **phòng đang chơi** (dữ liệu tài khoản trên Turso thì không mất).

Phòng và timer nằm trong bộ nhớ nên server chạy **một instance**. Muốn mở rộng thì thay `RoomRepository` bằng Redis, dùng khóa phân tán, BullMQ cho timer và `@socket.io/redis-adapter`.

<div align="center">
<sub>Made with ❤️ và rất nhiều nước đi chặn bốn.</sub>
</div>
