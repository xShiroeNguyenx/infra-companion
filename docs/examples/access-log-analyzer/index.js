// Plugin "Access Log Analyzer" — gõ 1 lệnh vào phiên SSH đang mở, gom output,
// hiện 7 thông số phân tích access log trong panel markdown.
//
// Cách hoạt động: lệnh shell in kết quả kèm các marker @ALOG:...@; plugin observe
// output của đúng phiên đó, thấy marker END thì parse và mở panel.
// Panel hiện LỆNH của từng mục + nút [↻ Chạy lại] / [✎ Sửa lệnh] per mục
// (link `cmd:` trong markdown gọi ngược về command của plugin, kèm arg = số mục).
'use strict'

// ===== Cấu hình — sửa xong bấm Reload trong ⋯ → 🧩 Plugins =====
// Đường dẫn mặc định — khi chạy lệnh sẽ hiện hộp nhập, bỏ trống thì dùng giá trị này.
const DEFAULT_LOG_PATH = '/etc/httpd/logs/ssl_access_log'
const SAMPLE_LINES = 50000 // chỉ phân tích N dòng cuối — log to vẫn nhanh
const TIMEOUT_MS = 30000
// Chỉ cho ký tự an toàn trong đường dẫn — chặn khoảng trắng/ký tự phá lệnh shell một dòng.
const PATH_RE = /^[A-Za-z0-9._/-]+$/

// ===== Vị trí cột =====
// Log combined chuẩn:  IP=$1, URL=$7, status=$9                       → offset 0
// Log custom có vhost:port đứng ĐẦU dòng
//   ("www.site.com:443 1.2.3.4 - - [...]")  → mọi cột dịch +1          → offset 1
// 'auto' = tự dò theo dòng đầu file (cột 1 là IP thì 0, không phải thì 1).
// Format khác nữa thì đặt số cụ thể (2, 3…). Thời gian tách theo '[', User-Agent
// tách theo dấu '"' nên KHÔNG phụ thuộc offset.
const FIELD_OFFSET = 'auto'

// Marker nhận diện output thật. Trong lệnh gửi đi token luôn bị TÁCH ĐÔI
// (echo "@ALO""G:BEGIN@") nên dòng lệnh được terminal echo lại không bao giờ chứa
// token đầy đủ — chỉ output do shell thực thi mới có.
const TOK = (s) => `@ALOG:${s}@`
const BEGIN = TOK('BEGIN')
const END = TOK('END')

// Mỗi mục: title + lệnh MẶC ĐỊNH (đọc "$T" = file mẫu, "$O" = offset cột do preamble tính).
// Lệnh có thể bị user sửa qua nút ✎ trong panel (lưu overrides trong storage).
// CẤM ký tự "!" trong mọi lệnh: bash tương tác history-expand toàn bộ dòng TRƯỚC
// khi chạy ("event not found" → hủy cả dòng) — set +H đặt cùng dòng cũng không cứu.
const SECTIONS = [
  {
    tok: TOK('S1'),
    title: '1. Top 15 IP gọi nhiều nhất',
    cmd: `awk -v o="$O" '{print $(1+o)}' "$T" | sort | uniq -c | sort -rn | head -15`
  },
  {
    tok: TOK('S2'),
    title: '2. Request theo phút (30 mốc gần nhất)',
    cmd: `awk -F'[' '{print substr($2,1,17)}' "$T" | uniq -c | tail -30`
  },
  {
    tok: TOK('S3'),
    title: '3. Top 15 URL bị gọi',
    cmd: `awk -v o="$O" '{u=$(7+o); if (o>0) u=$1 u; print u}' "$T" | sort | uniq -c | sort -rn | head -15`
  },
  {
    tok: TOK('S4'),
    title: '4. Top 10 User-Agent',
    cmd: `awk -F'"' '{print $6}' "$T" | sort | uniq -c | sort -rn | head -10`
  },
  {
    tok: TOK('S5'),
    title: '5. Phân bố status code',
    cmd: `awk -v o="$O" '{print $(9+o)}' "$T" | sort | uniq -c | sort -rn | head -10`
  },
  {
    tok: TOK('S6'),
    title: '6. IP nghi vấn nhất đang gọi gì',
    cmd: [
      `IP=$(awk -v o="$O" '{print $(1+o)}' "$T" | sort | uniq -c | sort -rn | awk 'NR==1{print $2}')`,
      `echo "IP: $IP"`,
      `awk -v o="$O" -v ip="$IP" '$(1+o)==ip{u=$(7+o); if (o>0) u=$1 u; print u}' "$T" | sort | uniq -c | sort -rn | head -10`
    ].join('; ')
  },
  {
    // Log custom có đuôi "| ... | ASN_ORGANIZATION: VNPT Corp" — tách theo chuỗi đó,
    // lấy phần sau (tên tổ chức, có khoảng trắng vẫn ổn vì là cuối dòng). Log không
    // có trường này (combined chuẩn) → NF==1 bị bỏ qua → in thông báo rồi thôi.
    tok: TOK('S7'),
    title: '7. Top 15 nhà mạng/tổ chức (ASN_ORGANIZATION)',
    cmd: [
      `R=$(awk -F'ASN_ORGANIZATION: ' 'NF>1{print $2}' "$T" | sort | uniq -c | sort -rn | head -15)`,
      `[ -n "$R" ] && echo "$R" || echo "(log khong co truong ASN_ORGANIZATION - bo qua muc nay)"`
    ].join('; ')
  }
]

