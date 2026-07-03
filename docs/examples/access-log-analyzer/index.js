// Plugin "Access Log Analyzer" — gõ 1 lệnh vào phiên SSH đang mở, gom output,
// hiện 6 thông số phân tích access log trong panel markdown.
//
// Cách hoạt động: lệnh shell in kết quả kèm các marker @ALOG:...@; plugin observe
// output của đúng phiên đó, thấy marker END thì parse và mở panel.
'use strict'

// ===== Cấu hình — sửa xong bấm Reload trong ⋯ → 🧩 Plugins =====
const LOG_PATH = '/etc/httpd/logs/ssl_access_log'
const SAMPLE_LINES = 50000 // chỉ phân tích N dòng cuối — log to vẫn nhanh
const TIMEOUT_MS = 30000

// Marker nhận diện output thật. Trong lệnh gửi đi token luôn bị TÁCH ĐÔI
// (echo "@ALO""G:BEGIN@") nên dòng lệnh được terminal echo lại không bao giờ chứa
// token đầy đủ — chỉ output do shell thực thi mới có.
const TOK = (s) => `@ALOG:${s}@`
const BEGIN = TOK('BEGIN')
const END = TOK('END')

const SECTIONS = [
  { tok: TOK('S1'), title: '1. Top 15 IP gọi nhiều nhất' },
  { tok: TOK('S2'), title: '2. Request theo phút (30 mốc gần nhất)' },
  { tok: TOK('S3'), title: '3. Top 15 URL bị gọi' },
  { tok: TOK('S4'), title: '4. Top 10 User-Agent' },
  { tok: TOK('S5'), title: '5. Phân bố status code' },
  { tok: TOK('S6'), title: '6. IP nghi vấn nhất đang gọi gì' }
]

/** echo token nhưng tách đôi chuỗi để dòng lệnh echo lại không chứa token đầy đủ. */
function emit(token) {
  const mid = Math.floor(token.length / 2)
  return `echo "${token.slice(0, mid)}""${token.slice(mid)}"`
}

/** Một dòng shell duy nhất: tail ra file tạm rồi tính 6 thông số, có marker từng mục.
 *  CẤM ký tự "!" trong lệnh gửi đi: bash tương tác history-expand toàn bộ dòng TRƯỚC
 *  khi chạy ("event not found" → hủy cả dòng) — set +H đặt cùng dòng cũng không cứu. */
function buildRemoteCmd() {
  return [
    `L=${LOG_PATH}`,
    `T=/tmp/.alog$$`,
    `tail -n ${SAMPLE_LINES} "$L" > "$T" 2>/dev/null`,
    emit(BEGIN),
    `[ -s "$T" ] || echo "(x) Khong doc duoc $L - kiem tra duong dan/quyen (can root?)"`,
    emit(SECTIONS[0].tok),
    `awk '{print $1}' "$T" | sort | uniq -c | sort -rn | head -15`,
    emit(SECTIONS[1].tok),
    `awk -F'[' '{print substr($2,1,17)}' "$T" | uniq -c | tail -30`,
    emit(SECTIONS[2].tok),
    `awk '{print $7}' "$T" | sort | uniq -c | sort -rn | head -15`,
    emit(SECTIONS[3].tok),
    `awk -F'"' '{print $6}' "$T" | sort | uniq -c | sort -rn | head -10`,
    emit(SECTIONS[4].tok),
    `awk '{print $9}' "$T" | sort | uniq -c | sort -rn | head -10`,
    emit(SECTIONS[5].tok),
    `IP=$(awk '{print $1}' "$T" | sort | uniq -c | sort -rn | awk 'NR==1{print $2}')`,
    `echo "IP: $IP"`,
    `grep "^$IP " "$T" | awk '{print $7}' | sort | uniq -c | sort -rn | head -10`,
    `rm -f "$T"`,
    emit(END)
  ].join('; ')
}

/** Bỏ escape sequence ANSI/OSC + \r để parse text sạch. */
function stripAnsi(s) {
  return s
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '') // OSC (đổi title…)
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '') // CSI (màu, di chuyển con trỏ…)
    .replace(/\x1b[@-Z\\-_]/g, '') // ESC đơn
    .replace(/\r/g, '')
}

