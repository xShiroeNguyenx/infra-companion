import type { CloudInstanceDto } from '@infra/shared'

/**
 * Azure VM — phần THUẦN: URL/body cho token client-credentials và phép JOIN ba danh sách
 * (VM → NIC → Public IP) thành CloudInstanceDto. Azure tách IP ra tài nguyên riêng nên
 * phải tự ghép: VM chỉ trỏ tới NIC id, NIC trỏ tới public IP id. Ba lệnh GET (list VM có
 * statusOnly, list NIC, list public IP) là chỉ-đọc — role Reader là đủ.
 */

export function azureTokenUrl(tenantId: string): string {
  return `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`
}

export function buildAzureTokenBody(clientId: string, clientSecret: string): string {
  return new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://management.azure.com/.default'
  }).toString()
}

const MGMT = 'https://management.azure.com'
const VM_API = '2024-03-01'
const NET_API = '2023-09-01'

export function azureVmListUrl(subscriptionId: string): string {
  return `${MGMT}/subscriptions/${encodeURIComponent(subscriptionId)}/providers/Microsoft.Compute/virtualMachines?api-version=${VM_API}&statusOnly=true`
}

export function azureNicListUrl(subscriptionId: string): string {
  return `${MGMT}/subscriptions/${encodeURIComponent(subscriptionId)}/providers/Microsoft.Network/networkInterfaces?api-version=${NET_API}`
}

export function azurePublicIpListUrl(subscriptionId: string): string {
  return `${MGMT}/subscriptions/${encodeURIComponent(subscriptionId)}/providers/Microsoft.Network/publicIPAddresses?api-version=${NET_API}`
}

interface AzureListJson {
  value?: unknown[]
}

/** Azure so id resource KHÔNG phân biệt hoa thường (casing trả về không nhất quán giữa API). */
const idKey = (id: unknown): string => (typeof id === 'string' ? id.toLowerCase() : '')

export function joinAzureInstances(
  vmsJson: unknown,
  nicsJson: unknown,
  publicIpsJson: unknown
): { instances: CloudInstanceDto[]; warnings: string[] } {
  const warnings: string[] = []
  const vms = (vmsJson as AzureListJson | null)?.value
  if (!Array.isArray(vms)) {
    return { instances: [], warnings: ['Phản hồi không đúng dạng danh sách VM của Azure'] }
  }
  const nics = (nicsJson as AzureListJson | null)?.value ?? []
  const ips = (publicIpsJson as AzureListJson | null)?.value ?? []

  // Public IP id → địa chỉ
  const ipById = new Map<string, string>()
  for (const raw of ips) {
    const ip = raw as { id?: unknown; properties?: { ipAddress?: unknown } }
    if (typeof ip?.properties?.ipAddress === 'string') ipById.set(idKey(ip.id), ip.properties.ipAddress)
  }

  // NIC id → {privateIp, publicIpId}
  const nicById = new Map<string, { privateIp: string | null; publicIpId: string }>()
  for (const raw of nics) {
    const nic = raw as {
      id?: unknown
      properties?: { ipConfigurations?: Array<{ properties?: { privateIPAddress?: unknown; publicIPAddress?: { id?: unknown } } }> }
    }
    const cfg = nic?.properties?.ipConfigurations?.[0]?.properties
    nicById.set(idKey(nic?.id), {
      privateIp: typeof cfg?.privateIPAddress === 'string' ? cfg.privateIPAddress : null,
      publicIpId: idKey(cfg?.publicIPAddress?.id)
    })
  }

  const instances: CloudInstanceDto[] = []
  for (const raw of vms) {
    const vm = raw as {
      id?: unknown
      name?: unknown
      location?: unknown
      tags?: Record<string, string>
      properties?: {
        vmId?: unknown
        hardwareProfile?: { vmSize?: unknown }
        networkProfile?: { networkInterfaces?: Array<{ id?: unknown }> }
        instanceView?: { statuses?: Array<{ code?: unknown }> }
      }
    }
    if (typeof vm?.name !== 'string') continue

    const nicRef = vm.properties?.networkProfile?.networkInterfaces?.[0]
    const nic = nicById.get(idKey(nicRef?.id))
    // statusOnly=true trả instanceView.statuses, code dạng 'PowerState/running'
    const power = vm.properties?.instanceView?.statuses?.find(
      (s) => typeof s?.code === 'string' && s.code.startsWith('PowerState/')
    )
    const status = typeof power?.code === 'string' ? power.code.slice('PowerState/'.length) : ''

    instances.push({
      id: typeof vm.properties?.vmId === 'string' ? vm.properties.vmId : String(vm.id ?? vm.name),
      name: vm.name,
      publicIp: (nic && ipById.get(nic.publicIpId)) || null,
      privateIp: nic?.privateIp ?? null,
      region: typeof vm.location === 'string' ? vm.location : '',
      status: status === 'running' ? 'active' : status,
      tags: vm.tags ? Object.entries(vm.tags).map(([k, v]) => (v ? `${k}=${v}` : k)) : [],
      image: '',
      sizeSlug: typeof vm.properties?.hardwareProfile?.vmSize === 'string' ? vm.properties.hardwareProfile.vmSize : '',
      exists: false
    })
  }
  return { instances, warnings }
}
