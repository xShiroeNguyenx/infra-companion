# F70 — Nhân vật VRM: sổ tay chỉnh sửa

Tài liệu này để **quay lại chỉnh nhanh**, không phải để học lại từ đầu. Mỗi mục nói: muốn đổi cái
gì thì sửa ở đâu, con số hiện tại là bao nhiêu, và **vì sao nó là con số đó** — phần cuối quan
trọng nhất, vì gần như mọi con số ở đây đều là kết quả đo, không phải chọn cho đẹp.

Quy ước: đường dẫn tương đối từ gốc repo. "Đo được" nghĩa là có script đo thật trên model thật,
không phải ước lượng.

### Muốn sửa gì thì đọc mục nào

| Việc | Mục |
|---|---|
| Đổi tư thế, chuyển động tự sinh của nhân vật | **2**, 3, 4 |
| Sửa bất cứ thứ gì **bám cạnh** nhân vật (cột, bảng, lề, né dock) | **11** ← đọc trước, đây là chỗ sai nhiều nhất |
| Thêm/sửa mục trong bảng cài đặt | **12** |
| Clip `.vrma` — thêm clip, đổi nguồn tải, gán vai trò | 10.3, **13** |
| Thêm trường cấu hình / IPC mới | **9** |
| Nhân vật ngoài desktop (app ở khay) — vòng đời cửa sổ overlay | **7.3** ← đã hỏng một lần, im lặng |
| Trạng thái CÓ KHUNG (chưa có model, đang nạp, lỗi) | **7.6** ← khung không cuộn, phải luôn có ✕ |
| Đo lại sau khi sửa | **8** |
| Trước khi đưa file model/clip nào vào repo | **10** ← giấy phép |
| "Sao cái này lại thế?" | **14** (bảng lỗi đã sửa) |

---

## 1. Bản đồ file

| File | Chứa gì |
|---|---|
| `packages/shared/src/vrmArmPose.ts` | **Toàn bộ số liệu tư thế tay** + IK + 3 mô phỏng vật lý. Hàm thuần, có test. |
| `packages/shared/src/vrmIdle.ts` | Tầng ưu tiên, nhịp chớp mắt/liếc/cử chỉ, phản ứng khi click, vòng tự xoay. |
| `packages/shared/src/vrmChat.ts` | Chat AI trên đầu nhân vật, nhận lệnh "mở tunnel…", câu gợi ý thao tác. |
| `packages/shared/src/vrmOutfit.ts` | Bộ trang phục user tự lưu. |
| `packages/shared/src/vrmFraming.ts` | Căn khung hình, biểu cảm theo sự kiện, dấu xoay theo phiên bản VRM, **hình học bố cục** (`vrmBodyRect` · `vrmSideMargin` · `vrmLeftBesideDock` — xem mục 11). |
| `packages/shared/src/vrmActivity.ts` | **Phản ứng theo loại việc**: công cụ nào → clip + biểu cảm + câu nói (mục 13.4). |
| `packages/shared/src/vrmMotion.ts` | Danh mục 13 clip `.vrma` CC0 tải theo yêu cầu + luật xoay vòng theo vai trò. |
| `packages/shared/src/vrmSample.ts` | Model mẫu tải theo yêu cầu. |
| `packages/shared/src/vrm.ts` | DTO cấu hình (`VrmSettingsDto`), clip tự nạp (`VrmFolderMotionsDto`, `pickVrmaNames`, `nextFolderClipForRole`). |
| `apps/desktop/src/renderer/src/lib/vrmStage.ts` | **Sân khấu 3D**. Không phụ thuộc React. Nơi duy nhất chạm vào xương. |
| `apps/desktop/src/renderer/src/lib/useVrmMotion.ts` | Chạy clip theo vai trò — **hai nguồn** (danh mục CC0 + clip user tự nạp) đi chung một luật ưu tiên. |
| `apps/desktop/src/renderer/src/components/VrmPanel.tsx` | Khung React, chuột/phím, menu tròn, nội dung bảng cài đặt. |
| `apps/desktop/src/renderer/src/components/VrmSettingsFrame.tsx` | **Khung** bảng cài đặt hai cột + `SettingsGroup`/`SettingsToggle`/`SettingsField`. Cố ý chỉ phụ thuộc `react` + `@infra/shared` để harness bundle được. |
| `apps/desktop/src/renderer/src/components/VrmRadialMenu.tsx` | Menu tròn, bảng hai bên (`VrmSidePanel`), bong bóng chat + bong bóng thoại. |
| `apps/desktop/src/renderer/src/components/VrmOverlayApp.tsx` | Nhân vật hiện **ngoài desktop** khi app ở khay. |
| `apps/desktop/src/main/overlay.ts` | Cửa sổ overlay ở main: khi nào hiện, khi nào ẩn. |
| `apps/desktop/src/main/ipc/vrm.ts` | Danh bạ model, cấu hình, trang phục, thư mục clip — ghi xuống `userData`. |
| `packages/core/src/vrm/*.test.ts` | Test cho mọi hàm thuần ở trên. |

**File ghi ở `userData`** (ngoài vault, JSON thường — ai cũng sửa tay được nên mọi hàm đọc phải
chuẩn hoá lại):

| File | Chứa gì |
|---|---|
| `vrm-models.json` | Danh bạ **đường dẫn** model (không chép file). |
| `vrm-settings.json` | `VrmSettingsDto`. |
| `vrm-outfits.json` | Bộ trang phục user tự lưu. |
| `vrm-folder-motions.json` | Thư mục `.vrma` user nạp + `tên file → vai trò`. **Chỉ đường dẫn**, xem mục 10.3. |
| `vrm-motions/` | 13 clip CC0 đã tải (chỉ thư mục này chứa file thật). |
| `vrm-samples/` | Model mẫu đã tải. |

**Ranh giới bắt buộc**: mọi thứ tính toán nằm ở `packages/shared` (renderer dùng được, có test).
`apps/**` không được vitest quét nên đừng đặt logic ở đó.

---

## 2. Kiến trúc tư thế — đọc mục này trước khi sửa bất cứ chuyển động nào

Mỗi frame chạy đúng một vòng: **xoá tư thế → từng tầng CỘNG vào → ghi xuống xương một lần**.

```
clearPose()                       // mọi giá trị về 0
  ↓ idle()        — thở, đung đưa, nhìn theo chuột, lớp kéo
  ↓ microTick()   — cử chỉ nhỏ thưa thớt
  ↓ statusTick()  — dáng người khi hệ thống có cảnh báo
  ↓ reactTick()   — phản ứng khi bị click
writePose()                       // NƠI DUY NHẤT gán vào bone.rotation / bone.position
  └── applyArms()                 // IK tay, chạy cuối vì cần vai đã dời xong
```

**Vì sao phải vậy**: trước đây mỗi chuyển động tự ghi thẳng vào xương, nên thứ tự dòng code quyết
định ai thắng — đã mắc lỗi "hai nguồn cùng ghi một xương" **ba lần**. Giờ muốn thêm chuyển động
mới thì cộng vào `pose`, không bao giờ gán thẳng vào xương ngoài `writePose`.

**Tầng ưu tiên** (`vrmIdle.ts`, hàm `isClaimedByHigher`): chỉ tầng `critical` mới giành xương.
Các tầng còn lại cộng dồn. Đây là bài học đau: lúc đầu cho `micro`/`status`/`interaction` giành
xương đầu, kết quả là click một cái thì đầu giật 31 độ và đứng hình 16 giây khi có cảnh báo.

---

## 3. Tay — bảng số liệu

Tất cả ở `packages/shared/src/vrmArmPose.ts`. Sửa số ở đây là đổi ngay, không cần đụng stage.

### 3.1 Tư thế nghỉ (`NATURAL_REST`)

| Tham số | Trái | Phải | Ý nghĩa |
|---|---|---|---|
| `lateralFrac` | 0.75 | 0.85 | Bàn tay cách tâm thân, theo tỉ lệ bề rộng hông |
| `lateralM` | 0.015 | 0.02 | Cộng thêm (mét) |
| `forwardM` | 0.05 | 0.065 | Bàn tay ra trước hông (mét) |
| `reach` | 0.988 | 0.992 | Với bao nhiêu phần chiều dài tay |
| `poleOut` | 0.2 | 0.25 | Khuỷu hé ra ngoài |
| `poleBack` | 0.95 | 0.92 | Khuỷu hé ra sau |
| `palmBack` | 0.25 | 0.45 | Lòng bàn tay xoay ra sau |
| `shoulderDrop` | 0.035 | 0.03 | Vai hạ (radian) |

**Hai bên cố ý lệch nhau.** Đối xứng tuyệt đối là dấu hiệu rõ nhất của hình nộm. Có test chặn
việc vô tình làm chúng bằng nhau.

**`reach` phải 0.98–0.995, đừng hạ thấp.** Định lý cos: hai khúc bằng nhau, với 95,5% chiều dài
thì khuỷu gập **34 độ** (đo đúng vậy trên model thật, user gọi là "cong rõ rệt"). 99% mới ra 15
độ. Người đứng thả lỏng gập 10–18 độ.

