import { createSign } from 'node:crypto'
import type { CloudInstanceDto } from '@infra/shared'

/**
 * GCP Compute Engine — phần THUẦN: dựng JWT service-account (RS256) để đổi lấy access
 * token, và parse aggregatedList instances. Chỉ ĐỌC — scope compute.readonly.
 * User dán NGUYÊN file JSON key của service account (giống cách dán file OAuth client).
 */

export const GCP_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const GCP_COMPUTE_SCOPE = 'https://www.googleapis.com/auth/compute.readonly'

export interface GcpServiceAccount {
  email: string
  privateKeyPem: string
  projectId: string
}

/** Đọc file JSON key của service account — chỉ giữ 3 trường cần. null nếu sai dạng. */
export function parseGcpServiceAccount(json: string): GcpServiceAccount | null {
  try {
    const data = JSON.parse(json) as { client_email?: unknown; private_key?: unknown; project_id?: unknown }
    if (
      typeof data.client_email !== 'string' ||
      typeof data.private_key !== 'string' ||
      typeof data.project_id !== 'string'
    ) {
      return null
    }
    return { email: data.client_email, privateKeyPem: data.private_key, projectId: data.project_id }
  } catch {
    return null
  }
}

function b64url(data: string | Buffer): string {
  return Buffer.from(data).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

/** JWT ký RS256 cho grant jwt-bearer — sống 1 giờ. `now` là tham số để test tái lập. */
export function buildGcpJwt(sa: GcpServiceAccount, now = Date.now()): string {
  const iat = Math.floor(now / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url(
    JSON.stringify({ iss: sa.email, scope: GCP_COMPUTE_SCOPE, aud: GCP_TOKEN_URL, iat, exp: iat + 3600 })
  )
  const signature = createSign('RSA-SHA256').update(`${header}.${claims}`).sign(sa.privateKeyPem)
  return `${header}.${claims}.${b64url(signature)}`
}

/** Body form-encoded đổi JWT lấy access token. */
export function buildGcpTokenBody(jwt: string): string {
  return new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt
  }).toString()
}

export function gcpAggregatedInstancesUrl(projectId: string): string {
  return `https://compute.googleapis.com/compute/v1/projects/${encodeURIComponent(projectId)}/aggregated/instances`
}

/** Map trạng thái GCE về từ vựng chung ('active' = RUNNING). */
function mapStatus(status: string): string {
  if (status === 'RUNNING') return 'active'
  return status.toLowerCase()
}

/** Parse aggregatedList: items là map 'zones/<zone>' → {instances: […]}. */
export function parseGcpAggregated(json: unknown): { instances: CloudInstanceDto[]; warnings: string[] } {
  const warnings: string[] = []
  const instances: CloudInstanceDto[] = []
  const root = json as { items?: Record<string, { instances?: unknown[] }> } | null
  if (typeof root !== 'object' || root === null || typeof root.items !== 'object' || root.items === null) {
    return { instances, warnings: ['Phản hồi không đúng dạng aggregatedList của Compute Engine'] }
  }

  for (const [scope, entry] of Object.entries(root.items)) {
    if (!Array.isArray(entry?.instances)) continue // zone không có máy → entry chỉ có warning của GCP
    const zone = scope.replace(/^zones\//, '')
    for (const raw of entry.instances) {
      const inst = raw as {
        id?: unknown
        name?: unknown
        status?: unknown
        machineType?: unknown
        networkInterfaces?: Array<{ networkIP?: unknown; accessConfigs?: Array<{ natIP?: unknown }> }>
        labels?: Record<string, string>
      }
      if (typeof inst.name !== 'string') continue
      if (inst.status === 'TERMINATED') {
        // GCE TERMINATED = máy TẮT (còn tồn tại, bật lại được) — vẫn import, khác EC2 terminated
      }
      const nic = inst.networkInterfaces?.[0]
      const nat = nic?.accessConfigs?.find((c) => typeof c?.natIP === 'string')
      instances.push({
        id: typeof inst.id === 'string' ? inst.id : inst.name,
        name: inst.name,
        publicIp: typeof nat?.natIP === 'string' ? nat.natIP : null,
        privateIp: typeof nic?.networkIP === 'string' ? nic.networkIP : null,
        region: zone,
        status: typeof inst.status === 'string' ? mapStatus(inst.status) : '',
        tags: inst.labels ? Object.entries(inst.labels).map(([k, v]) => (v ? `${k}=${v}` : k)) : [],
        image: '',
        sizeSlug: typeof inst.machineType === 'string' ? (inst.machineType.split('/').pop() ?? '') : '',
        exists: false
      })
    }
  }
  return { instances, warnings }
}
