/**
 * Định nghĩa + validate manifest.json của plugin. Thuần (không I/O, không Electron) → test được.
 * Mọi hàm KHÔNG bao giờ throw: trả về danh sách lỗi để UI hiển thị.
 */

export interface PluginCommandManifest {
  id: string
  title: string
}

export interface PluginContributions {
  commands: PluginCommandManifest[]
}

export interface PluginManifest {
  id: string
  name: string
  version: string
  description: string | null
  /** File entry CommonJS, mặc định "index.js". Đã đảm bảo đuôi .js + không traversal. */
  main: string
  /** vd { infra: "^1.0.0" } — v1 chỉ hiển thị, chưa enforce. */
  engines: Record<string, string>
  /** v1 chỉ khai báo + hiển thị, chưa enforce (enforce ở v2). */
  permissions: string[]
  contributes: PluginContributions
}

export type ManifestResult = { ok: true; manifest: PluginManifest } | { ok: false; errors: string[] }

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?$/
/** Command id namespaced: "nhom.ten" (mỗi đoạn kebab, có ít nhất 1 dấu chấm). */
const COMMAND_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/

/**
 * Validate + chuẩn hoá manifest. `dirName` = tên thư mục chứa plugin; `id` BẮT BUỘC trùng
 * (chống giả mạo / trùng id). Trả về object đã chuẩn hoá hoặc danh sách lỗi.
 */
export function validateManifest(raw: unknown, dirName: string): ManifestResult {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, errors: ['manifest.json phải là một object JSON'] }
  }
  const obj = raw as Record<string, unknown>
  const errors: string[] = []

  const id = obj.id
  if (typeof id !== 'string' || !ID_RE.test(id) || id.length > 64) {
    errors.push('id phải là kebab-case (a-z, 0-9, "-"), tối đa 64 ký tự')
  } else if (id !== dirName) {
    errors.push(`id ("${id}") phải trùng tên thư mục ("${dirName}")`)
  }

  const name = obj.name
  if (typeof name !== 'string' || name.trim() === '' || name.length > 100) {
    errors.push('name phải là chuỗi không rỗng, tối đa 100 ký tự')
  }

  const version = obj.version
  if (typeof version !== 'string' || !SEMVER_RE.test(version)) {
    errors.push('version phải đúng semver (vd "1.0.0")')
  }

  let main = 'index.js'
  if (obj.main !== undefined) {
    if (typeof obj.main !== 'string' || obj.main.trim() === '') {
      errors.push('main phải là chuỗi')
    } else {
      main = obj.main.trim()
    }
  }
  if (!main.endsWith('.js')) {
    errors.push('main phải trỏ tới file .js')
  }
  if (main.includes('..') || main.startsWith('/') || main.startsWith('\\') || /^[a-zA-Z]:/.test(main)) {
    errors.push('main không được chứa ".." hoặc đường dẫn tuyệt đối')
  }

  const description = typeof obj.description === 'string' ? obj.description : null

  let engines: Record<string, string> = {}
  if (obj.engines !== undefined) {
    if (typeof obj.engines === 'object' && obj.engines !== null && !Array.isArray(obj.engines)) {
      engines = Object.fromEntries(
        Object.entries(obj.engines as Record<string, unknown>).filter(([, v]) => typeof v === 'string')
      ) as Record<string, string>
    } else {
      errors.push('engines phải là object')
    }
  }

  let permissions: string[] = []
  if (obj.permissions !== undefined) {
    if (Array.isArray(obj.permissions) && obj.permissions.every((p) => typeof p === 'string')) {
      permissions = obj.permissions as string[]
    } else {
      errors.push('permissions phải là mảng chuỗi')
    }
  }

  const commands: PluginCommandManifest[] = []
  if (obj.contributes !== undefined) {
    if (typeof obj.contributes !== 'object' || obj.contributes === null || Array.isArray(obj.contributes)) {
      errors.push('contributes phải là object')
    } else {
      const rawCommands = (obj.contributes as Record<string, unknown>).commands
      if (rawCommands !== undefined) {
        if (!Array.isArray(rawCommands)) {
          errors.push('contributes.commands phải là mảng')
        } else {
          const seen = new Set<string>()
          rawCommands.forEach((c, i) => {
            if (typeof c !== 'object' || c === null) {
              errors.push(`contributes.commands[${i}] phải là object`)
              return
            }
            const cid = (c as Record<string, unknown>).id
            const ctitle = (c as Record<string, unknown>).title
            if (typeof cid !== 'string' || !COMMAND_ID_RE.test(cid)) {
              errors.push(`contributes.commands[${i}].id phải dạng "nhom.ten" (kebab, có dấu chấm)`)
            } else if (seen.has(cid)) {
              errors.push(`command id trùng trong plugin: "${cid}"`)
            } else {
              seen.add(cid)
            }
            if (typeof ctitle !== 'string' || ctitle.trim() === '') {
              errors.push(`contributes.commands[${i}].title phải là chuỗi không rỗng`)
            }
            // Chỉ tích luỹ khi cặp id+title hợp lệ kiểu; nếu có lỗi (trùng/regex) manifest bị loại nên
            // nội dung mảng không quan trọng — không cần lọc trùng ở đây.
            if (typeof cid === 'string' && COMMAND_ID_RE.test(cid) && typeof ctitle === 'string' && ctitle.trim() !== '') {
              commands.push({ id: cid, title: ctitle.trim() })
            }
          })
        }
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors }

  return {
    ok: true,
    manifest: {
      id: id as string,
      name: (name as string).trim(),
      version: version as string,
      description,
      main,
      engines,
      permissions,
      contributes: { commands }
    }
  }
}

/** Parse chuỗi JSON rồi validate. Không throw — JSON lỗi cũng trả về { ok:false }. */
export function parseManifest(text: string, dirName: string): ManifestResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    return { ok: false, errors: [`manifest.json không phải JSON hợp lệ: ${(e as Error).message}`] }
  }
  return validateManifest(raw, dirName)
}