**Muốn khuỷu sát eo hơn nữa**: giảm `poleOut`, tăng `poleBack`. Đừng để `poleOut` về 0, khuỷu sẽ
ép vào sườn và xuyên qua thân ở model gầy. Test chặn ở mức 0.1.

### 3.2 Khuỷu trôi (`ELBOW_DRIFT`) — chống "đơ ở cùi chỏ"

| Tham số | Giá trị | Ý nghĩa |
|---|---|---|
| `swingRad` | 0.2 | Biên độ quay khuỷu quanh trục vai→tay (~11 độ) |
| `freqA` / `freqB` | 0.21 / 0.34 | Hai tần số, cố ý không chia hết cho nhau |
| `reachAmp` | 0.006 | Đổi độ với đi kèm (mét) |

**Đây là bậc tự do thứ ba của khớp vai.** IK hai xương chỉ quyết định được vị trí bàn tay; khuỷu
còn xoay tự do quanh trục vai→tay mà không làm bàn tay nhúc nhích. Bản đầu để cố định nên khuỷu
nằm chết một điểm — user nhìn ra ngay.

**Đo được**: dải quét của khuỷu trong 12 giây đi từ 0 lên **2,6–3,9 cm ngang, 2,1–2,8 cm
trước-sau, độ gập đổi 9–14 độ**. Muốn kiểm lại thì đo **khuỷu**, đừng đo bàn tay — bàn tay đứng
yên theo thiết kế.

### 3.3 Tay theo hướng nhìn (`LOOK_ARM`)

| Tham số | Giá trị | Ý nghĩa |
|---|---|---|
| `forwardPerRad` | 0.055 | Tay đưa trước/lùi sau mỗi radian góc nhìn (mét) |
| `lateralPerRad` | 0.022 | Tay sát thân thêm |
| `polePerRad` | 0.35 | Khuỷu mở theo |

Quay đầu sang trái thì thân vặn theo: tay trái lùi, tay phải đưa tới. Đo được bàn tay dịch
**5,7 cm** giữa nhìn hết trái và hết phải.

### 3.4 Tay đu quán tính khi xoay người (`ARM_SWING`)

Con lắc tắt dần. Lực vào là vận tốc góc của thân, đầu ra là độ lệch đích bàn tay.

| Tham số | Giá trị | Ý nghĩa |
|---|---|---|
| `drag` | 5.5 | Kéo ngược theo vận tốc tiếp tuyến |
| `stiffness` | 40 | Lò xo kéo về (chu kỳ ~1 giây) |
| `damping` | 7 | Giảm chấn, hệ số tắt ~0,55 → lố một nhịp rồi yên |
| `maxM` | 0.06 | Biên tối đa (mét) |
| `maxDt` | 0.05 | Kẹp bước thời gian |

**`maxDt` bắt buộc phải có.** Tab ẩn rồi hiện lại cho bước thời gian hàng giây, tích phân Euler sẽ
nổ và tay văng ra ngoài.

Đo được ở ~6 rad/s: tay trái +5,5 cm, tay phải −5,6 cm (cùng hướng thế giới, đúng kiểu tay treo
lỏng), dừng 2,5 giây thì về chỗ cũ.

### 3.5 Các lớp nhỏ

- `WEIGHT_SHIFT_ARM` — dồn trọng tâm: chân trụ bên nào thì vai bên đó hạ, tay sát thân hơn.
- `MICRO_ARM` — vi chuyển động khi giữ tư thế, vài mm chu kỳ dài.
- `FINGER_CURL` — ngón cong tăng dần trỏ < giữa < nhẫn < út, tất cả dưới 30 độ.
  `FINGER_CURL_RIGHT_SCALE` 0.92 cho tay phải cong ít hơn chút.

---

## 4. Kéo nhân vật (`TUG`) — thao tác và vật lý

### 4.1 Ba kiểu kéo

| Thao tác | Kết quả |
|---|---|
| **Kéo trần** trên thân người | Níu nhân vật: cả người nghiêng, buông là bật về |
| **Ctrl + kéo** | Dời nhân vật đi chỗ khác (nhớ vị trí) |
| **Shift + kéo** | Xoay người |
| Kéo trần ở **góc khung trống** | Vẫn dời như cũ |

Đổi phím ở `VrmPanel.tsx` (`onPointerDown`) và `useDraggablePanel.ts` (cờ `requireCtrl`).

### 4.2 Số liệu lò xo

| Tham số | Giá trị | Ý nghĩa |
|---|---|---|
| `radPerFrac` | 0.55 | Kéo 1 phần bề rộng khung = bao nhiêu radian nghiêng |
| `maxRad` | 0.3 | Trần nghiêng (~17 độ) |
| `stiffness` | 36 | Lò xo về 0 |
| `damping` | 5 | Hệ số tắt ~0,42 → nảy một nhịp |
| `followSpeed` | 14 | Bám theo chuột lúc đang giữ |

### 4.3 Phân bổ lên cơ thể (trong `vrmStage.ts`, hàm `idle`)

| Bộ phận | Hệ số | Ghi chú |
|---|---|---|
| Cột sống | 0.42 | |
| Ngực | 0.26 | |
| Đầu | 0.2 | Đi sau thân một nhịp |
| Hông xoay | 0.18 | **Chỉ lớp kéo.** Idle luôn để 0 |
| Hông trượt ngang | 0.055 | Mét |
| Gối gập | 1.4 | Kéo hết cỡ ra 23–27 độ |

**Ba điều tuyệt đối không làm với chân** (mỗi điều đều đã mắc và đã sửa):

1. **Không xoay hông lúc đứng yên.** Hông là gốc bộ xương, xoay là chân vung sang hai bên như bị
   treo cổ. Chỉ lớp kéo được xoay, và khi đó chân cũng chống lại nên cả khối dịch cùng nhau.
2. **Không xoay đùi.** Xương chân treo từ hông nên xoay đùi làm cẳng chân và bàn chân đu như con
   lắc: đo được **trượt 10,7 cm**, giảm hệ số xuống vẫn 5 cm. Không có IK chân để ghim bàn chân.
   Chỉ gập gối, với đùi và cẳng chân ngược dấu nhau.
3. **Không hạ hông để "hạ trọng tâm".** Hạ gốc bộ xương là cả người tụt, chân lún qua mép khung.
   Trọng tâm hạ do gối gập, rồi bù lại bằng `measureKneeLift`.

### 4.4 `measureKneeLift` — vì sao phải đo chứ không tính

Gập gối làm người thấp xuống, phải nâng hông đúng lượng đó thì bàn chân mới đứng yên.

Đã thử hai công thức hình học, cả hai sai:

| Cách | Kết quả |
|---|---|
| `legLen · (1 − cos(θ/2))` | Chân **nhấc lên 4,6 cm** |
| `legLen · (1 − cos(θ/4))` | Vẫn nhấc 2–3,3 cm, hai model lệch nhau gần gấp đôi |
| **Đo trên rig** | Lệch **dưới 0,33 cm** ở mọi mức kéo, mọi model |

Cách đo: ghi góc gối lên xương, gọi `updateWorldMatrix`, đọc `leftFoot.y` tụt bao nhiêu so với
lúc nghỉ. Chính con số đó là lượng cần nâng. Có nhớ đệm theo góc gối nên lúc đứng yên không chạy.

**Bài học chung**: hình học đúng trên giấy vẫn sai khi tỉ lệ đùi/cẳng chân/bàn chân mỗi rig một
khác. Đo thẳng trên rig rẻ hơn và đúng mọi model.

---

## 5. Hiệu năng — hai cái bẫy đã sập

### 5.1 `hitTest` từng làm app đứng hình

Bản đầu dùng `Raycaster.intersectObject(scene, true)` — quét **từng tam giác** của skinned mesh.

| Model | Một lần gọi |
|---|---|
| Lily (921 nghìn đỉnh) | **277 ms** |
| Carlotta (1,1 triệu đỉnh) | **181 ms** |

Mỗi cú di chuột gọi nhiều lần, nên mỗi lần chạm là đứng hình hơn một phần tư giây. Người dùng báo
là "model lag, kéo giật" và tưởng model lỗi.

Nay dùng **hộp bao xương** (`hitTestFast`): lấy ~20 khớp đã có sẵn ma trận từ `writePose`, chiếu
lên màn hình, kiểm con trỏ trong hộp. **200 lần gọi tốn 0,2–0,9 ms tổng.**

Hai hằng số:

- `HIT_PAD` = 0.12 — nới hộp bù tóc/váy không có xương.
- `HIT_PAD_TOP` = 0.42 — nới **riêng phía trên**, vì xương đầu nằm ở chân sọ còn đỉnh đầu, tóc mái,
  tai thú thì cao hơn nhiều. Với biên 0.12 thì bấm đỉnh đầu bị trả "trượt", mà đó là chỗ người ta
  hay chạm nhất.

Đánh đổi có chủ ý: hộp rộng hơn thân thật nên bấm sát mép váy vẫn tính trúng. Chấp nhận được cho
việc "trúng người hay trúng nền".

### 5.2 Model nặng không phải là nguyên nhân lag