/** Cắt phần giữa BEGIN..END rồi tách nội dung từng mục theo marker. */
function parseSections(clean) {
  const b = clean.indexOf(BEGIN)
  const e = clean.indexOf(END)
  if (b < 0 || e < 0 || e <= b) return null
  const body = clean.slice(b + BEGIN.length, e)
  return SECTIONS.map((s, i) => {
    const from = body.indexOf(s.tok)
    if (from < 0) return { title: s.title, content: '(không có dữ liệu)' }
    const next = i + 1 < SECTIONS.length ? body.indexOf(SECTIONS[i + 1].tok) : body.length
    const content = body.slice(from + s.tok.length, next < 0 ? body.length : next).trim()
    return { title: s.title, content: content || '(trống)' }
  })
}

function buildMarkdown(sections) {
  const parts = [
    `# 📊 Access log — 6 thông số`,
    ``,
    `File: \`${LOG_PATH}\` · mẫu: ${SAMPLE_LINES.toLocaleString('vi')} dòng cuối · ${new Date().toLocaleString('vi')}`,
    ``
  ]
  for (const s of sections) {
    parts.push(`## ${s.title}`, '', '```', s.content, '```', '')
  }
  parts.push(
    `## Cách đọc nhanh`,
    ``,
    `- Mục 1: một vài IP **chiếm áp đảo** → scraper/tấn công một nguồn → \`whois\` rồi chặn firewall/fail2ban.`,
    `- Mục 2: xem đột biến bắt đầu **từ phút nào** để đối chiếu sự kiện (deploy, cron, chiến dịch marketing).`,
    `- Mục 3: dồn vào **một endpoint nặng** (search/export/API) → nghi client tích hợp lỗi gọi lặp.`,
    `- Mục 4: UA \`curl\`/\`python-requests\`/scrapy → bot; Googlebot/Bingbot → chỉnh robots.txt là đủ.`,
    `- Mục 5: nhiều **404/403** dồn dập → scanner dò lỗ hổng.`,
    `- Mục 6: IP đứng đầu đang gọi gì — pattern lặp 1 URL vô nghĩa là chữ ký tấn công.`,
    ``,
    `**⚠ Lưu ý:** sau CDN/load-balancer thì cột IP là IP của proxy — phải lấy từ header \`X-Forwarded-For\`.`
  )
  return parts.join('\n')
}

/** Trạng thái 1 lần chạy — plugin chỉ cho 1 phân tích tại một thời điểm. */
let run = null

function cleanupRun() {
  if (!run) return
  if (run.off) run.off()
  clearTimeout(run.timer)
  run = null
}

module.exports.activate = (api) => {
  api.commands.register('alog.analyze', 'Access log: Phân tích 6 thông số', async (ctx) => {
    const sessionId = ctx.activeSessionId || (await api.terminal.getActiveSessionId())
    if (!sessionId) {
      await api.ui.notify('Không có phiên terminal đang mở — SSH vào server trước đã')
      return
    }
    if (run) {
      await api.ui.notify('Đang có một phân tích chạy dở — đợi xong đã')
      return
    }

    let buf = ''
    run = {
      timer: setTimeout(() => {
        cleanupRun()
        void api.ui.notify('Access log: quá hạn 30s — phiên có đang ở shell prompt không?')
      }, TIMEOUT_MS),
      off: null
    }
    run.off = api.terminal.onData(({ sessionId: sid, data }) => {
      if (!run || sid !== sessionId) return
      buf += data
      // strip trước khi tìm END — phòng terminal chèn escape giữa chừng
      const clean = stripAnsi(buf)
      if (!clean.includes(END)) return
      const sections = parseSections(clean)
      cleanupRun()
      if (!sections) {
        void api.ui.notify('Access log: không parse được output')
        return
      }
      void api.ui.showPanel({ title: `Access log — ${LOG_PATH}`, markdown: buildMarkdown(sections) })
    })

    // Gõ lệnh vào phiên (hiện trong terminal — chủ ý, để thao tác minh bạch)
    await api.terminal.write(sessionId, buildRemoteCmd() + '\n')
  })

  api.log(`access-log-analyzer sẵn sàng (log: ${LOG_PATH})`)
}

module.exports.deactivate = () => {
  cleanupRun()
}
