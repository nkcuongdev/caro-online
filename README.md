# Caro Online

Game **Caro / Gomoku** nhiều người chơi thời gian thực trên bàn cờ 15×15, 20×20 hoặc 30×30 (chủ phòng chọn; mặc định 20×20). Tạo phòng, chia sẻ link và chơi năm quân liên tiếp với bạn bè, không cần tài khoản.

- **Server là nguồn sự thật.** Bàn cờ, lượt đi, đồng hồ, người thắng và trạng thái phòng đều nằm trên server. Client chỉ hiển thị snapshot và gửi yêu cầu (intent).
- **Đồng hồ lượt** (15, 30 hoặc 60 giây, do chủ phòng chọn) được server cưỡng chế. Client hiển thị `deadline − serverNow`, nên can thiệp qua DevTools không có tác dụng, và cả hai người chơi thấy cùng một bộ đếm ngược.
- **Link mời**: `https://your-domain/game/:roomId` tự động cho Người chơi 2 vào phòng. Người thứ ba sẽ trở thành khán giả.
- **Kết nối lại** sau khi tải lại trang, mất mạng, hoặc đóng rồi mở lại tab, với bàn cờ và đồng hồ giữ nguyên. Mất kết nối quá 60 giây sẽ bị xử thua.
- **Đấu lại** trong cùng phòng, đổi bên và giữ nguyên tỉ số.
- Giao diện tươi sáng, trau chuốt: quân cờ có hiệu ứng động, đếm ngược 3-2-1, pháo giấy, hiệu ứng âm thanh tổng hợp, và bố cục responsive cho desktop/tablet/mobile, trên điện thoại có thể kéo và phóng to bàn cờ.

## Công nghệ

| Tầng     | Công nghệ                                                             |
| -------- | --------------------------------------------------------------------- |
| Frontend | React 19, Vite, TypeScript, Tailwind CSS v4, Socket.IO client, React Router |
| Backend  | Node.js, Express 5, Socket.IO 4, Zod (kiểm tra payload)               |
| Kiểm thử | `node:test` (unit + end-to-end qua socket thật)                       |

## Cấu trúc dự án

```
server/
  src/
    game/winChecker.ts      phát hiện năm quân liên tiếp qua nước đi cuối (4 hướng)
    game/gameEngine.ts      luật thuần: createGame, applyMove, finishGame (không I/O, thời gian được inject)
    timer/timerManager.ts   timer một lần theo khóa (hết giờ lượt, bắt đầu, xử thua khi mất kết nối)
    rooms/roomRepository.ts interface lưu trữ + bản cài đặt trong bộ nhớ (có thể thay bằng Redis)
    rooms/roomManager.ts    vòng đời phòng; khóa theo từng phòng; phát domain event
    rooms/serialize.ts      model nội bộ → snapshot công khai (không bao giờ lộ token)
    socket/handlers.ts      chỉ lo tầng truyền tải: validate → xác định ghế → gọi RoomManager → ack
    socket/socketSink.ts    domain event → broadcast Socket.IO
    socket/validation.ts    schema Zod + giới hạn tần suất theo từng socket
    accounts/               tài khoản tùy chọn: kho SQLite, scrypt, JWT, REST route, ghi lại ván đấu
    achievements/           danh sách thành tích (definitions.ts), AchievementManager, đẩy thông báo mở khóa
    rewards/rewardService.ts kiểu phần thưởng (coin, danh hiệu, …) + nơi duy nhất trao thưởng
    titles/                 danh mục danh hiệu (titles.ts), TitleService (bộ sưu tập, trang bị)
    cosmetics/              độ hiếm dùng chung (rarity.ts), hiệu ứng tên (nameStyles.ts, NameStyleService, route)
    app.ts / index.ts       kết nối Express + Socket.IO, các endpoint HTTP
  test/                     test engine + test tích hợp socket
client/
  src/
    pages/LobbyPage.tsx, GamePage.tsx, ProfilePage.tsx (/me)
    components/auth/        hộp thoại đăng nhập / đăng ký, menu tài khoản trên header
    components/profile/     bảng thống kê, lịch sử ván đấu, bàn cờ xem lại
    components/achievements/ trang Thành tích (/me/achievements), thẻ thành tích, popup mở khóa, style theo độ hiếm
    components/titles/      TitleBadge (+ titles.css: độ hiếm, hiệu ứng), nút trang bị, bộ sưu tập (/me/titles)
    components/PlayerName   tên người chơi theo hiệu ứng tên đang dùng (styles/nameStyles.css); components/nameStyles/ (/me/name-styles)
    lib/achievements.ts     kiểu dữ liệu thành tích + hàng đợi popup
    lib/titles.ts           kiểu dữ liệu danh hiệu
    lib/account.ts          kho tài khoản (trạng thái đăng nhập, đồng bộ hồ sơ, gọi API)
    components/GameBoard, Cell, PlayerCard, GameTimer, GameStatus,
               InvitePanel, WaitingRoom, StartCountdown, ResultModal, …
    hooks/useGameRoom.ts    kết nối + xác định ghế + đồng bộ trạng thái
    lib/clock.ts            độ lệch đồng hồ server kiểu NTP
    lib/session.ts          thông tin kết nối lại (sessionStorage + localStorage)
```