/** echo token nhưng tách đôi chuỗi để dòng lệnh echo lại không chứa token đầy đủ. */
function emit(token) {
  const mid = Math.floor(token.length / 2)
  return `echo "${token.slice(0, mid)}""${token.slice(mid)}"`
}

/** Phần mở đầu chung: tail log ra file tạm + tính offset cột. */
function preamble(logPath) {
  const detectOffset =
    FIELD_OFFSET === 'auto'
      ? `O=$(awk 'NR==1{o=1; if ($1 ~ /^[0-9a-fA-F.:]+$/) o=0; print o; exit}' "$T")`
      : `O=${FIELD_OFFSET}`
  return [`L=${logPath}`, `T=/tmp/.alog$$`, `tail -n ${SAMPLE_LINES} "$L" > "$T" 2>/dev/null`, detectOffset]
}

/** Một dòng shell chạy TẤT CẢ các mục (cmds = lệnh hiệu lực từng mục, đã áp override). */
function buildFullCmd(logPath, cmds) {
  const parts = [...preamble(logPath), emit(BEGIN), emit(SECTIONS[0].tok)]
  parts.push(`[ -s "$T" ] || echo "(x) Khong doc duoc $L - kiem tra duong dan/quyen (can root?)"`)
  parts.push(cmds[0])
  for (let k = 1; k < SECTIONS.length; k++) {
    parts.push(emit(SECTIONS[k].tok), cmds[k])
  }
  parts.push(`rm -f "$T"`, emit(END))
  return parts.join('; ')
}