Đo Lily 75 MB, 921 nghìn đỉnh, 585 morph target, 35,9 triệu phép morph mỗi frame (gấp 12 lần model
thường): vẫn chạy **120 FPS** ở khung to, vừa xoay vừa bật vật lý tóc váy.

**Bài học đo**: đừng chỉ đo FPS. Ở đây FPS hoàn toàn bình thường trong khi một lần gọi chuột tốn
277 ms. Phải đo thẳng hàm bị nghi, và đo ở kích thước khung thật — harness khung nhỏ cho 120 FPS ở
mọi model nên không phân biệt được gì.

---

## 6. Hai loại rig — bẫy dấu xoay

VRM 1.0 và VRM 0.x **lật dấu trục X và Z** của xương tay và chân. Cùng một góc dương làm bàn chân
ra trước ở rig này, ra sau ở rig kia. Trục Y không lật.

Xử lý: `armSignFor(metaVersion)` trong `vrmFraming.ts` trả về 1 hoặc −1. Dùng cho vai, ngón tay,
và **cả chân**.

Với 0.x còn một bẫy nữa: `VRMUtils.rotateVRM0` xoay scene 180 độ quanh Y, nên quaternion thế giới
của xương cha mang sẵn phép xoay đó. Công thức ghi xương phải là `Q_world = qM · R_model · restQ`.
Thiếu `restQ` thì tay chỉ thẳng lên trời — đã mắc thật.

**Luôn kiểm trên cả hai loại model trước khi tin.** Trong `D:/vrm` có sẵn cả hai.

---

## 7. Các lớp khác

### 7.1 Nhịp idle (`vrmIdle.ts`)

| Hằng số | Giá trị |
|---|---|
| Chớp mắt | 3–7 giây, 15% là chớp đúp |
| Liếc nhìn | 8–15 giây |
| Cử chỉ nhỏ | 15–30 giây |
| Giữ dáng khi có cảnh báo | 12 giây |
| Tự xoay một vòng | mỗi 2–3 phút, quay trong 8 giây |

### 7.2 Chat và gợi ý (`vrmChat.ts`)

- Giữ 8 lượt hội thoại, không ghi xuống đĩa.
- Nhận lệnh mở công cụ bằng **so khớp từ khoá, không gọi AI**: mở panel là việc chắc đúng hoặc
  chắc sai, qua AI chỉ thêm độ trễ và chỗ để đoán sai.
- **Không dùng `\b` trong regex tiếng Việt.** `\b` của JS chỉ biết ASCII nên `\bmở\b` không bao giờ
  khớp — mọi câu có dấu lặng lẽ bị bỏ qua, không lỗi nào báo. Dùng lookaround `\p{L}` với cờ `u`.
- Gợi ý thao tác: lần đầu sau 25 giây, rồi 3–6 phút một câu, **chỉ gợi thao tác chưa làm**, làm hết
  thì im hẳn. Nhớ qua `localStorage`.

### 7.3 Nhân vật ngoài desktop

Khi app thu vào khay hoặc thu nhỏ mà có thông báo, một cửa sổ trong suốt hiện ở góc phải dưới.

- Điều kiện: có model đang chọn, bật "Phản ứng khi có cảnh báo" và "Hiện ngoài desktop khi app ở khay".
- Không cướp focus (`showInactive`), tự ẩn sau 15 giây, chuột để lên thì giữ.
- Bấm vào nhân vật là mở lại app.
- Cửa sổ tạo lười ở thông báo đầu tiên rồi giữ lại, vì nạp model mất 4–7 giây.
- Bong bóng thoại ở đây dùng nền **đục** (`opaque`), vì nền 20% alpha đặt trên wallpaper thì không
  đọc được — đã chụp thử và thấy.

**⚠️ Vòng đời cửa sổ — chỗ đã hỏng một lần.** Vì cửa sổ được **giữ lại** giữa các đợt (chỉ ẩn/hiện,
không dựng lại), nó có thể rơi vào trạng thái *nửa sống nửa chết*: renderer chết nhưng
`win.isDestroyed()` vẫn `false` và cờ `ready` vẫn `true`. Khi đó `flush()` gửi IPC vào hư không rồi
`showInactive()` một **cửa sổ trong suốt rỗng** — main báo thành công, user không thấy gì. Triệu chứng
user báo: *"lần đầu có nhân vật, những lần sau không"*. Ba chốt hiện có:

| Chốt | Ở đâu | Vì sao |
|---|---|---|
| `render-process-gone` + `did-fail-load` → `destroy()` | `create()` | Renderer chết thì bỏ hẳn cửa sổ, đợt sau dựng lại. `did-fail-load` **bỏ qua mã `-3` (ABORTED)** — đó là do chính ta destroy giữa chừng, không phải lỗi nạp. |
| `if (!ready)` → dựng lại, **không** gọi `flush()` | `overlayOnEvent` | `flush()` thoát sớm khi `!ready` và **không để lại dấu vết** — thông báo nằm mãi trong `pending`. |
| `'closed'` dọn thêm `held = false` | `create()` | `held` chỉ reset ở `pointerleave`; cửa sổ chết thì sự kiện đó không bao giờ bắn, và `armHide()` có `if (held) return` nên overlay sẽ không bao giờ tự ẩn nữa. |

⚠️ **Chụp `pending` TRƯỚC `destroy()`.** Đã đo bằng Electron thật: `'closed'` chạy **đồng bộ bên
trong** `destroy()` và nó xoá `pending` — chụp sau là mất đúng cái thông báo vừa kích hoạt việc dựng lại.

✅ **Đã test GUI thật** (v0.4.5): app ở khay, nhân vật hiện lại qua **nhiều đợt** cảnh báo — không còn
im sau lần đầu.

⚠️ **Nhưng mới phủ được đường "renderer chết".** `VrmOverlayApp` vẫn **không nghe `webglcontextlost`**.
Chromium chỉ cho ~16 context WebGL và cửa sổ chính mỗi lần đổi model lại chiếm/trả, nên context của một
cửa sổ **ẩn hàng giờ** có thể bị thu hồi — khi đó renderer **vẫn sống**, `render-process-gone` không
bắn, `ready` vẫn `true`, và lỗi tái diễn y hệt. Thử vài đợt trong một phiên ngắn **không tái hiện được**
kịch bản này. **Còn treo: để app ở khay qua đêm rồi xem còn hiện không.**

**Cách phân biệt nếu tái phát**: xem log main — không có dòng `[overlay] renderer gone:` hay
`window alive but renderer not ready` nghĩa là renderer còn sống ⇒ lỗi nằm ở context WebGL.

### 7.4 Công tắc chẩn đoán

Gõ trong console khi app đang chạy, không cần build lại:

```js
avatarArmMode('natural')            // đầy đủ (mặc định)
avatarArmMode('rest')               // tay buông cạnh đùi, đứng yên
avatarArmMode('zero')               // T-pose, thấy rest pose thật của rig
avatarArmDebug({ elbow: false })    // tắt khuỷu trôi + tay theo hướng nhìn
avatarArmDebug({ swing: false })    // tắt quán tính đu khi xoay
avatarArmDebug({ showTargets: true })  // hiện cầu đánh dấu đích tay và khuỷu
avatarDebug(true)                   // in trạng thái mỗi giây
avatarSpin()                        // xoay một vòng ngay
```

---

### 7.5 Bảng cài đặt lớn — hai quy tắc DOM

`VrmSettingsFrame.tsx` là **anh em** của thẻ nhân vật trong `VrmPanel` (cùng cha `App`), không phải
con. Thẻ nhân vật có `transform: scale()` (co cho vừa khe) và `opacity` (mờ dưới chữ); một phần tử
`position: fixed` nằm trong cha có `transform` sẽ tính toạ độ **theo cha** và co theo cha — bảng văng
khỏi tâm, to nhỏ theo thanh cỡ, mờ 55%, không dòng lỗi nào. Bảng chia **hai lớp** cùng một hộp: nền
`z-30` dưới nhân vật (`z-40`), nội dung `z-50` trên nhân vật; `fixed` luôn tạo stacking context riêng
nên một thẻ không làm được cả hai việc. Khe giữa lớp nội dung không nhận chuột để kéo / xoay vẫn chạy.

Bề ngang thẻ nhân vật = bề ngang người đo được × `VRM_WIDTH_MARGIN` (2,2, ở `packages/shared`).
Mọi phép "vừa khe", "chạm mép" phải chia cho số này: `characterSlotInSettings` chỉ co theo **chiều
cao**; `useDraggablePanel({ clampCenter })` kẹp theo **tâm** thẻ. Với một model, `measureDrawn` bão
hoà (bóng chạm hai mép khung đo vuông) nên tỉ lệ ra đúng 2,2 — thẻ rộng gấp 5 lần người: co theo khe
thì chiều cao hiển thị = khe ÷ tỉ lệ, kéo thanh cỡ **không đổi gì**; kẹp theo mép thì "đụng tường"
khi người còn cách mép cả gang tay. Vị trí `left/top` tính theo kích thước **gốc**, vì
`transform-origin: bottom center` giữ đáy và tâm ngang của thẻ gốc, không phải của hình đã co.