## Cách hoạt động

### Server là nguồn sự thật
Mọi thay đổi đều đi qua `RoomManager.withRoom()`. Hàm này tải phòng, lấy **khóa bất đồng bộ theo từng phòng**, áp dụng thay đổi, lưu lại, và chỉ sau đó mới phát event. Việc tuần tự hóa này, cùng với các kiểm tra của engine, xử lý các tình huống race condition:

| Tấn công / race                   | Biện pháp bảo vệ                                             |
| --------------------------------- | ------------------------------------------------------------ |
| Spam click / request song song    | khóa theo phòng + `seq` phải bằng `moves.length` (`STALE_MOVE`) |
| Sai lượt                          | `NOT_YOUR_TURN`                                              |
| Ô đã có quân / ngoài phạm vi      | `CELL_TAKEN` / `INVALID_CELL`                                |
| Đi sau khi hết ván / trước khi bắt đầu | `GAME_NOT_ACTIVE` / `GAME_NOT_STARTED`                  |
| Đi sau khi hết giờ                | `TIME_UP` (xử lý hết giờ ngay lập tức)                       |
| Payload sai định dạng / flood     | schema Zod (`INVALID_PAYLOAD`), giới hạn 25 event/s (`RATE_LIMITED`) |
| Thao tác từ socket khác           | ghế gắn với socket; token là bí mật và không bao giờ được broadcast |

Có một test gửi đồng thời 6 nước đi cho cùng một lượt và kiểm tra rằng chỉ đúng một nước được chấp nhận.

### Đồng hồ
- Server lưu `deadline` của lượt hiện tại và lên lịch hết giờ tại `deadline + 300ms` (thời gian ân hạn cho độ trễ mạng). Timer cũ không thể kích hoạt ở lượt sau, vì nó giữ lại `round` và `seq`.
- Server broadcast `game:timer` mỗi giây như một nhịp tim chính thức.
- Client ước lượng độ lệch đồng hồ với server bằng nhiều lần ping `time:sync` (giữ mẫu có RTT thấp nhất), rồi hiển thị `deadline − serverNow()`. Giá trị này được tính lại chứ không trừ dần, nên tab chạy nền bị bóp tốc độ vẫn đúng ngay khi hiện lại. Client đồng bộ lại khi kết nối lại, khi tab được focus, mỗi 60 giây, và bất cứ khi nào nhịp tim cho thấy độ lệch vượt quá 1,5 giây.

### Kết nối lại
Server cấp cho mỗi người chơi một `token` bí mật. Client thử các ghế theo thứ tự:
1. **Phiên của tab này (sessionStorage).** Dùng sau khi tải lại trang. Client kết nối lại và tiếp quản socket sắp chết.
2. **Các ghế khác đã lưu trong trình duyệt này (localStorage).** Dùng sau khi đóng rồi mở lại tab. Chỉ kết nối lại nếu ghế đó đang offline, nên tab thứ hai trong cùng trình duyệt vẫn có thể vào làm đối thủ.
3. **Nếu không** thì vào phòng như người chơi mới, hoặc làm khán giả nếu cả hai ghế đã có người.

Khi một người chơi offline trong lúc đang chơi, đối thủ sẽ thấy `Offline · forfeits in 42s`. Đồng hồ lượt vẫn tiếp tục chạy.

### Vòng đời phòng
`WAITING` → (2 người chơi, cả hai online) → `PLAYING` (đếm ngược 3-2-1 qua `startAt`) → `FINISHED` → đấu lại (cả hai đồng ý, đổi bên) → `PLAYING` …
Nếu một người chơi rời đi, người còn lại thắng (`left`) và ghế được mở lại cho đối thủ mới qua cùng link mời. Phòng không có ai tương tác trong 15 phút sẽ bị dọn dẹp.

### Chơi với Bot
`room:createBot` mở một phòng riêng, trong đó ghế thứ hai là bot chạy trên server (`Player.isBot`). Bot đi qua đúng đường `applyMove` như người chơi, nên luật năm quân liên tiếp, đồng hồ lượt, kết quả và đấu lại đều hoạt động giống hệt. Mọi cấp độ trước tiên đều hoàn thành năm quân của mình, sau đó chặn năm quân của bạn. Sau đó:
- **Dễ (Easy)** chủ yếu chọn ngẫu nhiên một ô cạnh các quân đã có trên bàn.
- **Trung bình (Medium)** áp dụng luật đe dọa: tạo bốn mở hoặc đe dọa kép, chặn ba mở và đe dọa kép của bạn, xây bốn và ba của riêng mình, còn lại thì chọn nước có điểm vị trí tốt nhất.
- **Khó (Hard)** chạy tìm kiếm negamax alpha-beta với iterative deepening, giới hạn trong 200 ms và 9–14 ô ứng viên tốt nhất. Thường đạt độ sâu 6–9 nước.