/** Một dòng shell chạy lại DUY NHẤT mục k với lệnh cmd. */
function buildOneCmd(logPath, k, cmd) {
  return [
    ...preamble(logPath),
    emit(BEGIN),
    emit(SECTIONS[k].tok),
    `[ -s "$T" ] || echo "(x) Khong doc duoc $L - kiem tra duong dan/quyen (can root?)"`,
    cmd,
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

/** Cắt phần giữa BEGIN..END rồi tách nội dung từng mục theo marker (mục vắng = null). */
function parseSections(clean) {
  const b = clean.indexOf(BEGIN)
  const e = clean.indexOf(END)
  if (b < 0 || e < 0 || e <= b) return null
  const body = clean.slice(b + BEGIN.length, e)
  return SECTIONS.map((s, i) => {
    const from = body.indexOf(s.tok)
    if (from < 0) return null
    let next = body.length
    for (let j = i + 1; j < SECTIONS.length; j++) {
      const at = body.indexOf(SECTIONS[j].tok)
      if (at >= 0) {
        next = at
        break
      }
    }
    return body.slice(from + s.tok.length, next).trim() || '(trống)'
  })
}

/** Trạng thái phân tích gần nhất — nguồn dữ liệu để vẽ panel + chạy lại từng mục. */
let lastRun = null // { logPath, sessionId, contents: string[] }
/** Lệnh user đã sửa per mục (persist qua storage key 'cmds'). */
let overrides = {}
/** Trạng thái 1 lần chạy — plugin chỉ cho 1 phân tích tại một thời điểm. */
let run = null

function effectiveCmd(k) {
  return typeof overrides[k] === 'string' && overrides[k] !== '' ? overrides[k] : SECTIONS[k].cmd
}

function cleanupRun() {
  if (!run) return
  if (run.off) run.off()
  clearTimeout(run.timer)
  run = null
}

function buildMarkdown() {
  const parts = [
    `# 📊 Access log — 7 thông số`,
    ``,
    `File: \`${lastRun.logPath}\` · mẫu: ${SAMPLE_LINES.toLocaleString('vi')} dòng cuối · ${new Date().toLocaleString('vi')}`,
    ``
  ]
  for (let k = 0; k < SECTIONS.length; k++) {
    const edited = typeof overrides[k] === 'string' && overrides[k] !== ''
    parts.push(
      `## ${SECTIONS[k].title}`,
      '',
      '```',
      `$ ${effectiveCmd(k)}`,
      lastRun.contents[k] ?? '(chưa chạy)',
      '```',
      `[↻ Chạy lại](cmd:alog.rerun?${k}) [✎ Sửa lệnh](cmd:alog.edit?${k})${edited ? ' *— lệnh đã sửa (Sửa lệnh → để trống = về mặc định)*' : ''}`,
      ''
    )
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
    `- Mục 7: traffic dồn về ASN **hosting/datacenter** (OVH, DigitalOcean, AWS, Tencent…) → gần như chắc bot, chặn theo dải ASN được; ASN **nhà mạng dân dụng** (VNPT, Viettel…) → user thật hoặc botnet thiết bị gia đình, chặn phải cẩn thận.`,
    ``,
    `**⚠ Lưu ý:** sau CDN/load-balancer thì cột IP là IP của proxy — phải lấy từ header \`X-Forwarded-For\`.`
  )
  return parts.join('\n')
}

/** Gõ cmdLine vào phiên, đợi END rồi parse; sectionIdx=null → cập nhật cả 6 mục. */
async function startRun(api, sessionId, cmdLine, sectionIdx) {
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
    const parsed = parseSections(clean)
    cleanupRun()
    if (!parsed) {
      void api.ui.notify('Access log: không parse được output')
      return
    }
    if (sectionIdx === null) {
      lastRun.contents = parsed.map((c) => c ?? '(không có dữ liệu)')
    } else if (parsed[sectionIdx] !== null) {
      lastRun.contents[sectionIdx] = parsed[sectionIdx]
    }
    void api.ui.showPanel({ title: `Access log — ${lastRun.logPath}`, markdown: buildMarkdown() })
  })

  // Gõ lệnh vào phiên (hiện trong terminal — chủ ý, để thao tác minh bạch)
  try {
    await api.terminal.write(sessionId, cmdLine + '\n')
  } catch (e) {
    cleanupRun()
    await api.ui.notify(`Access log: không gõ được vào phiên (${e.message}) — phiên đã đóng? Chạy lại phân tích đầy đủ.`)
  }
}

/** Validate lệnh user sửa — chặn thứ phá cơ chế 1-dòng + marker. */
function badCmdReason(cmd) {
  if (cmd.includes('!')) return 'lệnh chứa "!" — bash tương tác sẽ history-expand và hủy cả dòng'
  if (/[\r\n]/.test(cmd)) return 'lệnh phải nằm trên 1 dòng'
  if (cmd.includes('@ALOG')) return 'lệnh không được chứa chuỗi marker @ALOG'
  return null
}

