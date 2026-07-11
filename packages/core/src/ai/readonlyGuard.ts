/**
 * Hàng rào read-only cho AI chẩn đoán (F48): chặn lệnh có thể GHI/sửa hệ thống.
 *
 * ⚠ Đây là hàng rào PHỤ (defense-in-depth). Hàng rào chính là (1) system prompt bắt AI
 * chỉ đề xuất lệnh đọc, (2) user duyệt TỪNG bước. Guard này best-effort chặn các mẫu ghi
 * phổ biến — không phải sandbox tuyệt đối (không thể parse mọi biến thể shell). Khi nghi
 * ngờ thì CHẶN (fail-safe): thà bắt user tự chạy còn hơn để AI ghi ngoài ý muốn.
 *
 * Chiến lược: tách lệnh thành các "segment ở vị trí lệnh" (sau ; && || | và trong $()/``),
 * bóc các wrapper (sudo/env/xargs/timeout…), rồi kiểm tên lệnh gốc theo denylist +
 * subcommand cho công cụ vừa-đọc-vừa-ghi (systemctl/service/docker/kubectl/git) +
 * chặn redirection ra file.
 */

export interface ReadOnlyVerdict {
  ok: boolean
  reason?: string
}

/** Lệnh luôn chặn (ghi/xoá/đổi hệ thống, hoặc package manager — hiếm khi cần để chẩn đoán). */
const ALWAYS_DENY = new Set([
  'rm', 'rmdir', 'unlink', 'shred', 'srm', 'mv', 'cp', 'rsync', 'dd', 'dm',
  'mkfs', 'mke2fs', 'mkfs.ext4', 'mkfs.xfs', 'fdisk', 'sfdisk', 'parted', 'gparted', 'wipefs', 'mkswap',
  'swapon', 'swapoff', 'truncate', 'tee', 'sponge', 'install', 'ln', 'touch', 'mkdir', 'mktemp',
  'chmod', 'chown', 'chgrp', 'chattr', 'setfacl', 'chcon', 'restorecon',
  'kill', 'pkill', 'killall', 'skill', 'fuser',
  'reboot', 'shutdown', 'halt', 'poweroff', 'init', 'telinit',
  'mount', 'umount', 'swapoff', 'losetup', 'blkdiscard',
  'iptables', 'ip6tables', 'nft', 'ufw', 'firewall-cmd', 'ipset',
  'useradd', 'userdel', 'usermod', 'groupadd', 'groupdel', 'groupmod', 'passwd', 'chpasswd', 'adduser', 'deluser', 'gpasswd',
  'crontab', 'at', 'batch',
  'sysctl', 'modprobe', 'insmod', 'rmmod', 'depmod',
  'hostnamectl', 'timedatectl', 'localectl', 'loginctl',
  'growpart', 'resize2fs', 'xfs_growfs', 'e2fsck', 'fsck',
  'lvcreate', 'lvremove', 'lvextend', 'lvreduce', 'vgcreate', 'vgremove', 'pvcreate', 'pvremove',
  'vi', 'vim', 'nvim', 'nano', 'emacs', 'ed', 'pico', 'patch',
  'apt', 'apt-get', 'aptitude', 'dpkg', 'yum', 'dnf', 'rpm', 'apk', 'zypper', 'pacman', 'snap', 'flatpak',
  'pip', 'pip3', 'npm', 'yarn', 'pnpm', 'gem', 'cargo', 'composer', 'poetry',
  'make', 'cmake', 'gcc', 'g++', 'cc', 'ld',
  'iptables-restore', 'update-rc.d', 'chkconfig', 'setenforce', 'ausearch'
])

/** Wrapper bóc bỏ để kiểm lệnh thật đứng sau (giữ read-only nếu lệnh sau read-only). */
const WRAPPERS = new Set(['sudo', 'doas', 'env', 'command', 'builtin', 'exec', 'nice', 'ionice', 'nohup', 'stdbuf', 'setsid', 'xargs', 'time', 'watch'])

/** Công cụ vừa-đọc-vừa-ghi: CHỈ cho phép subcommand đọc. */
const SUBCOMMAND_TOOLS: Record<string, Set<string>> = {
  systemctl: new Set(['status', 'is-active', 'is-enabled', 'is-failed', 'is-system-running', 'list-units', 'list-unit-files', 'list-dependencies', 'list-timers', 'list-sockets', 'list-jobs', 'show', 'cat', 'get-default', 'show-environment']),
  docker: new Set(['ps', 'images', 'image', 'logs', 'inspect', 'stats', 'top', 'version', 'info', 'port', 'diff', 'events', 'history', 'search', 'network', 'volume', 'context']),
  podman: new Set(['ps', 'images', 'image', 'logs', 'inspect', 'stats', 'top', 'version', 'info', 'port', 'diff', 'events', 'history']),
  kubectl: new Set(['get', 'describe', 'logs', 'top', 'explain', 'version', 'api-resources', 'api-versions', 'cluster-info', 'config', 'events', 'auth']),
  git: new Set(['status', 'log', 'show', 'diff', 'branch', 'remote', 'config', 'rev-parse', 'describe', 'blame', 'shortlog', 'ls-files', 'ls-tree', 'cat-file', 'reflog']),
  supervisorctl: new Set(['status', 'avail', 'pid', 'version']),
  virsh: new Set(['list', 'dominfo', 'domstate', 'nodeinfo', 'version', 'capabilities'])
}