Phần AI nằm ở `server/src/bot/`: `evaluate.ts` chứa cách chấm điểm cửa sổ 5 ô tăng dần và `evaluateBoard`, `candidates.ts` chứa `generateCandidateMoves` (chỉ các ô trống gần quân cờ), `search.ts` chứa alpha-beta, và `botEngine.ts` chứa `chooseBotMove`. Bot chờ 300–800 ms trước khi đi (`botMinDelayMs`/`botMaxDelayMs`), và thời gian chờ này đã bao gồm thời gian tính toán. Phòng bot không tính xếp hạng (`mode: 'bot'` trong snapshot và trong `game:finished`). Bot luôn đồng ý đấu lại, và phòng đóng khi người chơi rời đi.

### Avatar khách
Khách không có tài khoản, nên avatar được lưu trong trình duyệt. `localStorage['caro:avatar']` chứa **một chuỗi, không bao giờ là dữ liệu ảnh**:

| Giá trị | Ảnh nằm ở đâu |
| ------- | ------------- |
| `preset:<id>` | đóng gói cùng client, `client/public/avatars/<id>.webp` (12 mẫu có sẵn: owl, ghost, robot, bear, tiger, frog, penguin, bunny, fox, panda, dragon, cat) |
| `/api/avatars/files/<id>.<ext>` | đã tải lên, trên ổ đĩa của game server (phân giải theo `VITE_API_URL`) |
| `https://res.cloudinary.com/…` | đã tải lên, trên Cloudinary |

- **Lần đầu truy cập**: chọn ngẫu nhiên một mẫu có sẵn (không bao giờ là `robot`, để khách mới không trông giống bot) và lưu ngay, nên tải lại trang vẫn giữ nguyên.
- **Thay đổi**: từ sảnh, màn hình lời mời, hoặc thẻ người chơi của chính bạn trong ván đấu. Bộ chọn cho phép chọn mẫu có sẵn hoặc tải ảnh lên. Ảnh tải lên (JPG/PNG/WebP, tối đa 8 MB) được cắt ngay trên trình duyệt thành hình vuông 256×256 (kéo, lăn chuột/chụm ngón tay hoặc thanh trượt để phóng to, có xem trước ở 64 px và 40 px), mã hóa sang WebP, rồi gửi tới `POST /api/avatars`.
- **Kiểm tra phía server**: loại ảnh được đọc từ nội dung byte, không phải từ header. File vượt quá `AVATAR_MAX_KB` hoặc ảnh lớn hơn 2048×2048 sẽ bị từ chối, và số lần tải lên bị giới hạn theo IP. Người chơi chỉ có thể đặt mẫu có sẵn hoặc URL do chính kho lưu trữ của server này tạo ra, nên không ai có thể khiến trình duyệt của đối thủ tải một URL bên thứ ba tùy ý.
- **Thời gian thực**: `player:avatar` cập nhật ghế và broadcast `room:state`, nên đối thủ và khán giả thấy thay đổi ngay lập tức. Nó không bao giờ động đến bàn cờ, lượt đi hay đồng hồ. `room:create` / `room:createBot` / `room:join` / `player:reconnect` cũng mang theo avatar hiện tại.
- **Hiển thị ở đâu**: thẻ người chơi, chat, màn hình kết quả và màn hình lời mời (avatar chủ phòng). Bot nhận robot được tô màu lại theo cấp độ: `preset:bot-easy` (xanh lá), `preset:bot-medium` (tím), `preset:bot-hard` (đỏ). Chỉ server mới cấp các avatar này, nên người chơi không thể giả làm bot. Robot `robot` màu xanh dương gốc vẫn dành cho người chơi.
- **Dự phòng**: avatar bị thiếu, bị từ chối hoặc bị lỗi sẽ chuyển sang một mẫu có sẵn suy ra từ id người chơi (giống nhau trên mọi màn hình), sau đó là chữ cái viết tắt.
- **Lưu trữ**: khi đặt `CLOUDINARY_URL` (hoặc `CLOUDINARY_CLOUD_NAME` + `CLOUDINARY_API_KEY` + `CLOUDINARY_API_SECRET`), ảnh tải lên dùng API signed upload của Cloudinary. Nếu không, ảnh được lưu vào `AVATAR_UPLOAD_DIR` trên ổ đĩa. Ổ đĩa trên Railway và Render bị xóa sau mỗi lần redeploy, nên hãy cấu hình Cloudinary trên production. Ảnh cũ không bao giờ bị xóa.