Kiểm bằng `apps/desktop/_harness/settings/run.cjs` (gitignore): bundle đúng component thật bằng
esbuild, chụp 7 mức cỡ × 3 cỡ cửa sổ, đo bằng `getBoundingClientRect` / `elementFromPoint`. Hai lỗi
22px / 62px chỉ lộ ở đây, không lộ ở test số.

### 7.6 Chế độ CÓ KHUNG — luôn phải có lối thoát

`chromeless` chỉ `true` khi nhân vật **đã thật sự hiện**. Mọi trạng thái còn lại là chữ (chưa chọn
model, đang nạp lần đầu, lỗi, mất file) nên rơi vào **khung `w-80` có nền** — chữ trên nền trong
suốt đè lên Dashboard thì không đọc nổi.

Khung đó chỉ có `overflow-hidden`, **không cuộn**. Đã hỏng một lần vì hai thứ cộng lại:

- `{!chromeless && controls?.()}` nối **cả bảng cài đặt** (Hiển thị / Thông báo / Thao tác / Chuyển
  động) vào ngay dưới `StartScreen`;
- nút `✕ Tắt trợ lý ảo` nằm cuối `footer`, tức đúng phần bị cắt khi nội dung dài hơn màn hình.

Kết quả: mở trợ lý ảo lần đầu (chưa có model) là **kẹt hẳn, không có cách nào thoát**. Hai chốt hiện có:

| Chốt | Vì sao |
|---|---|
| `controls` chỉ dựng khi **`settings && active`** | `settings` LUÔN có (file cấu hình tồn tại sẵn) nên điều kiện cũ `settings` không lọc được gì. Chưa có model thì mọi công tắc đều vô nghĩa — không có nhân vật để áp lên. |
| Nút **✕ riêng của khung** khi `!chromeless` | Lối thoát không được phụ thuộc `controls` (nay là `null` ở trạng thái này) hay vào việc nội dung có bị cắt hay không. |

⚠️ Nút ✕ là **anh em** của `boxRef`, không bọc quanh nó: `boxRef` là nơi canvas WebGL cắm vào, đổi
cấu trúc DOM quanh thẻ đó là mất context và phải nạp lại model 40 MB.

⚠️ **Vẫn chưa cho khung cuộn** (cố ý, phạm vi hẹp): trạng thái framed nào sau này có nội dung dài hơn
màn hình thì vẫn bị cắt cụt — khác là giờ luôn còn nút ✕. Muốn chắc thì thêm
`max-h-[80vh] overflow-y-auto` và gắn `Escape` cho cả chế độ framed (hiện `Escape` chỉ có trong
`VrmSettingsFrame`, mà component đó không hề được dựng khi `!chromeless`).

## 8. Cách đo lại khi sửa

Có sẵn bộ đo ở `apps/desktop/_harness/` (không commit). Cách dùng:

```bash
cd apps/desktop
pnpm exec vite build --config _harness/vite.config.ts
cd _harness
# QUAN TRỌNG: bỏ biến này, nó đang được set sẵn cho vitest và sẽ làm require('electron') hỏng
unset ELECTRON_RUN_AS_NODE
../../../node_modules/.bin/electron.cmd run.cjs "D:/vrm/<file>.vrm" <tên>
```

Kết quả in ra console, ảnh lưu ở `_harness/shots/`.

**Ba harness đo BỐ CỤC** (không cần model, chạy nhanh — dùng mỗi khi sửa UI):

```bash
unset ELECTRON_RUN_AS_NODE
./node_modules/.bin/electron.cmd apps/desktop/_harness/settings/run.cjs    # vị trí nhân vật trong khe
./node_modules/.bin/electron.cmd apps/desktop/_harness/settings/cols.cjs   # cân hai cột + thanh chân
./node_modules/.bin/electron.cmd apps/desktop/_harness/settings/side.cjs   # hai cột nổi cạnh nhân vật
```

- `run.cjs` — 21 ca × 3 cỡ cửa sổ, **assert** chứ không chỉ chụp. Chạy sau mọi thay đổi khung.
- `cols.cjs` — in chiều cao mỗi cột ở 0/7/30 clip + `footH` (>60px = hai nút xếp chồng).
- `side.cjs` — dựng `VrmSidePanel` cạnh một ô giả chỗ nhân vật.

Cả ba dựng **component THẬT** (`VrmSettingsFrame`, `VrmControls` qua alias `VrmControlsForHarness`,
`VrmSidePanel`). Đừng chép lại component vào harness: bản chép lệch khỏi bản thật ngay lần sửa kế
tiếp, và lúc đó harness đo một thứ không còn tồn tại.

**Bảy cái bẫy của harness** (đều đã sập ít nhất một lần):

1. Đặt harness **trong** `apps/desktop`, không phải gốc repo — nếu không Tailwind không sinh class.
2. `show: true` bắt buộc. `show: false` chặn `requestAnimationFrame`, animation đứng im và trông
   như không render.
3. `capturePage` ném lỗi khi cửa sổ đang vẽ WebGL liên tục — phải thử lại vài lần, đừng kết luận
   trang hỏng.
4. Đo ở **kích thước khung thật**. Khung nhỏ cho 120 FPS ở mọi model.
5. **Phải chép CSS đã build của app** (`out/renderer/assets/*.css`) vào thư mục harness — xem
   `cols.cjs`. Không có Tailwind thì mọi class thành vô nghĩa, layout đo ra sai mà **không lỗi nào
   báo**. Hai harness ảnh đã thất bại vì đúng chỗ này.
6. **Stub `window.infra.vrm`** những gì component gọi lúc mount (`listSamples`…). Thiếu thì cả cây
   ném lỗi và số đo ra `null`.
7. **Harness bỏ qua phần nào thì phần đó không được kiểm.** `cols.tsx` từng tự ghép hai cột bằng
   tay thay vì dựng `VrmSettingsFrame` thật — nên nó không có thanh chân, và đúng chỗ đó lọt một
   lỗi ra tới user. Dựng khung thật, đừng "ghép cho nhanh".

⚠️ **Canvas WebGL không đọc pixel ra được**: `preserveDrawingBuffer` tắt nên `drawImage(canvas)`
trả ảnh rỗng. Muốn đo bề ngang nhân vật thì dùng `stage.aspect` (nó vốn đo từ pixel đã vẽ), đừng
tự quét alpha từ ngoài.

---

## 9. Thêm trường vào cấu hình — nhớ đủ 3 chỗ

`VrmSettingsDto` phải sửa ở **ba** nơi, thiếu một chỗ là giá trị bị nuốt lúc ghi mà không lỗi nào báo:

1. `packages/shared/src/vrm.ts` — khai báo + `DEFAULT_VRM_SETTINGS`
2. `apps/desktop/src/main/ipc/vrm.ts` — hàm `readSettings()`
3. `apps/desktop/src/main/ipc/vrm.ts` — object `clean` trong handler ghi

### 9.1 Thêm một IPC mới — đủ 4 chỗ

1. `packages/shared/src/ipc.ts` — khoá trong `IPC`
2. `apps/desktop/src/main/ipc/vrm.ts` — `ipcMain.handle(...)`
3. `apps/desktop/src/preload/index.ts` — hàm trong `vrm: {...}`
4. `packages/shared/src/types.ts` — chữ ký trong khai báo `window.infra.vrm`

Thiếu (4) thì typecheck đỏ ngay; thiếu (3) thì renderer gọi vào `undefined` **lúc chạy**.

### 9.2 Không nhét mọi thứ vào `VrmSettingsDto`

Dữ liệu dạng **danh sách** thì làm file riêng ở `userData` (như `vrm-folder-motions.json`):
`readSettings()` có quy tắc chuẩn hoá từng trường mà một map lồng nhau không hợp với khuôn đó.
File riêng vẫn phải có hàm `clean*()` của nó — JSON ngoài vault, ai cũng sửa tay được.

---

## 10. Giấy phép model — kiểm trước khi đưa bất cứ file nào vào repo

Repo này **public**. Đưa một file `.vrm` vào là phát tán nó cho mọi người tải, nên phải chắc chắn
giấy phép cho phép **phân phối lại**, không chỉ "cho dùng".

Có sẵn công cụ đọc giấy phép nhúng trong file:

```bash
node scripts/vrm-license.cjs "đường/dẫn/model.vrm"
```

Nó đọc `VRMC_vrm.meta` (VRM 1.0) hoặc `VRM.meta` (0.x) và kết luận ngắn gọn. Quét bộ model thử
nghiệm cho thấy khoảng một nửa ghi rõ **cấm phân phối lại**, nên đừng bỏ qua bước này.

⚠️ **Metadata không phải là giấy phép hợp lệ trong mọi trường hợp.** Với nhân vật game thương mại
được ai đó chuyển sang VRM, metadata do **người chuyển đổi** tự điền, mà họ không phải chủ sở hữu
bản quyền nhân vật. Một file ghi "cho phân phối lại" vẫn có thể vi phạm bản quyền của hãng game.
Chỉ đưa vào repo những model mà **tác giả gốc** công bố giấy phép cho phép, tốt nhất là CC0.

### 10.1 Model mẫu nên dùng

