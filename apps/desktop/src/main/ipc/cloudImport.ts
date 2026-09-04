import { ipcMain, net } from 'electron'
import {
  GCP_TOKEN_URL,
  azureNicListUrl,
  azurePublicIpListUrl,
  azureTokenUrl,
  azureVmListUrl,
  buildAzureTokenBody,
  buildDescribeInstancesBody,
  buildGcpJwt,
  buildGcpTokenBody,
  ec2Host,
  gcpAggregatedInstancesUrl,
  joinAzureInstances,
  parseDescribeInstances,
  parseGcpAggregated,
  parseGcpServiceAccount,
  sha256Hex,
  signAwsRequest
} from '@infra/core'
import {
  IPC,
  type CloudAccountDto,
  type CloudAccountInput,
  type CloudInstanceDto,
  type CloudListResult
} from '@infra/shared'
import { getVault, touchActivity } from './vault'

/**
 * F05 — cloud import AWS EC2 / GCP Compute / Azure VM (DigitalOcean có handler riêng từ
 * v0.2.13, giữ nguyên). Main chỉ lo MẠNG + credentials; parse là hàm thuần ở core có test.
 *
 * Credentials mã hoá DEK ở `cloud_secret:<id>` (JSON theo provider), KHÔNG bao giờ qua IPC —
 * renderer chỉ thấy danh bạ {id, label, provider, config-không-bí-mật}. Mọi lệnh gọi đều
 * CHỈ ĐỌC: DescribeInstances / aggregatedList / GET virtualMachines — quyền read-only là đủ.
 */

const FETCH_TIMEOUT_MS = 20_000

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    return await net.fetch(url, { ...init, signal: ctrl.signal, cache: 'no-store' })
  } finally {
    clearTimeout(timer)
  }
}

type ListOutcome = CloudListResult

// ---------------------------------------------------------------------------
// AWS
// ---------------------------------------------------------------------------

async function listAws(config: Record<string, string>, secretJson: string): Promise<ListOutcome> {
  const creds = JSON.parse(secretJson) as { accessKeyId?: string; secretAccessKey?: string }
  if (!creds.accessKeyId || !creds.secretAccessKey) return { ok: false, error: 'badCreds' }
  const region = config.region ?? ''
  if (!region) return { ok: false, error: 'badCreds', detail: 'thiếu region' }

  const body = buildDescribeInstancesBody()
  const host = ec2Host(region)
  const signed = signAwsRequest({
    method: 'POST',
    host,
    path: '/',
    headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' },
    payloadHash: sha256Hex(body),
    region,
    service: 'ec2',
    accessKeyId: creds.accessKeyId,
    secretAccessKey: creds.secretAccessKey
  })
  const res = await fetchWithTimeout(`https://${host}/`, { method: 'POST', headers: signed.headers, body })
  const xml = await res.text()
  if (!res.ok) {
    // EC2 trả lỗi dạng XML <Response><Errors><Error><Code>…<Message>… — móc Message ra cho user
    const message = xml.match(/<Message>([^<]*)<\/Message>/)?.[1]
    return { ok: false, error: res.status === 401 || res.status === 403 ? 'auth' : 'http', detail: message ?? `HTTP ${res.status}` }
  }
  const parsed = parseDescribeInstances(xml)
  if (parsed.instances.length === 0 && parsed.warnings.length > 0) {
    return { ok: false, error: 'badResponse', detail: parsed.warnings[0] }
  }
  const warnings = [...parsed.warnings]
  if (xml.includes('<nextToken>')) warnings.push('Tài khoản có rất nhiều máy — danh sách có thể bị cắt ở trang đầu')
  return { ok: true, instances: parsed.instances, warnings }
}

// ---------------------------------------------------------------------------
// GCP
// ---------------------------------------------------------------------------