### Tài khoản (tùy chọn)
Khách vẫn chơi như trước: không màn hình nào bắt buộc phải có tài khoản. Đăng nhập sẽ có thêm hồ sơ lưu trên server, toàn bộ lịch sử ván đấu (kèm xem lại từng nước) và thống kê cá nhân.

- **Đăng ký / đăng nhập** bằng email + mật khẩu (`/api/auth/*`). Mật khẩu được băm bằng **scrypt** (N=2¹⁵, r=8, p=3, tương đương khuyến nghị OWASP, chạy trên thread pool của libuv để đồng hồ game không bao giờ bị treo), với salt riêng cho từng người dùng và phép kiểm tra cân bằng thời gian cho email không tồn tại. Số lần đăng nhập bị giới hạn theo IP, và nhập sai mật khẩu liên tục sẽ tạm khóa email đó trong 15 phút.
- **Token**: một **JWT** HS256 gắn với một dòng trong bảng `sessions`, gửi dưới dạng `Authorization: Bearer …` (không dùng cookie: trên production frontend và server nằm ở hai site khác nhau). Đăng xuất sẽ xóa dòng đó, nên token mất hiệu lực ngay lập tức. `JWT_SECRET` dùng để ký token; nếu không đặt, một khóa ngẫu nhiên sẽ được tạo một lần và lưu trong cơ sở dữ liệu.
- **Lưu trữ**: một file SQLite (`DATABASE_PATH`, mặc định `server/data/caro.db`) thông qua module có sẵn `node:sqlite` của Node (Node ≥ 22.13, không cần native addon). Phòng và timer vẫn nằm trong bộ nhớ; chỉ hồ sơ, phiên đăng nhập và ván đấu đã kết thúc mới được ghi xuống.
- **Danh tính thời gian thực**: socket gửi token trong handshake, và `auth:identify` chuyển đổi danh tính ngay tại chỗ, nên đăng nhập hay đăng xuất giữa ván vẫn giữ nguyên ghế, bàn cờ và đồng hồ. `userId` của ghế không bao giờ rời khỏi server; snapshot chỉ mang `registered: true` (một huy hiệu trên thẻ người chơi).
- **Lịch sử**: `MatchRecorder` lắng nghe `RoomManager.onRoomFinished` và lưu mọi ván đã kết thúc (pvp, bot, giải đấu) cho từng người chơi đã đăng nhập: kết quả, lý do, đối thủ, kích thước bàn cờ, các nước đi, thời lượng, vòng đấu giải. Một tài khoản ngồi cả hai ghế sẽ không được ghi lại.
- **Khách → tài khoản**: các ván đã kết thúc của khách được giữ trong bộ nhớ trong 6 giờ, theo khóa là token ghế bí mật của họ. Khi đăng ký/đăng nhập, client gửi token của các ghế đã chơi (`localStorage['caro:played']`), và những ván đó được chuyển vào tài khoản. Form đăng ký được điền sẵn biệt danh và avatar của khách; đăng nhập vào tài khoản có giao diện khác sẽ hỏi bạn muốn giữ cái nào.
- **Thống kê** (`/me`): số ván, thắng, thua, hòa và tỉ lệ thắng (tổng và theo từng chế độ), chuỗi thắng hiện tại và tốt nhất, danh hiệu giải đấu, số bot đã đánh bại theo cấp độ, ván thắng nhanh nhất, thời gian chơi, bàn cờ yêu thích, phong độ 10 ván gần nhất, và XP/cấp độ cho vui (thắng 30, hòa 15, thua 10; ván với bot tính một nửa).

### Thành tích
Chỉ dành cho tài khoản. Luồng: ván kết thúc → `MatchRecorder` ghi vào `matches` → `AchievementManager` tính lại thống kê từ lịch sử → mở khóa những thành tích vừa đạt → cộng coin → đẩy `achievement:unlocked` tới mọi socket của tài khoản → client hiện popup (lần lượt từng cái).

- **Thống kê là dữ liệu dẫn xuất** từ bảng `matches` (không có bảng thống kê riêng). Một ván không thể được tính hai lần (`UNIQUE` + `INSERT OR IGNORE`), và người chơi cũ được **backfill** tự động từ lịch sử ở lần kiểm tra đầu tiên (khi mở trang, đăng nhập, hoặc sau ván tiếp theo).
- **Data-driven**: thêm thành tích = thêm một dòng vào `server/src/achievements/definitions.ts` (`stat` + `target`, `comparison: 'lte'` cho chỉ số càng nhỏ càng tốt, hoặc `custom` cho điều kiện phức tạp). Không bao giờ đổi hay tái sử dụng `id`.
- **Mở khóa và thưởng chỉ một lần**: khóa chính `(user_id, achievement_id)`, coin được cộng trong cùng transaction chỉ cho những dòng vừa được chèn. Không có endpoint nào cho client tự mở khóa.
- **Thành tích ẩn** (`hidden`): khi chưa mở khóa, API trả về `???` / `Thành tích bí mật`, không có điều kiện, phần thưởng hay tiến độ.
- **Phần thưởng**: mỗi thành tích có `rewards: Reward[]` (`coins(n)`, `title(id)`, …). Mọi phần thưởng đi qua `RewardService` (`server/src/rewards/rewardService.ts`), chạy trong cùng transaction với việc mở khóa. Thêm một loại phần thưởng mới = thêm một thành viên vào union `Reward` + một nhánh trong `RewardService.grant`.
- Chuỗi thắng dùng cùng quy tắc với trang hồ sơ: thua **hoặc hòa** đều kết thúc chuỗi.

