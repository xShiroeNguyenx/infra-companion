/**
 * Định nghĩa + validate registry marketplace (F52): file JSON công khai liệt kê plugin,
 * app tải về để hiển thị tab Marketplace và cài plugin. Thuần (không I/O) → test được.
 * Mọi hàm KHÔNG bao giờ throw: trả về danh sách lỗi.
 *
 * An toàn là ưu tiên: id/tên file bị siết chặt (chống path traversal khi ghi vào
 * userData/plugins), URL chỉ https (trừ localhost để dev), mỗi file kèm sha256 bắt buộc
 * — main process phải verify checksum TRƯỚC khi ghi file.
 */

export interface RegistryFile {
  /** Tên file trong thư mục plugin: "manifest.json" hoặc "*.js" phẳng (không thư mục con). */
  name: string
  url: string
  /** SHA-256 hex (64 ký tự) của nội dung file — verify trước khi cài. */
  sha256: string
}

export interface RegistryPluginEntry {
  id: string
  name: string
  version: string
  description: string | null
  author: string | null
  files: RegistryFile[]
  /** Chữ ký ed25519 base64 phủ id+version+files (xem signing.ts). Thiếu/sai → app không cài. */
  signature: string | null
}

export type RegistryResult =
  | { ok: true; plugins: RegistryPluginEntry[] }
  | { ok: false; errors: string[] }

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?$/
const SHA256_RE = /^[0-9a-f]{64}$/
/** Chữ ký ed25519 = 64 byte → base64 88 ký tự (kèm padding). Nới nhẹ cho an toàn parse. */
const SIGNATURE_RE = /^[A-Za-z0-9+/]{80,100}={0,2}$/
/** Tên file phẳng an toàn: manifest.json hoặc *.js kebab/word đơn giản. */
const FILE_NAME_RE = /^[A-Za-z0-9._-]+$/
const MAX_FILES_PER_PLUGIN = 16

function safeUrl(url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol === 'https:') return true
  // http chỉ cho localhost — phục vụ test registry local khi dev
  return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')
}

function validateFile(raw: unknown, where: string, errors: string[]): RegistryFile | null {
  if (typeof raw !== 'object' || raw === null) {
    errors.push(`${where} phải là object`)
    return null
  }
  const f = raw as Record<string, unknown>
  const name = f.name
  if (
    typeof name !== 'string' ||
    name.length > 64 ||
    !FILE_NAME_RE.test(name) ||
    name.includes('..') ||
    !(name === 'manifest.json' || name.endsWith('.js'))
  ) {
    errors.push(`${where}.name phải là "manifest.json" hoặc file .js phẳng`)
    return null
  }
  if (name === 'data.json') {
    // data.json là file storage của plugin trên máy user — registry không được đè
    errors.push(`${where}.name không được là "data.json"`)
    return null
  }
  const url = f.url
  if (typeof url !== 'string' || !safeUrl(url)) {
    errors.push(`${where}.url phải là https (hoặc http://localhost khi dev)`)
    return null
  }
  const sha256 = f.sha256
  if (typeof sha256 !== 'string' || !SHA256_RE.test(sha256.toLowerCase())) {
    errors.push(`${where}.sha256 phải là chuỗi hex 64 ký tự`)
    return null
  }
  return { name, url, sha256: sha256.toLowerCase() }
}

function validateEntry(raw: unknown, index: number, errors: string[]): RegistryPluginEntry | null {
  const where = `plugins[${index}]`
  if (typeof raw !== 'object' || raw === null) {
    errors.push(`${where} phải là object`)
    return null
  }
  const obj = raw as Record<string, unknown>

  const id = obj.id
  if (typeof id !== 'string' || !ID_RE.test(id) || id.length > 64) {
    errors.push(`${where}.id phải là kebab-case (a-z, 0-9, "-"), tối đa 64 ký tự`)
    return null
  }

  const name = obj.name
  if (typeof name !== 'string' || name.trim() === '' || name.length > 100) {
    errors.push(`${where}.name phải là chuỗi không rỗng, tối đa 100 ký tự`)
    return null
  }

  const version = obj.version
  if (typeof version !== 'string' || !SEMVER_RE.test(version)) {
    errors.push(`${where}.version phải đúng semver (vd "1.0.0")`)
    return null
  }

  const description = typeof obj.description === 'string' ? obj.description : null
  const author = typeof obj.author === 'string' ? obj.author : null

  const rawFiles = obj.files
  if (!Array.isArray(rawFiles) || rawFiles.length === 0 || rawFiles.length > MAX_FILES_PER_PLUGIN) {
    errors.push(`${where}.files phải là mảng 1–${MAX_FILES_PER_PLUGIN} file`)
    return null
  }
  const files: RegistryFile[] = []
  const seenNames = new Set<string>()
  for (let i = 0; i < rawFiles.length; i++) {
    const file = validateFile(rawFiles[i], `${where}.files[${i}]`, errors)
    if (!file) return null
    if (seenNames.has(file.name)) {
      errors.push(`${where}.files: tên file trùng "${file.name}"`)
      return null
    }
    seenNames.add(file.name)
    files.push(file)
  }
  if (!seenNames.has('manifest.json')) {
    errors.push(`${where}.files phải chứa manifest.json`)
    return null
  }
  if (![...seenNames].some((n) => n.endsWith('.js'))) {
    errors.push(`${where}.files phải chứa ít nhất 1 file .js`)
    return null
  }

  // Optional ở tầng PARSE (registry cũ chưa ký vẫn đọc được); bắt buộc hay không là
  // chính sách của caller — app luôn verify bằng verifyPluginEntry trước khi hiện/cài.
  let signature: string | null = null
  if (obj.signature !== undefined && obj.signature !== null) {
    if (typeof obj.signature !== 'string' || !SIGNATURE_RE.test(obj.signature)) {
      errors.push(`${where}.signature phải là chữ ký ed25519 base64`)
      return null
    }
    signature = obj.signature
  }

  return { id, name: (name as string).trim(), version, description, author, files, signature }
}

/** Validate toàn bộ registry. Entry lỗi làm fail cả registry (dữ liệu công khai phải sạch 100%). */
export function validateRegistry(raw: unknown): RegistryResult {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, errors: ['registry phải là một object JSON'] }
  }
  const obj = raw as Record<string, unknown>
  if (obj.version !== 1) {
    return { ok: false, errors: ['registry.version phải là 1 (định dạng chưa hỗ trợ)'] }
  }
  if (!Array.isArray(obj.plugins)) {
    return { ok: false, errors: ['registry.plugins phải là mảng'] }
  }

  const errors: string[] = []
  const plugins: RegistryPluginEntry[] = []
  const seenIds = new Set<string>()
  obj.plugins.forEach((entry, i) => {
    const parsed = validateEntry(entry, i, errors)
    if (!parsed) return
    if (seenIds.has(parsed.id)) {
      errors.push(`plugins[${i}]: id trùng "${parsed.id}"`)
      return
    }
    seenIds.add(parsed.id)
    plugins.push(parsed)
  })

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, plugins }
}

/** Parse chuỗi JSON rồi validate. Không throw. */
export function parseRegistry(text: string): RegistryResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    return { ok: false, errors: [`registry không phải JSON hợp lệ: ${(e as Error).message}`] }
  }
  return validateRegistry(raw)
}

/** So semver đơn giản: a > b? (bỏ qua prerelease — đủ cho nhu cầu "có bản mới hơn"). */
export function semverGt(a: string, b: string): boolean {
  const pa = a.split('-')[0]!.split('.').map(Number)
  const pb = b.split('-')[0]!.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x > y
  }
  return false
}