**Sendagaya Shino (千駄ヶ谷篠)** — nhân vật nữ anime, đồng phục học sinh, tóc dài đen.

| | |
|---|---|
| Tác giả | pixiv Inc. (dự án VRoid) |
| Giấy phép | **CC0** — pixiv tuyên bố từ bỏ toàn bộ quyền |
| Tải | `https://opengameart.org/sites/default/files/sendagaya_shino.zip` |
| Kích thước | 14,2 MB (zip 11,7 MB) |
| sha256 (file .vrm) | `f11b2648e7e588ae171ad1c32e465f84e5b130b1d1789e3a3702946c0981d2a9` |
| Phiên bản | VRM 0.x |

Metadata nhúng đã tự kiểm bằng `scripts/vrm-license.cjs`: `redistribution=allow`,
`credit=unnecessary`, `modification=allow`, `corporate_commercial_use=allow`. Vì là CC0 nên
**không bắt buộc ghi công**, nhưng vẫn nên ghi tên pixiv trong tài liệu cho phải phép.

Đã chạy thật qua bộ đo: khuỷu gập 11,8 và 19,3 độ, lòng bàn tay hướng vào thân, tay buông cạnh
đùi đúng thiết kế. Nhẹ hơn nhiều so với model nặng (708 nghìn đỉnh, 10 MB texture).

**Phương án hai**: `VRM1_Constraint_Twist_Sample.vrm` của pixiv, chính là model demo mà thư viện
`three-vrm` dùng. Ưu điểm là **VRM 1.0 gốc**, tránh hẳn bẫy lật dấu ở mục 6. Nhược điểm là nhân
vật mẫu kỹ thuật, áo thun quần đùi, không đẹp bằng. Tải từ
`https://raw.githubusercontent.com/pixiv/three-vrm/dev/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm`.

⚠️ **Bẫy trùng tên**: bộ mẫu `AvatarSample_A–G` và `VRoidPreset_A–Z` **của VRoid Studio bản hiện
tại KHÔNG phải CC0** — trang chính thức của VRoid cấm rõ việc phát tán lại chúng dưới danh nghĩa
CC0. Chỉ bộ alpha cũ đăng trên OpenGameArt mới là CC0, mà chúng **trùng tên** với bộ mới. Luôn
kiểm metadata của đúng file mình có, đừng tin cái tên.

### 10.2 Cách đăng model mẫu lên GitHub Release

Model **không nhúng vào app** — 14 MB sẽ vào mọi bản cài của mọi người, kể cả phần lớn không bao
giờ bật nhân vật. App tải về khi user bấm nút, lưu vào `userData/vrm-samples/`.

App tải từ **release của chính repo này**, không trỏ thẳng sang trang gốc: link bên thứ ba chắc
chắn sẽ chết theo thời gian (đã dính với runtime của local dev), và tải từ domain mình không kiểm
soát thì không bảo đảm được nội dung. Giấy phép CC0 cho phép host lại.

Làm một lần, không cần lặp mỗi lần phát hành app.

**File đã chuẩn bị sẵn**: `D:\vrm\_release\sendagaya-shino.vrm` (14.870.776 byte, sha256 đã đối
chiếu khớp hằng số trong code). Nếu cần làm lại từ đầu:

```bash
curl -L -o shino.zip "https://opengameart.org/sites/default/files/sendagaya_shino.zip"
unzip shino.zip                               # ra "Sendagaya Shino.vrm"
mv "Sendagaya Shino.vrm" sendagaya-shino.vrm
sha256sum sendagaya-shino.vrm                 # phải ra f11b2648e7e5…
node scripts/vrm-license.cjs sendagaya-shino.vrm
```

**Đăng lên GitHub** (máy này chưa cài `gh` CLI nên làm qua trang web):

1. Mở https://github.com/xShiroeNguyenx/infra-companion/releases/new
2. Ô **Choose a tag**: gõ `vrm-sample-v1` rồi bấm **Create new tag: vrm-sample-v1 on publish**
3. **Release title**: `Model mẫu VRM`
4. **Describe this release**:
   ```
   Sendagaya Shino — model mẫu cho tính năng nhân vật 3D.
   Tác giả: pixiv Inc. (dự án VRoid). Giấy phép: CC0.
   https://vroid.pixiv.help/hc/en-us/articles/360013482714-Sendagaya-Shino
   ```
5. Kéo thả file `D:\vrm\_release\sendagaya-shino.vrm` vào ô **Attach binaries**
6. Chờ tải xong 14 MB rồi bấm **Publish release**

Sau đó kiểm link app sẽ gọi:

```bash
curl -sIL "https://github.com/xShiroeNguyenx/infra-companion/releases/download/vrm-sample-v1/sendagaya-shino.vrm" | grep -i "^HTTP\|^content-length"
```

Phải thấy `HTTP/2 200` và `content-length: 14870776`.

Nếu muốn dùng `gh` CLI cho nhanh (cài từ https://cli.github.com), lệnh tương đương:

```bash
gh release create vrm-sample-v1 "D:/vrm/_release/sendagaya-shino.vrm" \
  --title "Model mẫu VRM" \
  --notes "Sendagaya Shino (CC0) — pixiv Inc."
```

**Tag tách riêng (`vrm-sample-v1`) là cố ý**: model không đổi theo phiên bản app, gắn nó vào tag
phát hành thì mỗi lần ra bản mới lại phải đính kèm 14 MB đó thêm một lần.

**Thay model khác thì phải sửa 2 chỗ cùng lúc**: `sha256` và `url` trong
`packages/shared/src/vrmSample.ts`. Sai mã băm thì mọi lượt tải đều bị từ chối ở bước kiểm — đúng
theo thiết kế, nhưng sẽ khó hiểu nếu quên vì sao.

**Cơ chế bảo vệ khi tải** (đã kiểm bằng server giả lập, cả 4 tình huống):

| Tình huống | App làm gì |
|---|---|
| Tải đúng | Nhận, kiểm mã băm, thêm vào danh bạ, chọn luôn |
| File bị sửa dù chỉ 1 byte | Mã băm lệch → xoá file, báo rõ lý do |
| Link chuyển hướng sai (trang lỗi, trang đăng nhập) | Dừng khi vượt 130% dung lượng dự kiến |
| Link chết | Thử mirror, hết thì báo lỗi mạng |

Ghi ra file `.part` rồi mới đổi tên, nên đứt mạng giữa chừng không để lại file cụt mà lần sau app
tưởng là model hợp lệ.

---

## 10.3 Thư viện chuyển động `.vrma`

13 clip **CC0** tải theo yêu cầu vào `userData/vrm-motions/`. Danh mục ở
`packages/shared/src/vrmMotion.ts`, nối vào nhân vật qua `lib/useVrmMotion.ts`.

⚠️ **Bộ "VRMA_MotionPack" chính thức của pixiv KHÔNG được đưa vào repo.** Điều khoản của nó cấm
*"distributing these motions or their alterations without permission in a way that can be rigged
or extracted"* — đặt file vào repo hay release là đúng hành vi đó. User tự tải rồi dùng nút "Nạp
file .vrma" thì hợp lệ, đó là chuyện giữa họ và pixiv.

**Đường hợp lệ app đang hỗ trợ** (v0.4.4), gồm đúng ba việc và không hơn:

1. **Chỉ chỗ** — dòng chữ dưới hai nút nạp, link tới <https://vroid.booth.pm/items/5512385> (shop
   chính thức "VRoid Project", miễn phí, đúng bộ 7 clip). App **không** tải hộ.
2. **Nạp cả thư mục** — `VRM_PICK_ANIMATION_DIR` quét **một cấp**, lọc `.vrma` (không phân biệt
   hoa thường: bộ tải trên Windows hay ra `.VRMA`), trần `VRMA_DIR_MAX_FILES` = 60 file. Nội dung
   clip giữ **trong state renderer, KHÔNG ghi xuống đĩa** — chép vào `userData` là tạo thêm một
   bản nữa trong thư mục app, đúng cái điều khoản cấm.
3. **Gán vai trò + nhớ qua phiên** — file `vrm-folder-motions.json` ở `userData` chỉ chứa
   **đường dẫn thư mục** và map `tên file → vai trò`; `VRM_RELOAD_ANIMATION_DIR` đọc lại lúc panel
   dựng xong. Vai trò gán được: `idle`/`chat`/`poke`/`alert`/`recover`/`inspect` — **không có
   `manual`** vì không gán gì đã là "chỉ chạy khi bấm".

**Hai nguồn clip đi CHUNG một cơ chế ưu tiên.** `useVrmMotion.play()` xét `PRIORITY` + mốc `until`
TRƯỚC khi chọn clip, rồi mới thử nguồn thư mục (`runFolder`) và cuối cùng rơi về danh mục CC0.
Làm hai cơ chế song song thì clip cảnh báo của nguồn này sẽ cắt ngang clip cảnh báo của nguồn kia
và không bên nào biết bên nào đang chạy. **Clip user gán THẮNG clip CC0 cùng vai trò** — gán tay là
lựa chọn tường minh, mà vẫn chạy clip mặc định thì việc gán vô nghĩa.