### Danh hiệu
Vật phẩm trang trí hiện cạnh tên người chơi, không ảnh hưởng lối chơi. **Danh hiệu không tự kiểm tra điều kiện**: điều kiện thuộc về thành tích, danh hiệu chỉ là một loại phần thưởng. Luồng: ván kết thúc → thống kê → `AchievementManager` → thành tích hoàn thành → `RewardService` → `reward.type === 'title'` → ghi vào `user_titles` → người chơi trang bị ở `/me/titles`.

- **Danh mục**: `server/src/titles/titles.ts` (tên, mô tả, icon, độ hiếm `common | rare | epic | legendary | secret`, hiệu ứng `none | glow | gradient | shimmer | fire | lightning | shield | glitch`). Client không liệt kê danh hiệu theo id: dữ liệu hiển thị đi kèm API / snapshot.
- **Sở hữu** lưu riêng (`user_titles`, khóa chính `(user_id, title_id)` → không thể trùng) kèm `source_type`/`source_id`, để sau này danh hiệu có thể đến từ sự kiện, mùa giải, quà tặng… chứ không chỉ từ thành tích. `users.equipped_title_id` là danh hiệu đang dùng (mặc định `NULL`).
- **Backfill**: người đã hoàn thành thành tích trước khi có danh hiệu sẽ được trao danh hiệu tương ứng ở lần kiểm tra thành tích kế tiếp (đăng nhập, mở hồ sơ, sau ván đấu). Idempotent và không trả lại coin; client hiện popup "Danh hiệu mới".
- **Trang bị**: `PATCH /api/me/title` kiểm tra id có trong danh mục và kiểm tra quyền sở hữu ngay trong câu `UPDATE`. Không có endpoint nào để client tự mở khóa danh hiệu.
- **Realtime**: ghế trong phòng mang danh hiệu của tài khoản (`PublicPlayer.title`). Đổi danh hiệu thì mọi phòng người đó đang ngồi nhận `room:state` mới, và các tab khác của tài khoản nhận `title:equipped`.
- **Danh hiệu bí mật**: khi chưa sở hữu, API trả `title: null` (không tên, icon, mô tả, id hay thành tích nguồn).
- **UI**: `TitleBadge` là component duy nhất vẽ danh hiệu (độ hiếm, hiệu ứng CSS, cắt chữ, `prefers-reduced-motion`). Trong danh sách dài chỉ danh hiệu đang dùng tự chuyển động, các danh hiệu khác chỉ chuyển động khi hover.

### Hiệu ứng tên
Vật phẩm trang trí đổi màu / hiệu ứng của tên người chơi, không ảnh hưởng lối chơi. Ba tầng tách biệt: **tồn tại** (danh mục) → **sở hữu** (mua bằng coin hoặc nhận từ thành tích) → **đang dùng** (một style một lúc). Khách luôn dùng `default`.