async function listGcp(secretJson: string): Promise<ListOutcome> {
  const sa = parseGcpServiceAccount(secretJson)
  if (!sa) return { ok: false, error: 'badCreds', detail: 'File JSON key của service account sai định dạng' }

  const tokenRes = await fetchWithTimeout(GCP_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: buildGcpTokenBody(buildGcpJwt(sa))
  })
  const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: string; error_description?: string }
  if (!tokenRes.ok || !tokenJson.access_token) {
    return { ok: false, error: 'auth', detail: tokenJson.error_description ?? tokenJson.error ?? `HTTP ${tokenRes.status}` }
  }

  const res = await fetchWithTimeout(gcpAggregatedInstancesUrl(sa.projectId), {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` }
  })
  const json = (await res.json()) as { error?: { message?: string }; nextPageToken?: string }
  if (!res.ok) {
    return {
      ok: false,
      error: res.status === 401 || res.status === 403 ? 'auth' : 'http',
      detail: json.error?.message ?? `HTTP ${res.status}`
    }
  }
  const parsed = parseGcpAggregated(json)
  if (parsed.warnings.length > 0 && parsed.instances.length === 0) {
    return { ok: false, error: 'badResponse', detail: parsed.warnings[0] }
  }
  const warnings = [...parsed.warnings]
  if (json.nextPageToken) warnings.push('Project có rất nhiều máy — danh sách có thể bị cắt ở trang đầu')
  return { ok: true, instances: parsed.instances, warnings }
}

// ---------------------------------------------------------------------------
// Azure
// ---------------------------------------------------------------------------

async function listAzure(config: Record<string, string>, secretJson: string): Promise<ListOutcome> {
  const creds = JSON.parse(secretJson) as { tenantId?: string; clientId?: string; clientSecret?: string }
  const subscriptionId = config.subscriptionId ?? ''
  if (!creds.tenantId || !creds.clientId || !creds.clientSecret || !subscriptionId) {
    return { ok: false, error: 'badCreds', detail: 'thiếu tenant/client/secret/subscription' }
  }

  const tokenRes = await fetchWithTimeout(azureTokenUrl(creds.tenantId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: buildAzureTokenBody(creds.clientId, creds.clientSecret)
  })
  const tokenJson = (await tokenRes.json()) as { access_token?: string; error_description?: string; error?: string }
  if (!tokenRes.ok || !tokenJson.access_token) {
    return { ok: false, error: 'auth', detail: tokenJson.error_description ?? tokenJson.error ?? `HTTP ${tokenRes.status}` }
  }
  const auth = { Authorization: `Bearer ${tokenJson.access_token}` }

  // VM (kèm power state) + NIC + Public IP — ba GET chỉ-đọc, join là hàm thuần có test
  const [vmRes, nicRes, ipRes] = await Promise.all([
    fetchWithTimeout(azureVmListUrl(subscriptionId), { headers: auth }),
    fetchWithTimeout(azureNicListUrl(subscriptionId), { headers: auth }),
    fetchWithTimeout(azurePublicIpListUrl(subscriptionId), { headers: auth })
  ])
  if (!vmRes.ok) {
    const body = (await vmRes.json().catch(() => null)) as { error?: { message?: string } } | null
    return {
      ok: false,
      error: vmRes.status === 401 || vmRes.status === 403 ? 'auth' : 'http',
      detail: body?.error?.message ?? `HTTP ${vmRes.status}`
    }
  }
  const vms = (await vmRes.json()) as { nextLink?: string }
  // NIC/IP lỗi thì vẫn ra danh sách máy (thiếu IP) — join đã chịu được null
  const nics = nicRes.ok ? await nicRes.json() : null
  const ips = ipRes.ok ? await ipRes.json() : null

  const joined = joinAzureInstances(vms, nics, ips)
  if (joined.warnings.length > 0 && joined.instances.length === 0) {
    return { ok: false, error: 'badResponse', detail: joined.warnings[0] }
  }
  const warnings = [...joined.warnings]
  if (!nicRes.ok || !ipRes.ok) warnings.push('Không đọc được danh sách NIC/IP — một số máy sẽ thiếu địa chỉ')
  if (vms.nextLink) warnings.push('Subscription có rất nhiều máy — danh sách có thể bị cắt ở trang đầu')
  return { ok: true, instances: joined.instances, warnings }
}

// ---------------------------------------------------------------------------

export function registerCloudImportIpc(): void {
  ipcMain.handle(IPC.CLOUD_ACCOUNTS, (): CloudAccountDto[] => {
    touchActivity()
    return getVault().listCloudAccounts()
  })

  ipcMain.handle(IPC.CLOUD_SAVE_ACCOUNT, (_e, input: CloudAccountInput): CloudAccountDto => {
    touchActivity()
    return getVault().saveCloudAccount(input)
  })

  ipcMain.handle(IPC.CLOUD_DELETE_ACCOUNT, (_e, id: string): void => {
    touchActivity()
    getVault().deleteCloudAccount(id)
  })

  ipcMain.handle(IPC.CLOUD_LIST_INSTANCES, async (_e, accountId: string): Promise<CloudListResult> => {
    touchActivity()
    const vault = getVault()
    const account = vault.listCloudAccounts().find((a) => a.id === accountId)
    if (!account) return { ok: false, error: 'noAccount' }
    const secretJson = vault.getCloudSecret(accountId)
    if (!secretJson) return { ok: false, error: 'badCreds', detail: 'chưa lưu credentials' }

    let result: ListOutcome
    try {
      if (account.provider === 'aws') result = await listAws(account.config, secretJson)
      else if (account.provider === 'gcp') result = await listGcp(secretJson)
      else if (account.provider === 'azure') result = await listAzure(account.config, secretJson)
      else return { ok: false, error: 'badCreds', detail: `provider lạ: ${account.provider}` }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      return { ok: false, error: /abort/i.test(detail) ? 'timeout' : 'network', detail }
    }
    if (!result.ok) return result

    // Đánh dấu máy đã có host trùng địa chỉ — cùng logic với DigitalOcean
    const existing = new Set(vault.listHosts().map((h) => h.hostname.trim().toLowerCase()))
    const instances: CloudInstanceDto[] = result.instances.map((inst) => {
      const address = inst.publicIp ?? inst.privateIp
      return { ...inst, exists: address !== null && existing.has(address.trim().toLowerCase()) }
    })
    return { ok: true, instances, warnings: result.warnings }
  })
}
