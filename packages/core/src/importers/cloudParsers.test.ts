import { generateKeyPairSync, createVerify } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { xmlBlocks, xmlText } from './xmlLite'
import { buildDescribeInstancesBody, ec2Host, parseDescribeInstances } from './awsEc2'
import {
  buildGcpJwt,
  buildGcpTokenBody,
  gcpAggregatedInstancesUrl,
  parseGcpAggregated,
  parseGcpServiceAccount
} from './gcpCompute'
import { azureTokenUrl, azureVmListUrl, buildAzureTokenBody, joinAzureInstances } from './azureVms'

// ---------------------------------------------------------------------------
// xmlLite — cái bẫy chính là <item> lồng trong <item>
// ---------------------------------------------------------------------------

describe('xmlLite', () => {
  test('xmlBlocks ghép đúng cặp khi tag CÙNG TÊN lồng nhau', () => {
    const xml = '<item>A<item>B</item>C</item><item>D</item>'
    expect(xmlBlocks(xml, 'item')).toEqual(['A<item>B</item>C', 'D'])
  })

  test('xmlBlocks với tag có attribute, XML cụt không ném', () => {
    expect(xmlBlocks('<a x="1">v</a>', 'a')).toEqual(['v'])
    expect(xmlBlocks('<a>chua dong', 'a')).toEqual([])
  })

  test('xmlText: tag đơn đầu tiên, decode entity', () => {
    expect(xmlText('<x><name>a&amp;b</name><name>c</name></x>', 'name')).toBe('a&b')
    expect(xmlText('<x/>', 'name')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// AWS EC2
// ---------------------------------------------------------------------------

/** Fixture rút gọn nhưng GIỮ đúng cấu trúc lồng: reservation > instancesSet > item, tagSet > item. */
const EC2_XML = `<?xml version="1.0"?>
<DescribeInstancesResponse xmlns="http://ec2.amazonaws.com/doc/2016-11-15/">
  <reservationSet><item>
    <instancesSet>
      <item>
        <instanceId>i-0abc1234</instanceId>
        <instanceState><code>16</code><name>running</name></instanceState>
        <instanceType>t3.small</instanceType>
        <placement><availabilityZone>ap-southeast-1a</availabilityZone></placement>
        <privateIpAddress>10.20.30.11</privateIpAddress>
        <ipAddress>203.0.113.21</ipAddress>
        <tagSet>
          <item><key>Name</key><value>web-01</value></item>
          <item><key>env</key><value>prod</value></item>
        </tagSet>
      </item>
      <item>
        <instanceId>i-0def5678</instanceId>
        <instanceState><code>80</code><name>stopped</name></instanceState>
        <instanceType>t3.micro</instanceType>
        <placement><availabilityZone>ap-southeast-1b</availabilityZone></placement>
        <privateIpAddress>10.20.30.12</privateIpAddress>
      </item>
      <item>
        <instanceId>i-0dead999</instanceId>
        <instanceState><code>48</code><name>terminated</name></instanceState>
      </item>
    </instancesSet>
  </item></reservationSet>
</DescribeInstancesResponse>`

describe('parseDescribeInstances', () => {
  test('đọc instance chạy + dừng, BỎ terminated; tag Name làm nhãn, tag khác về key=value', () => {
    const { instances, warnings } = parseDescribeInstances(EC2_XML)
    expect(warnings).toEqual([])
    expect(instances).toHaveLength(2)
    expect(instances[0]).toMatchObject({
      id: 'i-0abc1234',
      name: 'web-01',
      publicIp: '203.0.113.21',
      privateIp: '10.20.30.11',
      region: 'ap-southeast-1a',
      status: 'active',
      tags: ['env=prod'],
      sizeSlug: 't3.small'
    })
    // Máy dừng: không tên → nhãn = instanceId; không IP public
    expect(instances[1]).toMatchObject({ id: 'i-0def5678', name: 'i-0def5678', publicIp: null, status: 'stopped' })
  })

  test('phản hồi lạ → warning, không ném', () => {
    expect(parseDescribeInstances('<Error><Code>AuthFailure</Code></Error>').warnings).toHaveLength(1)
  })

  test('body + host dựng đúng', () => {
    expect(buildDescribeInstancesBody()).toBe('Action=DescribeInstances&Version=2016-11-15')
    expect(ec2Host('ap-southeast-1')).toBe('ec2.ap-southeast-1.amazonaws.com')
  })
})

// ---------------------------------------------------------------------------
// GCP
// ---------------------------------------------------------------------------

describe('GCP', () => {
  test('parseGcpServiceAccount: nhận file key hợp lệ, chối file thiếu trường', () => {
    const sa = parseGcpServiceAccount(
      JSON.stringify({ client_email: 'sa@example.iam.gserviceaccount.com', private_key: 'PEM', project_id: 'proj-1' })
    )
    expect(sa).toEqual({ email: 'sa@example.iam.gserviceaccount.com', privateKeyPem: 'PEM', projectId: 'proj-1' })
    expect(parseGcpServiceAccount('{"client_email":"x"}')).toBeNull()
    expect(parseGcpServiceAccount('khong-phai-json')).toBeNull()
  })

  test('buildGcpJwt: chữ ký RS256 verify được bằng public key, claims đúng', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    const now = 1_700_000_000_000
    const jwt = buildGcpJwt({ email: 'sa@example.com', privateKeyPem: pem, projectId: 'p' }, now)

    const [header, claims, sig] = jwt.split('.')
    expect(JSON.parse(Buffer.from(header!, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' })
    const payload = JSON.parse(Buffer.from(claims!, 'base64url').toString())
    expect(payload).toMatchObject({
      iss: 'sa@example.com',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1_700_000_000,
      exp: 1_700_000_000 + 3600
    })
    const ok = createVerify('RSA-SHA256')
      .update(`${header}.${claims}`)
      .verify(publicKey, Buffer.from(sig!, 'base64url'))
    expect(ok).toBe(true)

    expect(buildGcpTokenBody(jwt)).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer')
    expect(gcpAggregatedInstancesUrl('proj-1')).toBe(
      'https://compute.googleapis.com/compute/v1/projects/proj-1/aggregated/instances'
    )
  })

  test('parseGcpAggregated: đọc instance qua các zone, natIP là public, RUNNING → active', () => {
    const { instances } = parseGcpAggregated({
      items: {
        'zones/asia-southeast1-a': {
          instances: [
            {
              id: '123456789',
              name: 'web-01',
              status: 'RUNNING',
              machineType: 'https://compute.googleapis.com/…/machineTypes/e2-small',
              labels: { env: 'prod' },
              networkInterfaces: [{ networkIP: '10.20.30.11', accessConfigs: [{ natIP: '203.0.113.31' }] }]
            }
          ]
        },
        'zones/asia-southeast1-b': { warning: { code: 'NO_RESULTS_ON_PAGE' } } as never
      }
    })
    expect(instances).toHaveLength(1)
    expect(instances[0]).toMatchObject({
      id: '123456789',
      name: 'web-01',
      publicIp: '203.0.113.31',
      privateIp: '10.20.30.11',
      region: 'asia-southeast1-a',
      status: 'active',
      tags: ['env=prod'],
      sizeSlug: 'e2-small'
    })
  })

  test('parseGcpAggregated: JSON sai dạng → warning, không ném', () => {
    expect(parseGcpAggregated(null).warnings).toHaveLength(1)
    expect(parseGcpAggregated({}).warnings).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Azure — phép join VM → NIC → Public IP
// ---------------------------------------------------------------------------

describe('Azure', () => {
  const SUB = '/subscriptions/00000000-0000-0000-0000-000000000000'
  const vms = {
    value: [
      {
        id: `${SUB}/resourceGroups/RG1/providers/Microsoft.Compute/virtualMachines/web-01`,
        name: 'web-01',
        location: 'southeastasia',
        tags: { env: 'prod' },
        properties: {
          vmId: 'aaaa-bbbb',
          hardwareProfile: { vmSize: 'Standard_B2s' },
          networkProfile: { networkInterfaces: [{ id: `${SUB}/resourceGroups/RG1/providers/Microsoft.Network/networkInterfaces/web-01-nic` }] },
          instanceView: { statuses: [{ code: 'ProvisioningState/succeeded' }, { code: 'PowerState/running' }] }
        }
      },
      {
        id: `${SUB}/resourceGroups/RG1/providers/Microsoft.Compute/virtualMachines/db-01`,
        name: 'db-01',
        location: 'southeastasia',
        properties: {
          vmId: 'cccc-dddd',
          hardwareProfile: { vmSize: 'Standard_B1ms' },
          networkProfile: { networkInterfaces: [{ id: `${SUB}/RG1/NIC/db-01-nic` }] },
          instanceView: { statuses: [{ code: 'PowerState/deallocated' }] }
        }
      }
    ]
  }
  const nics = {
    value: [
      {
        // Case KHÁC với id trong VM (Azure hay trả vậy) — join phải case-insensitive
        id: `${SUB}/resourceGroups/rg1/providers/Microsoft.Network/networkInterfaces/WEB-01-NIC`,
        properties: {
          ipConfigurations: [
            { properties: { privateIPAddress: '10.20.30.41', publicIPAddress: { id: `${SUB}/RG1/publicIPAddresses/web-01-ip` } } }
          ]
        }
      },
      {
        id: `${SUB}/RG1/NIC/db-01-nic`,
        properties: { ipConfigurations: [{ properties: { privateIPAddress: '10.20.30.42' } }] }
      }
    ]
  }
  const ips = { value: [{ id: `${SUB}/rg1/publicipaddresses/WEB-01-IP`, properties: { ipAddress: '203.0.113.41' } }] }

  test('join đủ 3 danh sách: public IP theo chuỗi VM→NIC→IP, so id không phân biệt hoa thường', () => {
    const { instances, warnings } = joinAzureInstances(vms, nics, ips)
    expect(warnings).toEqual([])
    expect(instances[0]).toMatchObject({
      id: 'aaaa-bbbb',
      name: 'web-01',
      publicIp: '203.0.113.41',
      privateIp: '10.20.30.41',
      region: 'southeastasia',
      status: 'active',
      tags: ['env=prod'],
      sizeSlug: 'Standard_B2s'
    })
    // VM không có public IP → null; PowerState/deallocated giữ nguyên văn
    expect(instances[1]).toMatchObject({ name: 'db-01', publicIp: null, privateIp: '10.20.30.42', status: 'deallocated' })
  })

  test('VM list sai dạng → warning, không ném; NIC/IP thiếu thì máy vẫn ra với IP null', () => {
    expect(joinAzureInstances(null, null, null).warnings).toHaveLength(1)
    const { instances } = joinAzureInstances(vms, null, null)
    expect(instances[0]).toMatchObject({ publicIp: null, privateIp: null })
  })

  test('URL/body token client-credentials', () => {
    expect(azureTokenUrl('tenant-1')).toBe('https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token')
    const body = buildAzureTokenBody('client-1', 's3cret')
    expect(body).toContain('grant_type=client_credentials')
    expect(body).toContain('scope=https%3A%2F%2Fmanagement.azure.com%2F.default')
    expect(azureVmListUrl('sub-1')).toContain('/subscriptions/sub-1/providers/Microsoft.Compute/virtualMachines')
    expect(azureVmListUrl('sub-1')).toContain('statusOnly=true')
  })
})