- **Danh mục**: `server/src/cosmetics/nameStyles.ts` là nơi duy nhất chứa tên, độ hiếm (thang dùng chung `common | rare | epic | legendary | secret`, `cosmetics/rarity.ts`), kiểu, cách mở khóa (`default | coin | achievement | event | secret`) và giá. Chỉ lưu và gửi **id**; client ánh xạ id → class CSS (`client/src/lib/nameStyles.ts`), không bao giờ nhận hay lưu CSS. Id lạ / đã xóa / không sở hữu → `default`.
- **Lưu trữ** (migration 4): `users.name_style_id` (`NULL` = `default`, nên tài khoản cũ không cần đổi gì) và kho vật phẩm chung `user_cosmetics (user_id, kind, item_id, …)` với `kind = 'name_style'`. Id đang dùng chỉ được tin khi có dòng sở hữu tương ứng.
- **Mua**: `POST /api/me/name-styles/:id/buy`. Giá lấy từ danh mục; một transaction kiểm tra đã sở hữu, trừ coin bằng `UPDATE … WHERE coins >= price` và thêm quyền sở hữu, nên không thể mua hai lần hay âm coin. Style thành tích / bí mật không bán. Có giới hạn tần suất theo tài khoản.
- **Thành tích**: phần thưởng khai báo trong `definitions.ts` (`rewards: [..., nameStyle('galaxy')]`), `RewardService` cấp trong cùng transaction với việc mở khóa, idempotent; người đã hoàn thành trước đó được backfill một lần, không trả lại coin.
- **Trang bị**: `POST /api/me/name-styles/:id/equip` kiểm tra id, sở hữu và lý do bị khóa. Lỗi: `STYLE_NOT_FOUND` (404), `STYLE_NOT_OWNED` / `STYLE_LOCKED` / `ACHIEVEMENT_REQUIRED` (403), `ALREADY_OWNED` (409), `NOT_ENOUGH_COIN` (402), `INVALID_STYLE` (400).
- **Realtime**: `PublicPlayer.nameStyle` / `PublicParticipant.nameStyle`. Đổi style thì mọi phòng người đó đang ngồi nhận `room:state`, giải đấu nhận `tournament:state`, các tab khác của tài khoản nhận `account:updated`. Đăng nhập / đăng xuất giữa chừng cũng cập nhật ghế.
- **Bí mật**: khi chưa sở hữu, API trả `???`, không tên, mô tả, giá hay thành tích mở khóa.
- **UI**: `<PlayerName name nameStyle />` là component duy nhất áp dụng hiệu ứng tên. Hiệu ứng chỉ dùng CSS (màu, gradient `background-clip: text`, `text-shadow`, `background-position`), không đổi kích thước chữ, không timer/canvas cho từng tên; `prefers-reduced-motion` tắt chuyển động và giữ màu tĩnh.

## Socket event

**Client → Server** (tất cả đều có ack `{ ok: true, … } | { ok: false, error, message }`)

| Event              | Payload                              |
| ------------------ | ------------------------------------ |
| `room:create`      | `{ name?, boardSize?, turnSeconds? }` → `{ roomId, playerId, token, state }`. `boardSize` là 15, 20 hoặc 30 (mặc định 20) và `turnSeconds` là 15, 30 hoặc 60 (mặc định `TURN_SECONDS`). Cả hai cố định cho phòng và được trả lại trong `state.config` (`boardSize`, `turnMs`) và `GET /api/rooms/:id`. `room:createBot` cũng nhận hai tham số này. |
| `room:join`        | `{ roomId, name? }` → `{ role, playerId?, token?, state }` |
| `player:reconnect` | `{ roomId, token, takeover? }` → `{ playerId, token, state }` |
| `game:move`        | `{ roomId, index, seq }`             |
| `game:resign`      | `{ roomId }`                         |
| `game:rematch`     | `{ roomId, accept }`                 |
| `room:leave`       | `{ roomId }`                         |
| `player:rename`    | `{ roomId, name }`                   |
| `player:avatar`    | `{ roomId, avatar }` → `{ avatar }`  |
| `time:sync`        | `{ t0 }` → `{ serverNow }`           |
| `auth:identify`    | `{ token \| null }` → `{ signedIn }` (đăng nhập/đăng xuất socket; ghế hiện tại đi theo) |

**Server → Client**: `room:state` (snapshot đầy đủ với `version` tăng đơn điệu), `player:joined`, `game:started`, `game:move`, `game:turn`, `game:timer`, `game:finished`, `player:disconnected`, `player:reconnected`, `session:replaced`, `room:closed`, `achievement:unlocked` `{ achievements, restoredTitles, coins }` (chỉ gửi tới socket của tài khoản vừa mở khóa, sau `game:finished`; mỗi thành tích kèm `rewards`), `title:equipped` `{ titleId, title }` (tới các socket của tài khoản vừa đổi danh hiệu), `account:updated` `{ coins?, nameStyle? }` (tới các socket của tài khoản vừa mua / trang bị hiệu ứng tên).

HTTP: `GET /health`, `GET /api/stats`, `GET /api/rooms/:roomId`, `POST /api/avatars` (body là ảnh thô → `{ ok, avatar }`), `GET /api/avatars/files/:file` (chỉ khi lưu trữ cục bộ).

