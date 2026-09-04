/**
 * Hằng NHÚNG LÚC BUILD cho main process — khai ở `define` của khối `main` trong
 * electron.vite.config.ts. Giá trị lấy từ env lúc build (CI đặt từ GitHub Variables),
 * build local không đặt env thì là chuỗi rỗng.
 */
declare const __GOOGLE_CLIENT_ID__: string
declare const __GOOGLE_CLIENT_SECRET__: string