/** Cắt token đầu (tôn trọng nháy đơn giản). */
function firstWords(segment: string): string[] {
  return segment
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0)
}

/** Bỏ prefix gán biến môi trường FOO=bar. */
function stripEnvAssignments(words: string[]): string[] {
  let i = 0
  while (i < words.length && /^[A-Za-z_]\w*=/.test(words[i]!)) i++
  return words.slice(i)
}

/** Bóc wrapper (sudo/env/timeout N/xargs…) để lấy lệnh thật. */
function unwrap(words: string[]): string[] {
  let w = stripEnvAssignments(words)
  for (;;) {
    if (w.length === 0) return w
    const head = basename(w[0]!)
    if (!WRAPPERS.has(head)) return w
    // timeout/watch có tham số thời lượng đứng trước lệnh: bỏ các token cờ + 1 token số
    w = w.slice(1)
    if (head === 'timeout' || head === 'watch') {
      // bỏ cờ (-s SIG, --signal=…, -k, -n interval) rồi 1 token thời lượng nếu là số
      while (w.length > 0 && w[0]!.startsWith('-')) w = w.slice(1)
      if (w.length > 0 && /^[\d.]+[smhd]?$/.test(w[0]!)) w = w.slice(1)
    }
    w = stripEnvAssignments(w)
  }
}

function basename(cmd: string): string {
  const noPath = cmd.replace(/^.*\//, '')
  return noPath.toLowerCase()
}

/** Tách chuỗi thành các segment ở VỊ TRÍ LỆNH (sau ; && || | \n và trong $()/``). */
function commandSegments(cmd: string): string[] {
  // Thay $( … ) và ` … ` bằng dấu phân tách để nội dung bên trong cũng được kiểm như 1 segment
  const flattened = cmd.replaceAll('$(', ';').replaceAll(/[`()]/g, ';')
  return flattened
    .split(/(?:\|\||&&|[;\n|&])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/** Kiểm một segment (đã ở vị trí lệnh). Trả lý do chặn, hoặc null nếu an toàn. */
function checkSegment(seg: string): string | null {
  const words = unwrap(firstWords(seg))
  if (words.length === 0) return null
  const name = basename(words[0]!)
  const rest = words.slice(1)

  if (ALWAYS_DENY.has(name)) return `Lệnh có thể ghi/sửa hệ thống: ${name}`

  if ((name === 'sed' || name === 'perl') && rest.some((a) => a === '-i' || a.startsWith('-i') || a === '--in-place')) {
    return `${name} -i sửa file tại chỗ`
  }

  if (name === 'find' && rest.some((a) => ['-delete', '-exec', '-execdir', '-fprint', '-fprintf', '-fls'].includes(a))) {
    return 'find có -delete/-exec (có thể ghi/xoá)'
  }

  const allowed = SUBCOMMAND_TOOLS[name]
  if (allowed) {
    const sub = rest.find((a) => !a.startsWith('-'))?.toLowerCase()
    if (!sub || !allowed.has(sub)) {
      return `${name} ${sub ?? ''}`.trim() + ' — chỉ cho phép lệnh con đọc (status/get/logs…)'
    }
  }

  if (name === 'service') {
    const verb = rest.at(-1)?.toLowerCase()
    if (verb && verb !== 'status') return `service … ${verb} — chỉ cho phép status`
  }

  return null
}

/**
 * Kiểm một lệnh shell có phải read-only "đủ an toàn" không.
 * Trả { ok:false, reason } nếu phát hiện mẫu ghi; { ok:true } nếu không thấy dấu hiệu ghi.
 */
export function isReadOnlyCommand(command: string): ReadOnlyVerdict {
  const cmd = command.trim()
  if (!cmd) return { ok: false, reason: 'Lệnh rỗng' }

  // Bỏ nội dung trong nháy để không nhầm `>` của awk/sed script ('$3 > 100') là redirection.
  // Cho phép redirection tới /dev/null|stdout|stderr (idiom nuốt output, không ghi file thật).
  const unquoted = cmd
    .replaceAll(/'[^']*'/g, "''")
    .replaceAll(/"[^"]*"/g, '""')
    .replaceAll(/(?:\d|&)?>>?\s*\/dev\/(?:null|stdout|stderr|fd\/\d+)/g, '')

  // Redirection ra file: `> f`, `>> f`, `1> f`, `&> f` (cho phép 2>&1, >&2 — chỉ là gộp fd)
  if (/(?:^|[^\d&>])\d?>>?\s*(?![&\s])/.test(unquoted) || /&>>?/.test(unquoted)) {
    return { ok: false, reason: 'Có chuyển hướng ghi ra file (>, >>)' }
  }

  for (const seg of commandSegments(cmd)) {
    const reason = checkSegment(seg)
    if (reason) return { ok: false, reason }
  }

  return { ok: true }
}