Tài khoản (JSON, `Authorization: Bearer <token>`): `POST /api/auth/register` `{ email, password, nickname?, avatar?, guestTokens? }`, `POST /api/auth/login` `{ email, password, guestTokens? }`, `POST /api/auth/logout`, `GET /api/me` (hồ sơ + thống kê), `PATCH /api/me` `{ nickname?, avatar? }`, `POST /api/me/claim` `{ guestTokens }`, `GET /api/me/stats`, `GET /api/me/matches?limit&before&mode`, `GET /api/me/matches/:id` (kèm các nước đi), `GET /api/me/achievements` (mọi thành tích kèm `current`/`target`/`percentage`/`unlocked`/`unlockedAt`, tổng kết, số coin). Đăng nhập/đăng ký/claim trả thêm `achievements`, và `GET /api/me` trả thêm `newAchievements`: những thành tích vừa được mở khóa bởi chính request đó (cùng `restoredTitles` cho danh hiệu được backfill). Danh hiệu: `GET /api/titles` (danh mục công khai, danh hiệu bí mật bị ẩn), `GET /api/me/titles` (mọi danh hiệu kèm `owned`/`equipped`/`unlockedAt`/thành tích nguồn), `PATCH /api/me/title` `{ titleId | null }` (trang bị / tháo; `404 TITLE_NOT_FOUND`, `403 TITLE_LOCKED`). Hiệu ứng tên: `GET /api/name-styles` (danh mục công khai, style bí mật bị ẩn), `GET /api/me/name-styles` (mọi style kèm `owned`/`equipped`/giá/thành tích nguồn, style đang dùng, coin), `POST /api/me/name-styles/:id/buy` → `{ style, coins }`, `POST /api/me/name-styles/:id/equip` → `{ equipped }`. `GET /api/rooms/:roomId` và `GET /api/tournaments/:id` trả thêm `hostNameStyle`.

## Phát triển cục bộ

```bash
npm install            # thư mục gốc (concurrently)
npm run install:all    # cài dependency cho server + client
npm run dev            # server ở :4000, client ở :5173
```

Mở http://localhost:5173. Trong môi trường phát triển, Vite proxy `/socket.io` và `/api` tới server, nên không cần biến môi trường, và điện thoại cùng mạng LAN có thể vào chơi qua IP của máy bạn.
Để tự chơi với chính mình, mở link mời trong tab thứ hai, cửa sổ ẩn danh, hoặc một trình duyệt khác.

```bash
npm test               # test server (luật chơi, luồng thời gian thực, tài khoản)
npm run typecheck
npm run build
```

## Triển khai

Server Socket.IO cần một tiến trình chạy lâu dài, nên không dùng socket serverless. Cách khuyến nghị là đưa **cả hai lên Render** bằng Blueprint `render.yaml`, gồm hai service riêng. Deploy lại frontend không restart server, nên các ván đang chơi không bị mất.

| Service | Loại | Ghi chú |
| ------- | ---- | ------- |
| `caro-online-server` | Web Service Node, region Singapore, gói **Free** (demo) | Ngủ sau ~15 phút không có truy cập. Mỗi lần ngủ hoặc deploy sẽ mất các phòng đang chơi **và cả tài khoản, lịch sử (SQLite)**. Khi có người chơi thật, chuyển sang gói Starter và gắn ổ đĩa tại `/var/data` (hướng dẫn nằm trong phần chú thích của `render.yaml`). |
| `caro-online` | Static Site | Miễn phí, chạy qua CDN, không ngủ. Có sẵn rewrite SPA cho `/game/:roomId` và `/t/:id`. |

### Triển khai lên Render
1. Đẩy repo lên GitHub. Không commit `server/.env`.
2. Render → **New → Blueprint** → chọn repo. Render đọc `render.yaml` và hỏi các biến bí mật (`sync: false`):

   | Biến | Service | Giá trị |
   | ---- | ------- | ------- |
   | `CLOUDINARY_URL` | server | giống trong `server/.env`. Để trống thì avatar lưu trên ổ đĩa |
   | `TURN_USERNAME` / `TURN_CREDENTIAL` | server | username / password trong trang **TURN Server** của Metered, dùng cho voice chat. Để trống thì voice chỉ dùng STUN |
   | `VITE_SOCKET_URL` | static site | URL công khai của `caro-online-server`, ví dụ `https://caro-online-server.onrender.com` |

   `JWT_SECRET` được Render tự sinh. Các biến còn lại đã được điền sẵn giá trị mặc định (xem bảng bên dưới).
3. Sau lần deploy đầu, mở trang của từng service để lấy URL thật (Render thêm hậu tố nếu tên đã có người dùng):
   - Nếu URL backend khác với giá trị đã nhập, sửa `VITE_SOCKET_URL` rồi **Manual Deploy** lại static site (Vite nhúng biến lúc build).
   - Thay `CLIENT_ORIGIN` (mặc định `https://caro-online*.onrender.com`) bằng URL chính xác của frontend hoặc tên miền riêng.
4. Kiểm tra `https://<backend>/health` trả về `{"status":"ok"}`.

Khi dùng tên miền riêng, hãy thêm nó vào `CLIENT_ORIGIN` và đặt `VITE_PUBLIC_URL` cho static site để link mời dùng tên miền đó.

### Phương án khác: Railway cho backend
`server/railway.json` đã định nghĩa sẵn lệnh build, start, health check và `numReplicas: 1`. Đặt **Root Directory** là `server`, thêm một **Volume** tại `/data` với `DATABASE_PATH=/data/caro.db`, rồi đặt các biến như bảng bên dưới.

