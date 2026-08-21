# Interface Sensitive Check

一个纯浏览器端的 Chrome Manifest V3 合规检查插件，用于检查当前网页的接口响应是否明文返回敏感信息。

## 兼容性

- Chrome 114+
- Manifest V3
- Side Panel API

Chrome 114 是当前最低版本，因为 Side Panel API 从该版本开始支持。Chrome 114–117 的 Extension Service Worker 可能在空闲时被回收，因此项目只把非敏感的采集状态和请求元数据放入 `chrome.storage.session` 用于恢复；Response Body 和命中的敏感明文不会持久化。

## MVP 规则

当前内置硬规则：

- 中国大陆手机号
- 中国居民身份证号（18 位校验码验证，并兼容历史 15 位号码）
- 完整出生日期 / 出生年月（仅在 birthday / birthDate / birth_day / DOB / 出生日期等生日语义字段中检测）

命中即记录，不判断“是否本人数据”等业务上下文。

## 工作原理

1. 用户在 Side Panel 点击“开始采集”。
2. Background Service Worker 通过 `chrome.debugger` 附加当前 Tab。
3. 使用 Chrome DevTools Protocol `Network` 域监听 Fetch / XHR。
4. `Network.loadingFinished` 后读取 `Network.getResponseBody`。
5. JSON 响应递归扫描并输出 JSONPath；非 JSON 文本进行规则扫描。
6. 命中的敏感明文通过 runtime message 发送到 Side Panel，只保存在当前 UI 会话内存中。
7. 用户点击“结束采集”后立即 detach debugger。

## 数据安全

不会持久化：

- Response Body
- 完整手机号
- 完整身份证号
- 完整出生日期
- 其他命中敏感原文

允许持久化的只有非敏感数据：

- 规则开关
- 采集状态
- requestId / method / status / MIME type
- 已移除 query / fragment 且动态路径已裁剪的 URL

敏感信息明文只用于当前采集会话确认是否真实泄露，不上传服务器。

## 本地开发

```bash
npm install
npm test
npm run build
```

构建后：

1. 打开 `chrome://extensions/`
2. 开启“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择 `dist/`
5. 打开普通 HTTP/HTTPS 网页
6. 点击插件图标打开 Side Panel
7. 点击“开始采集”，正常操作网页触发接口请求

## 文档

- `docs/requirements.md`：MVP 需求文档
- `docs/prototype.html`：高保真 HTML 原型
- `docs/chrome-extension-guidelines.md`：Chrome 扩展工程规范

## 验证状态

GitHub Actions 已验证：

- `npm test`：通过
- `npm run build`：通过

## 当前限制

- 只监听用户主动开始采集时所在的当前标签页。
- 第一版只检查 Fetch / XHR 响应。
- 打开 Chrome DevTools 可能导致 `chrome.debugger` 会话被浏览器断开。
- Side Panel 关闭 / 扩展重新加载后，已展示的敏感明文允许丢失。
- 当前 UI 会话最多保留 1000 条命中记录。