⚠️ `playAnimation` nay trả **`number`** (thời lượng clip, giây) thay vì `void`: clip trong danh mục
có `durationSec` đo sẵn, clip tự nạp thì không — thiếu con số đó thì không hẹn được giờ trả quyền
về lớp tự sinh và nhân vật đứng nguyên tư thế cuối clip mãi mãi. Đọc từ chính file là nguồn duy
nhất đúng, và stage vốn đã có nó trong tay (`clip.duration`).

⚠️ **Đường KHÔNG được làm**: app tự tải từ URL của pixiv về `userData`. Nghe như "user vẫn là
người tải" nhưng thực chất là tự động hoá việc lấy file và đưa vào kho của app. Muốn làm thì phải
xin phép pixiv trước (form ở cuối Readme của bộ đó).

Lưu ý điều khoản **cho phép dùng thương mại** (chỉ cần ghi credit `Animation credits to pixiv
Inc.'s VRoid Project`) — vướng mắc không nằm ở chỗ app này là sản phẩm, mà chỉ ở chỗ *phát tán
lại file*.

### Nơi tải: Release của chính repo này

App tải từ **Release của repo này**, tag `vrm-motions-v1`, mirror là nguồn cũ:

```
https://github.com/xShiroeNguyenx/infra-companion/releases/download/vrm-motions-v1/<id>.vrma
mirror: https://raw.githubusercontent.com/SanHsien/voxavatar/main/public/assets/animations/<id>.vrma
```

**Vì sao đổi**: bản trước trỏ thẳng vào `raw.githubusercontent.com` của repo bên thứ ba
`SanHsien/voxavatar`. Đó đúng là điều mục 10.2 đã cảnh báo — repo đó đổi tên, xoá file, đổi
branch `main` hay chuyển private là **cả 13 clip chết ngay với mọi bản đã cài**, và không có gì
mình làm được. Khác model mẫu, `.vrma` khi đó còn **không có mirror** nên hỏng là hỏng hẳn.
Giấy phép CC0 cho phép host lại, nên host lại. Nguồn cũ giữ làm mirror.

Mặt an toàn không đổi: `sha256` ghim trong source nên nguồn nào đưa file khác đều bị vứt — mirror
**không** nới lỏng bảo đảm nội dung, chỉ thêm đường tải.

**Đăng lên GitHub** (làm một lần, không lặp mỗi lần phát hành app):

File đã chuẩn bị sẵn: `D:\vrm\_release\motions\` — 13 file, 4.206.596 byte, sha256 đã đối chiếu
khớp hằng số trong code. Nếu cần làm lại từ đầu thì tải từ mirror rồi kiểm:

```bash
IDS="idle-01 drink-water speaking-01 pose-motion failed-apology success-cheer review-phone
     reaction-startle airplane-02 walk run-slow exercise-step airplane-05"
for id in $IDS; do
  curl -sL -o "$id.vrma" "https://raw.githubusercontent.com/SanHsien/voxavatar/main/public/assets/animations/$id.vrma"