### Phương án khác: Vercel cho frontend
1. Import repo → đặt **Root Directory** là `client` (Vite được tự động nhận diện; `client/vercel.json` thêm rewrite cho SPA để deep link `/game/:roomId` hoạt động).
2. Biến môi trường:

| Biến              | Ví dụ                                    | Ghi chú                                |
| ----------------- | ---------------------------------------- | -------------------------------------- |
| `VITE_SOCKET_URL` | `https://caro-server.up.railway.app`     | bắt buộc trên production               |
| `VITE_API_URL`    | *(tùy chọn)*                             | mặc định là `VITE_SOCKET_URL`          |
| `VITE_PUBLIC_URL` | *(tùy chọn)* `https://caro.example.com`  | origin dùng trong link mời             |

3. Redeploy sau khi thay đổi biến môi trường (Vite nhúng chúng vào lúc build).

### Biến môi trường của server

| Biến                         | Mặc định                 |
| ---------------------------- | ------------------------ |
| `PORT`                       | `4000` (do nền tảng đặt) |
| `CLIENT_ORIGIN`              | `http://localhost:5173`  |
| `TURN_SECONDS`               | `30` (cho phòng tạo mà không có `turnSeconds`) |
| `START_COUNTDOWN_SECONDS`    | `3`                      |
| `DISCONNECT_FORFEIT_SECONDS` | `60`                     |
| `MOVE_GRACE_MS`              | `300`                    |
| `ROOM_IDLE_MINUTES`          | `15`                     |
| `CLOUDINARY_URL`             | *(không đặt: ổ đĩa cục bộ)* `cloudinary://<key>:<secret>@<cloud>` |
| `CLOUDINARY_FOLDER`          | `caro/avatars`           |
| `AVATAR_UPLOAD_DIR`          | `uploads/avatars`        |
| `AVATAR_MAX_KB`              | `1024`                   |
| `AVATAR_UPLOADS_PER_10_MIN`  | `10` (theo IP)           |
| `DATABASE_PATH`              | `data/caro.db` (tài khoản, phiên đăng nhập, lịch sử ván đấu; đặt trên volume lưu trữ bền vững) |
| `JWT_SECRET`                 | *(không đặt: tạo một lần, lưu trong cơ sở dữ liệu)* chuỗi ngẫu nhiên dài |
| `AUTH_SESSION_DAYS`          | `30`                     |
| `AUTH_ATTEMPTS_PER_10_MIN`   | `20` (đăng nhập/đăng ký theo IP) |
| `TURN_USERNAME` / `TURN_CREDENTIAL` | *(không đặt: voice chỉ dùng STUN)* tài khoản TURN cố định, ví dụ từ dashboard Metered |
| `TURN_URLS`                  | relay của Metered (`global.relay.metered.ca`), danh sách cách nhau bằng dấu phẩy |
| `METERED_DOMAIN` / `METERED_SECRET_KEY` | *(ưu tiên hơn TURN_USERNAME)* tạo thông tin TURN có hạn dùng qua API Metered |
| `METERED_CREDENTIAL_HOURS`   | `6`                      |
| `TOURNAMENT_READY_SECONDS`   | `30` (thời gian xác nhận sẵn sàng trước trận) |
| `TOURNAMENT_START_DELAY_SECONDS` | `5`                  |
| `TOURNAMENT_NEXT_GAME_SECONDS` | `6`                    |
| `TOURNAMENT_IDLE_MINUTES`    | `30`                     |

Máy chủ TURN chỉ được gửi cho người chơi đang ngồi trong phòng qua sự kiện socket `voice:ice`, không nằm trong code frontend. Không cấu hình gì thì voice vẫn chạy bằng STUN công cộng nhưng có thể không kết nối được giữa một số mạng (4G, Wi-Fi công ty).

## Mở rộng ra nhiều instance

Phòng và timer nằm trong bộ nhớ, nên hãy chạy **một instance duy nhất**. `railway.json` cố định `numReplicas: 1`. Khởi động lại server sẽ xóa các phòng đang hoạt động. Để mở rộng:
1. Cài đặt `RoomRepository` bằng Redis (serialize `Room` sang JSON). `RoomManager` đã làm việc qua interface bất đồng bộ.
2. Thay khóa trong tiến trình bằng khóa Redis (ví dụ Redlock) theo từng phòng.
3. Thay `TimerManager` bằng bộ lập lịch phân tán (delayed job của BullMQ). Interface của nó chỉ gồm `schedule` / `clear` / `clearPrefix`.
4. Thêm `@socket.io/redis-adapter` để broadcast đến được socket trên mọi instance.

Tài khoản dùng một file SQLite, điều này cũng giả định chỉ có một instance. Để mở rộng, hãy cài đặt các phương thức của `AccountStore` trên Postgres (cùng các bảng) và lưu cache khách của `MatchRecorder` trong Redis.
