import { describe, expect, it } from 'vitest'
import { isReadOnlyCommand } from './readonlyGuard'

describe('isReadOnlyCommand — cho phép lệnh đọc', () => {
  const ok = [
    'uptime',
    'free -m',
    'df -h',
    'df -Pi',
    'cat /proc/loadavg',
    'head -n 50 /var/log/messages',
    'tail -n 100 /var/log/nginx/error.log',
    'grep -i error /var/log/httpd/error_log',
    'ps aux --sort=-%cpu | head -20',
    'ps aux 2>&1 | head',
    'ss -tan state established',
    'netstat -tunlp',
    'ip a',
    'dmesg | tail -50',
    'journalctl -u nginx --no-pager -n 100',
    "awk '$3 > 100 {print $1}' /tmp/x.log",
    "awk -F'ASN: ' 'NF>1{print $2}' access.log | sort | uniq -c | sort -rn | head",
    'systemctl status nginx',
    'systemctl is-active httpd',
    'service nginx status',
    'docker ps -a',
    'docker logs myapp --tail 100',
    'kubectl get pods -A',
    'git log --oneline -20',
    "find /var/log -name '*.log' -mtime -1",
    'echo hi >&2',
    'sudo cat /etc/shadow',
    'timeout 5 ping -c 3 8.8.8.8',
    "sed -n '1,20p' /etc/hosts",
    'du -sh /var/* 2>/dev/null'
  ]
  for (const cmd of ok) {
    it(`OK: ${cmd}`, () => {
      expect(isReadOnlyCommand(cmd).ok).toBe(true)
    })
  }
})

describe('isReadOnlyCommand — chặn lệnh ghi/sửa', () => {
  const bad = [
    'rm -rf /tmp/x',
    'sudo rm -rf /var/log/*',
    'mv a b',
    'cp a b',
    'dd if=/dev/zero of=/dev/sda',
    'systemctl restart nginx',
    'systemctl stop httpd',
    'service nginx restart',
    'kill -9 1234',
    'pkill java',
    'reboot',
    'shutdown -h now',
    'chmod 777 /etc/passwd',
    'chown root:root /x',
    "sed -i 's/a/b/' /etc/hosts",
    'echo test > /etc/motd',
    'cat foo >> /var/log/x',
    'truncate -s 0 /var/log/messages',
    'tee /etc/sysctl.conf',
    'iptables -F',
    'apt-get install nginx',
    'yum remove httpd',
    'pip install requests',
    'npm install',
    'docker rm -f myapp',
    'docker restart web',
    'kubectl delete pod x',
    'kubectl apply -f x.yaml',
    'find / -name core -delete',
    "find /tmp -name '*.tmp' -exec rm {} \\;",
    'crontab -r',
    'uptime; rm -rf /data',
    'ls && systemctl restart sshd',
    'echo $(rm -rf /tmp)',
    'mkfs.ext4 /dev/sdb1',
    'sysctl -w vm.swappiness=10'
  ]
  for (const cmd of bad) {
    it(`CHẶN: ${cmd}`, () => {
      expect(isReadOnlyCommand(cmd).ok).toBe(false)
    })
  }
})

describe('isReadOnlyCommand — biên', () => {
  it('lệnh rỗng bị chặn', () => {
    expect(isReadOnlyCommand('   ').ok).toBe(false)
  })
  it('reason có nội dung khi chặn', () => {
    const v = isReadOnlyCommand('rm -rf /')
    expect(v.ok).toBe(false)
    expect(v.reason).toBeTruthy()
  })
  it('đường dẫn tuyệt đối tới lệnh ghi vẫn chặn', () => {
    expect(isReadOnlyCommand('/bin/rm -rf /x').ok).toBe(false)
  })
})