module.exports.activate = async (api) => {
  const saved = await api.storage.get('cmds').catch(() => undefined)
  if (saved && typeof saved === 'object') overrides = saved

  api.commands.register('alog.analyze', 'Access log: Phân tích 7 thông số', async (ctx) => {
    const sessionId = ctx.activeSessionId || (await api.terminal.getActiveSessionId())
    if (!sessionId) {
      await api.ui.notify('Không có phiên terminal đang mở — SSH vào server trước đã')
      return
    }
    if (run) {
      await api.ui.notify('Đang có một phân tích chạy dở — đợi xong đã')
      return
    }

    // Hỏi đường dẫn log — bỏ trống dùng mặc định; Huỷ thì thôi. Nhớ lần nhập trước.
    const last = await api.storage.get('logPath').catch(() => undefined)
    const input = await api.ui.prompt({
      title: 'Access log — chọn file log',
      label: `Đường dẫn log (bỏ trống = ${DEFAULT_LOG_PATH})`,
      placeholder: DEFAULT_LOG_PATH,
      value: typeof last === 'string' ? last : ''
    })
    if (input === null) return // user bấm Huỷ
    const logPath = input.trim() || DEFAULT_LOG_PATH
    if (!PATH_RE.test(logPath)) {
      await api.ui.notify(`Đường dẫn không hợp lệ: ${logPath} — chỉ cho chữ, số, ".", "_", "/", "-"`)
      return
    }
    void api.storage.set('logPath', input.trim()).catch(() => undefined)

    lastRun = { logPath, sessionId, contents: SECTIONS.map(() => '(chưa chạy)') }
    const cmds = SECTIONS.map((_, k) => effectiveCmd(k))
    await startRun(api, sessionId, buildFullCmd(logPath, cmds), null)
  })

  // Nút [↻ Chạy lại] trong panel — arg = số mục (0-based).
  api.commands.register('alog.rerun', 'Access log: Chạy lại 1 mục (nút ↻ trong panel)', async (ctx) => {
    const k = Number(ctx.arg)
    if (!Number.isInteger(k) || k < 0 || k >= SECTIONS.length) {
      await api.ui.notify('Nút này dùng từ panel kết quả — chạy "Phân tích 7 thông số" trước')
      return
    }
    if (!lastRun) {
      await api.ui.notify('Chưa có phân tích nào — chạy "Phân tích 7 thông số" trước')
      return
    }
    if (run) {
      await api.ui.notify('Đang có một phân tích chạy dở — đợi xong đã')
      return
    }
    await startRun(api, lastRun.sessionId, buildOneCmd(lastRun.logPath, k, effectiveCmd(k)), k)
  })

  // Nút [✎ Sửa lệnh] trong panel — prompt điền sẵn lệnh hiện tại, sửa xong chạy lại mục đó.
  api.commands.register('alog.edit', 'Access log: Sửa lệnh 1 mục (nút ✎ trong panel)', async (ctx) => {
    const k = Number(ctx.arg)
    if (!Number.isInteger(k) || k < 0 || k >= SECTIONS.length) {
      await api.ui.notify('Nút này dùng từ panel kết quả — chạy "Phân tích 7 thông số" trước')
      return
    }
    if (!lastRun) {
      await api.ui.notify('Chưa có phân tích nào — chạy "Phân tích 7 thông số" trước')
      return
    }
    if (run) {
      await api.ui.notify('Đang có một phân tích chạy dở — đợi xong đã')
      return
    }
    const input = await api.ui.prompt({
      title: `Sửa lệnh — ${SECTIONS[k].title}`,
      label: 'Lệnh shell của mục này ("$T" = file mẫu, "$O" = offset cột; để trống = về mặc định)',
      placeholder: SECTIONS[k].cmd,
      value: effectiveCmd(k)
    })
    if (input === null) return // Huỷ
    const cmd = input.trim()
    if (cmd === '' || cmd === SECTIONS[k].cmd) {
      delete overrides[k]
    } else {
      const reason = badCmdReason(cmd)
      if (reason) {
        await api.ui.notify(`Không nhận lệnh: ${reason}`)
        return
      }
      overrides[k] = cmd
    }
    void api.storage.set('cmds', overrides).catch(() => undefined)
    await startRun(api, lastRun.sessionId, buildOneCmd(lastRun.logPath, k, effectiveCmd(k)), k)
  })

  api.log(`access-log-analyzer sẵn sàng (mặc định: ${DEFAULT_LOG_PATH} — sẽ hỏi đường dẫn khi chạy)`)
}

module.exports.deactivate = () => {
  cleanupRun()
}
