// Plugin mẫu "Hello World" — chứng minh: đăng ký lệnh + mở panel markdown.
// Chạy trong worker_thread của app; chỉ truy cập app qua `api`.

module.exports.activate = (api) => {
  api.commands.register('hello.say', 'Hello: Chào', async () => {
    await api.ui.showPanel({
      title: 'Hello World',
      markdown: [
        '# Xin chào 👋',
        '',
        'Plugin **hoạt động**!',
        '',
        '- Đây là panel markdown',
        '- Render an toàn (không HTML thô)',
        '',
        '```',
        'echo "hi from plugin"',
        '```'
      ].join('\n')
    })
  })

  api.log('hello-world đã activate')
}