done
sha256sum *.vrma    # đối chiếu từng dòng với hằng số trong packages/shared/src/vrmMotion.ts
```

Qua trang web (máy này chưa cài `gh` CLI):

1. Mở https://github.com/xShiroeNguyenx/infra-companion/releases/new
2. Ô **Choose a tag**: gõ `vrm-motions-v1` rồi bấm **Create new tag: vrm-motions-v1 on publish**
3. **Release title**: `Thư viện chuyển động VRMA`
4. **Describe this release**:
   ```
   13 clip chuyển động .vrma (CC0) cho tính năng trợ lý ảo 3D.
   Tác giả: へすい / rerofumi · sashii · JenJell. Giấy phép: CC0 1.0.
   https://booth.pm/ja/items/5527394
   https://booth.pm/ja/items/6412084
   https://booth.pm/ja/items/7861818
   ```
5. Kéo thả **cả 13 file** trong `D:\vrm\_release\motions\` vào ô **Attach binaries**
6. Chờ tải xong rồi bấm **Publish release**

Lệnh tương đương nếu có `gh` CLI:

```bash
gh release create vrm-motions-v1 D:/vrm/_release/motions/*.vrma \
  --title "Thư viện chuyển động VRMA" \
  --notes "13 clip .vrma (CC0) — rerofumi · sashii · JenJell"
```

Kiểm sau khi đăng — **phải đủ 13 dòng có `content-length`**, thiếu file nào thì clip đó rơi về
mirror (vẫn chạy, nhưng mất đúng cái vừa sửa):

```bash
for id in $IDS; do
  printf "%-18s " "$id"
  curl -sIL "https://github.com/xShiroeNguyenx/infra-companion/releases/download/vrm-motions-v1/$id.vrma" \
    | grep -i "^content-length" | tail -1
done
```

**Tag tách riêng là cố ý**, cùng lý do như `vrm-sample-v1`: bộ clip không đổi theo phiên bản app,
gắn vào tag phát hành thì mỗi lần ra bản mới lại phải đính kèm 4 MB đó thêm một lần.

**Vai trò clip** (`VrmMotionRole`): `idle` · `chat` · `poke` · `alert` · `recover` · `inspect` ·
`manual`. Vai trò `idle` có **nhiều clip luân phiên** — xoay vòng qua `nextMotionForRole`, không
bốc ngẫu nhiên vì ngẫu nhiên sẽ ra cùng một clip hai ba lần liền.

**Ba điều bắt buộc khi thêm clip mới:**

1. **Đo `sha256` và `durationSec` từ chính file đã tải**, đừng chép từ mô tả. Nhiều clip không khai
   `min`/`max` trong accessor nên phải đọc thẳng buffer mới ra thời lượng thật.
2. **Đo bề ngang lúc clip chạy.** Khung hình chỉ rộng `WIDTH_MARGIN` (2,2×) so với tư thế đứng —
   clip rộng hơn thế bị cắt tay. Đo được: xem điện thoại 0,92× · đứng thư giãn 1,32× · tạo dáng
   1,92× · ăn mừng 2,16× · **máy bay 3,55×** (vì vậy máy bay chỉ ở nhóm `manual`).
3. **Kiểm clip có dời nhân vật đi không.** Đo `hips` translation: `reaction-startle` dời **53 cm
   ngang, 97 cm sau**. Clip tự chạy luôn bật `anchor: true` để ghim tại chỗ; chỉ clip
   `locomotion` do user chọn tay mới được đi.

**Chạy một lần rồi trả quyền** (`playAnimation(bytes, { once: true })`): stage tự gỡ mixer khi hết
clip. Dùng đồng hồ chứ không nghe sự kiện `finished` — sự kiện đó chỉ dừng action, mixer vẫn treo
và lớp tự sinh vẫn bị bỏ qua, nhân vật đứng chết ở frame cuối.

⚠️ **Clip chạy = tắt toàn bộ lớp tự sinh** (nhìn theo chuột, kéo níu, tay đu quán tính). Chỉ chớp
mắt và biểu cảm còn chạy vì chúng nằm ngoài khối đó. Vì vậy clip `idle` chạy **thưa** (90–180s một
lần) chứ không lặp liên tục, và có trần 25s cho clip tự chạy.

---

## 11. Hình học bố cục — **đọc trước khi sửa bất cứ thứ gì bám cạnh nhân vật**

Mục này tồn tại vì **một** hiểu nhầm đã gây ra bốn lỗi riêng biệt mà user phải chụp màn hình báo.

### 11.1 Thẻ nhân vật rộng gấp 2,2 lần người

`vrmStage` đặt `aspect = measureDrawn × VRM_WIDTH_MARGIN ÷ frameH`, nên thẻ DOM của nhân vật
**rộng gấp `VRM_WIDTH_MARGIN` (2,2) lần thân người nhìn thấy**. Phần dư là **lề trong suốt** chừa
cho clip giang tay khỏi bị cắt (clip "máy bay" dang tay rộng 3,55× thân lúc đứng).

Đo trên một model thật (`aspect` 1,7875, zoom 0,55):

| | px |
|---|---|
| Thẻ (`width = H × aspect`) | **433** |
| Thân người (`measureDrawn`) | **197** |
| Lề trong suốt **mỗi bên** | **118** |

⚠️ **Mọi phép "bám mép / né cột / sát lề" trừ theo mép THẺ đều hụt đúng một lề vô hình.** Bốn lỗi
đã dính, cùng gốc này:

| Triệu chứng user thấy | Chỗ quên chia |
|---|---|
| Hai cột hai bên cách nhau rất xa | `anchorRect()` trả vùng thẻ |
| Nhân vật không sát cột chat khi mở dock | `window.innerWidth - dockW - width` |
| Lề phải mặc định "hở ra quá nhiều" | `CHROMELESS_RIGHT_GAP` đo từ mép thẻ |
| Kéo nhân vật "đụng tường" khi còn cách mép cả gang tay | hook kéo kẹp theo mép thẻ |

### 11.2 Ba hàm phải dùng, đừng tự tính lại

Ở `packages/shared/src/vrmFraming.ts` (hàm thuần → **test được**; để inline trong JSX thì vitest
không quét, đó đúng là lý do bốn lỗi trên không có test nào chặn):

| Hàm | Trả về |
|---|---|
| `vrmBodyRect(cardRect)` | Vùng **thân người** từ vùng thẻ. Chia bề ngang cho 2,2, giữ nguyên tâm và chiều cao (lề chỉ chừa hai bên). |
| `vrmSideMargin(cardWidth)` | Lề trong suốt **một bên** — cộng lại khi cần mép thân từ mép thẻ. |
| `vrmLeftBesideDock(posX, cardW, dockW, viewportW)` | `left` để thân người **chạm** mép cột dock AI. |

`vrmLeftBesideDock` là phép **HÚT SÁT**, không phải phép chặn: mở dock là nhân vật dời tới cạnh
cột bất kể đang đứng đâu; đóng dock thì về chỗ user đã kéo (vị trí lưu không bị ghi đè vì thẻ
`pointer-events-none` lúc dock mở). Bản đầu dùng `Math.min` nên nhân vật đứng giữa màn hình không
lấn dock thì đứng nguyên đó — user chụp lại "vẫn chưa sát".

### 11.3 `CHROMELESS_RIGHT_GAP` = 86, đo từ THÂN NGƯỜI

Lề phải ở vị trí mặc định. **Không** phải lề thẩm mỹ — nó là chỗ chừa cho hai thứ:

- cột chọn chuyển động rộng 96px, chờm lên người 18px, chừa 8px khỏi mép → `96 − 18 + 8 = 86`
- khung chat nhỏ 320px nổi trên đầu, căn giữa theo thân → cần `(320 − thân) ÷ 2` ≈ 62px

86 bao trọn cả hai. Nơi dùng phải **trừ `vrmSideMargin`** vì `right` đặt mép thẻ; số âm là đúng và
an toàn (phần thò ra ngoài cửa sổ chỉ là lề trong suốt).

### 11.4 Hai cột `VrmSidePanel`

- `W = 112px` — từng là 96px hồi mỗi mục còn là dòng chữ trần; nay mỗi mục là thẻ có viền +
  padding nên 96px chỉ còn ~76px cho chữ và "Bước thể dục" xuống ba dòng.
- `OVERLAP_MIN = 18px` — chờm lên **thân người thật** (6,8% mỗi bên), đủ hết khoảng hở mà hai cột
  vẫn nằm ngoài vai. Nền cột trong mờ nên vẫn thấy nhân vật phía sau.
- Chiều cao **co theo nội dung** nhưng là **một** con số cho cả hai cột: `items` chia đôi mà lẻ thì
  cột trái nhiều hơn một mục, để mỗi cột tự co là ra hai khối cao thấp lệch nhau.
- Dời **cả cặp** khi chạm mép cửa sổ, không kẹp từng cột: nhân vật hay đứng sát mép phải, kẹp
  riêng sẽ đẩy cột phải ngược vào giữa người (đo được che 43–76% thân).
- Thanh cuộn ẩn bằng class `.scroll-hidden` ở `styles/main.css`. ⚠️ **Chỉ `::-webkit-scrollbar`,
  KHÔNG `scrollbar-width: none`** — Chromium ≥121 thấy `scrollbar-width` là vô hiệu hoá toàn bộ
  `::-webkit-scrollbar-*` trên element đó, kết quả ngược hẳn ý định (thanh native to đùng).

---

## 12. Bảng cài đặt — cấu trúc và cách thêm mục

Style mượn từ project `desktop-companion` (`app/settings.html` + `app/media/companion.css`), giữ
màu theo `--c-accent` của theme user đang chọn.

### 12.1 Ba component dùng chung

Ở `VrmSettingsFrame.tsx` — **không** tách file riêng, vì file đó cố ý chỉ phụ thuộc `react` +
`@infra/shared` để harness bundle được bằng esbuild:

| Component | Dùng cho |
|---|---|
| `SettingsGroup` | Nhóm có tiêu đề in hoa 10px + đường kẻ. |
| `SettingsToggle` | Hàng công tắc có khung; cả hàng là `<label>` nên bấm chữ cũng tick. |
| `SettingsField` | Trường có nhãn nhỏ phía trên (dropdown, thanh trượt). |

### 12.2 `only` — một component, bốn lần gọi

`VrmControls` nhận `only: 'left' | 'right' | 'footer' | undefined`:

| Giá trị | Trả về |
|---|---|
| `'left'` | Hiển thị · Thông báo · Thao tác |
| `'right'` | Trợ lý ảo (info + chọn model) · Chuyển động |
| `'footer'` | Hai nút hành động — **một hàng ngang** |
| `undefined` | Tất cả, xếp chồng (chế độ panel nhỏ) |

⚠️ Hai tên `'left'`/`'right'` là tên **NỘI DUNG**, không phải vị trí. Đổi chỗ hai cột thì đổi ở
nơi gọi `VrmSettingsFrame`; đừng đổi tên chúng theo vị trí, lần hoán đổi sau là tên lại sai.

⚠️ `'footer'` **không được bọc thêm thẻ nào** (`Wrap plain` lo việc này). Thanh chân đã có
`flex justify-end` của khung; bọc một `flex-col` vào là hai nút xếp chồng chiếm hết bề ngang.

⚠️ **Mở rộng union `only` thì phải rà lại MỌI phép `!==` trên nó.** Thêm `'footer'` mà quên
`only !== 'right'` ở chỗ render `ModelInfo` → URL giấy phép trải ngang cả màn hình.

### 12.3 Cân hai cột

Cột trái gần như đứng yên, cột **phải** mới phình theo nội dung (số clip user nạp). Thêm khối mới
thì đo lại bằng harness `cols.cjs`; lệch dưới ~15% là chấp nhận được.

Chuỗi dài phải có **`min-w-0` trên chính thẻ cha**, không chỉ `truncate` trên dòng con: `truncate`
chỉ cắt khi tổ tiên gần nhất cho phép co lại. URL giấy phép của model có cái dài 200+ ký tự (chuỗi
query kể hết mọi quyền) và nó đẩy cả cột rộng ra.

---

## 13. Clip `.vrma` — hai nguồn, một cơ chế

### 13.1 Nguồn 1: danh mục CC0 (`vrmMotion.ts`)

13 clip, tải theo yêu cầu vào `userData/vrm-motions/`. Mỗi clip có `id`, `role`, `durationSec` đo
sẵn, `sha256` ghim. Tải từ **Release của chính repo** (tag `vrm-motions-v1`), mirror là nguồn cũ —
xem mục 10.3.

### 13.2 Nguồn 2: thư mục user tự nạp

User trỏ vào thư mục `.vrma` của họ; app **chỉ đọc, không chép**. Lý do là giấy phép — xem 10.3.

- `VRM_PICK_ANIMATION_DIR` quét **một cấp** (đệ quy vào ổ đĩa là treo hàng chục giây không dấu
  hiệu), lọc qua `pickVrmaNames()` (**`.toLowerCase()`** — bộ tải trên Windows hay ra `.VRMA`),
  trần `VRMA_DIR_MAX_FILES` = 60 **cắt trước khi đọc**.
- `VRM_RELOAD_ANIMATION_DIR` đọc lại thư mục đã nhớ lúc panel dựng xong.
- `vrm-folder-motions.json` giữ **đường dẫn + `tên file → vai trò`**. Khoá là tên file chứ không
  phải chỉ số: user thêm/bớt file thì chỉ số trượt hết.
- `cleanFolderMotions()` **bỏ** vai trò lạ. Giữ nguyên thì clip đó im lặng không bao giờ chạy và
  user không có cách nào biết vì sao.

### 13.3 Gán ĐÈ vai trò cho clip CC0

Vai trò trong `VRM_MOTIONS` là **mặc định**, không phải cố định. User đổi được ngay trong bảng
cài đặt — trước đây chỉ clip tự nạp mới gán được, cùng một việc mà hai luật.

- Lưu ở `vrm-folder-motions.json` → `builtinRoles`, khoá là **`id`** (`idle-01`, `pose-motion`…)
  chứ không phải tên file: danh mục định danh bằng id, và id không đổi kể cả khi đổi nơi tải.
- Nhận thêm giá trị **`manual`** — khác `roles` của clip tự nạp. Clip tự nạp không gán gì đã là
  "chỉ chạy khi bấm"; clip CC0 thì CÓ vai trò sẵn nên phải có cách nói "đừng tự chạy nữa".
- ⚠️ **Chỉ ghi khoá cho clip user thật sự đổi.** Ghi cả 13 khoá "cho đủ" là đóng băng mọi người ở
  giá trị hôm nay — lần sau sửa vai trò mặc định trong code sẽ không tới được ai.

**Một chỗ duy nhất** quyết định vai trò hiệu lực: `effectiveRole(clip, overrides)`. `motionsForRole`
và UI đều gọi vào đó; để hai nơi tự đọc `overrides` là chờ chúng lệch nhau, mà lệch ở đây nghĩa là
dropdown hiện một đằng còn clip chạy một nẻo.

⚠️ `run()` trong `useVrmMotion` phải ghi `effectiveRole(...)` vào `current.current`, **không phải
`clip.role`**: gán "Khi có cảnh báo" cho một clip vốn là `idle` mà `PRIORITY` vẫn tính là idle thì
nó bị mọi thứ khác cắt ngang ngay. Bảng override đọc qua `overridesRef` (ref, không phải deps) —
thêm `folder` vào deps của `run` là hàm mới mỗi lần state panel đổi.

### 13.4 Phản ứng theo LOẠI VIỆC (`vrmActivity.ts`)

Mở công cụ nào thì nhân vật làm ba việc: chạy clip, đổi biểu cảm, nói một câu.

- `TOOL_ACTIVITY` ánh xạ **id công cụ** (trong `toolCatalog.ts`) → một trong **6 loại việc**:
  `bulk` · `transfer` · `logs` · `security` · `monitor` · `inspect`.
- Gộp theo loại chứ không phải từng công cụ: 45 vai trò là dropdown không ai đọc hết, mà mở "Xem
  log" hay "Tail log" thì phản ứng cũng như nhau.
- **Công cụ ngoài bảng thì im** — cố ý. Diễn một màn cho mỗi cú bấm (kể cả mở Cài đặt) là nhiễu.
- Kích hoạt bằng cách nghe cờ `modal` của store, KHÔNG móc vào từng nút: mỗi công cụ mở được từ
  sidebar, lưới công cụ, bảng lệnh và vòng công cụ của nhân vật — móc từng chỗ là bốn chỗ để quên.

⚠️ **Ba bảng phải khớp nhau**, có test chốt cả ba:
1. `ACTIVITY_LABELS` (nhãn loại việc) ↔ `VRM_ROLE_LABELS` (dropdown gán clip) — lệch nhau thì user
   gán "Khi xem log" rồi mở công cụ log mà clip không chạy, không gì chỉ ra vì sao.
2. Id trong `TOOL_ACTIVITY` phải là id **có thật** — gõ nhầm `log_tail` thì `activityForTool` trả
   `null` và im lặng, không lỗi nào báo.
3. `ACTIVITY_EXPRESSION` phải kết thúc bằng `'neutral'` — model VRM khai biểu cảm rất khác nhau,
   thiếu một cái chắc chắn tồn tại ở cuối thì model không có `happy` sẽ không đổi biểu cảm gì cả.

Thêm loại việc mới thì sửa **năm** chỗ: `VrmActivity`, `ACTIVITY_LABELS`, `ACTIVITY_EXPRESSION`,
`ACTIVITY_LINES`, và `VrmMotionRole` + `VrmMotionRoleName` + `VRM_ROLE_LABELS` + `PRIORITY`.
Test sẽ đỏ nếu thiếu chỗ nào.

### 13.5 Hai nguồn đi CHUNG luật ưu tiên

`useVrmMotion.play(role)` theo đúng thứ tự:

1. Xét `PRIORITY` + mốc `until` — **trước** khi chọn clip. Làm hai cơ chế song song thì clip cảnh
   báo của nguồn này cắt ngang clip cảnh báo của nguồn kia và không bên nào biết bên nào đang chạy.
2. Thử `runFolder(role)` — **clip user gán THẮNG** clip CC0 cùng vai trò. Gán tay là lựa chọn
   tường minh; vẫn chạy clip mặc định thì việc gán vô nghĩa.
3. Rơi về `nextMotionForRole(...)` của danh mục CC0.

⚠️ `stage.playAnimation()` trả về **`number`** (thời lượng clip, giây), không phải `void`. Clip
danh mục có `durationSec` đo sẵn, clip tự nạp thì không — thiếu con số đó thì không hẹn được giờ
trả quyền về lớp tự sinh và nhân vật đứng nguyên tư thế cuối clip mãi mãi.

---

## 14. Danh sách lỗi đã sửa, để không lặp lại

| Triệu chứng | Nguyên nhân thật |
|---|---|
| Model lag, kéo giật, tưởng model lỗi | `Raycaster` trên skinned mesh, 277 ms mỗi lần gọi |
| Chỉ eo trở lên phản ứng khi kéo | Lực kéo chỉ cộng vào cột sống/ngực/đầu |
| Chân lệch xuống, xuyên thanh trạng thái | Hạ hông = hạ gốc bộ xương |
| Không thấy gối nhún | Biên độ 0.3 chỉ cho 4,8 độ |
| Chân trượt như đứng trên băng | Xoay đùi làm cả chân đu như con lắc |
| Tay đơ ở cùi chỏ | Vector định hướng khuỷu là hằng số |
| Khuỷu chìa ra như chống nạnh | `poleOut` 0.7 quá cao |
| Tay chỉ thẳng lên trời ở VRM 0.x | Thiếu `restQ` trong công thức ghi xương |
| Nhân vật như bị treo cổ | Xoay `hips.rotation.z` lúc đứng yên |
| Đầu giật 31 độ khi click | Tầng thấp giành nhóm xương của tầng idle |
| Chuyển động nhanh gấp đôi ở 60 FPS | Nội suy theo frame thay vì theo thời gian |
| Câu tiếng Việt có dấu không nhận lệnh | `\b` của JS chỉ biết ASCII |
| Tích vào ô "Hiện lúc mở app" không ăn | `setPointerCapture` làm đứt chuỗi sinh `click` |
| Ctrl+R làm mất hết tab | Menu mặc định của Electron nuốt phím trước trang |
| Đổi model báo lỗi `precision` | `forceContextLoss` giết vĩnh viễn canvas cũ |
| Khung hình rộng gấp đôi | `Box3` đo theo bind pose (T-pose, tay giang) |
| Bảng cài đặt văng khỏi tâm, co theo thanh cỡ, mờ theo nhân vật | Bảng là **con** của thẻ nhân vật có `transform: scale()` + `opacity` — `fixed` của con tính theo cha |
| Kéo thanh cỡ mà người y nguyên | Co theo `khe ÷ bề ngang thẻ`, mà thẻ = H × tỉ lệ ⇒ chiều cao hiển thị = khe ÷ tỉ lệ, H triệt tiêu |
| Kéo "đụng tường" khi người còn cách mép cả gang | Thẻ rộng gấp 2,2 lần người (`VRM_WIDTH_MARGIN`); hook kẹp theo mép thẻ |
| Một model ra thẻ rộng bằng chiều cao | `measureDrawn` vẽ khung vuông nên bề ngang bão hoà ở `frameH` |
| Nhân vật thò đáy 22px, lệch phải 62px trong khung | Tính `left/top` theo kích thước **đã co**; `transform-origin: bottom center` giữ đáy và tâm của thẻ **gốc** |
| Đổi model làm mất bảng cài đặt | Trạng thái `loading` bị coi là "không có nhân vật" → effect dọn mọi lớp nổi |
| Hai cột hai bên cách nhau rất xa | `anchorRect()` trả vùng **thẻ**, mà thẻ rộng gấp 2,2 lần người → hai cột cách nhau đúng bề ngang thẻ |
| Nhân vật không sát cột chat khi mở dock AI | Cùng gốc: trừ theo mép thẻ. Và bản đầu chỉ **chặn** (`Math.min`) nên nhân vật đứng giữa màn hình thì đứng nguyên đó — phải là phép **hút sát** |
| Lề phải mặc định "hở ra quá nhiều" | `CHROMELESS_RIGHT_GAP` đo từ mép thẻ; với model rộng thành 210px thay vì 86px |
| URL giấy phép trải ngang cả màn hình | `truncate` không ăn vì thiếu **`min-w-0` trên thẻ cha**; URL của model có cái dài 200+ ký tự |
| Hai nút thanh chân xếp chồng, chiếm hết bề ngang | `controls()` bọc `<div flex-col>` quanh **cả** footer, mà footer là hàng ngang |
| `ModelInfo` lọt vào thanh chân | Mở rộng union `only` thêm `'footer'` mà quên rà lại `only !== 'right'` |
| Ẩn thanh cuộn lại ra thanh **native to hơn** | `scrollbar-width: none` làm Chromium ≥121 vô hiệu hoá toàn bộ `::-webkit-scrollbar-*` |
| Tên clip xuống 2–3 dòng trong cột | Emoji 🚶 rộng gần 2 ký tự và không ngắt dòng chung với chữ; cột chỉ 112px |
| Clip user tự nạp đứng nguyên tư thế cuối mãi mãi | `playAnimation` trả `void` nên không có `durationSec` để hẹn giờ trả quyền về lớp tự sinh |
| Thư mục `.vrma` báo "không có file nào" dù nhìn rõ là có | So đuôi trần, không `.toLowerCase()` — bộ tải trên Windows hay ra `.VRMA` |
| Nhân vật ngoài desktop chỉ hiện **lần đầu**, sau đó im | Renderer overlay chết nhưng `win.isDestroyed()` vẫn `false` và `ready` vẫn `true` → `flush()` gửi IPC vào hư không rồi hiện một **cửa sổ trong suốt rỗng**, main báo thành công (§7.3) |
| Mở trợ lý ảo lần đầu (chưa có model) là **kẹt, không thoát được** | Khung `w-80` không cuộn + `controls` đổ cả bảng cài đặt vào dưới `StartScreen` ⇒ nút `✕ Tắt trợ lý ảo` ở cuối `footer` bị cắt khỏi màn hình (§7.6) |
