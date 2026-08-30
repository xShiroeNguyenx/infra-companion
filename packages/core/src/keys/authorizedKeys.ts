/**
 * F43 — đẩy public key lên `~/.ssh/authorized_keys` của host đang dùng password.
 *
 * Phần quyết định để ở đây dưới dạng hàm thuần (có test miễn phí); phần chạy lệnh nằm ở main.
 * Chia thế để lệnh shell giữ được mức TẦM THƯỜNG: chỉ đọc file và append, còn "key đã có
 * chưa" thì so trong JS. Lý do không nhét `if/grep` vào shell: lệnh còn phải đi qua host có
 * login script, mà mỗi hop bọc thêm một lớp quote rồi bóc mất — càng ít cú pháp shell càng ít
 * chỗ vỡ (CLAUDE.md §4).
 */

/** Bọc chuỗi trong nháy đơn cho shell. */
function shq(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`
}

/**
 * Phần "định danh" của một dòng public key: `<type> <base64>`, bỏ comment ở cuối.
 *
 * So cả dòng là sai: cùng một key nhưng comment khác nhau (`user@may-cu` vs `user@may-moi`)
 * sẽ bị coi là hai key và ghi trùng vào file mỗi lần bấm.
 */
export function publicKeyIdentity(line: string): string | null {
  const parts = line.trim().split(/\s+/)
  if (parts.length < 2) return null
  const [type, blob] = parts
  if (!type || !blob || !type.startsWith('ssh-') && !type.startsWith('ecdsa-') && !type.startsWith('sk-')) return null
  return `${type} ${blob}`
}

/** Key đã nằm trong nội dung authorized_keys chưa (bỏ qua khác biệt ở comment và dòng trống). */
export function authorizedKeysHas(content: string, publicKeyLine: string): boolean {
  const wanted = publicKeyIdentity(publicKeyLine)
  if (wanted === null) return false
  return content
    .split('\n')
    .some((line) => line.trim() !== '' && !line.trimStart().startsWith('#') && publicKeyIdentity(line) === wanted)
}

/**
 * Lệnh chuẩn bị thư mục + đọc file hiện có.
 *
 * `chmod` là phần KHÔNG được bỏ: sshd im lặng từ chối `authorized_keys` nếu thư mục hoặc file
 * quá rộng quyền — key đẩy lên thành công mà đăng nhập vẫn hỏi mật khẩu, không báo gì.
 * `touch` trước `cat` để file chưa tồn tại không làm lệnh trả lỗi.
 */
export function readAuthorizedKeysCommand(): string {
  return 'mkdir -p ~/.ssh; chmod 700 ~/.ssh; touch ~/.ssh/authorized_keys; chmod 600 ~/.ssh/authorized_keys; cat ~/.ssh/authorized_keys'
}

/** Lệnh append một dòng key. `printf '%s\\n'` thay vì `echo` vì `echo` khác nhau giữa các shell. */
export function appendAuthorizedKeyCommand(publicKeyLine: string): string {
  return `printf '%s\\n' ${shq(publicKeyLine.trim())} >> ~/.ssh/authorized_keys`
}

export type CopyIdOutcome = 'added' | 'already-present'

/** Quyết định phải làm gì sau khi đọc được file: thêm mới hay đã có sẵn. */
export function planCopyId(existingContent: string, publicKeyLine: string): CopyIdOutcome {
  return authorizedKeysHas(existingContent, publicKeyLine) ? 'already-present' : 'added'
}
