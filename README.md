# Interface Sensitive Check

一个纯浏览器端的 Chrome Manifest V3 合规检查插件，用于检查当前网页的接口响应是否明文返回敏感信息。

## MVP 规则

当前内置硬规则：

- 中国大陆手机号（完整 11 位）
- 中国居民身份证号（18 位校验码验证，并兼容历史 15 位号码）
- 出生年月 / 完整出生日期（仅在 birthday / birthDate / birth_day / DOB / 出生日期等字段中检测；支持年月和年月日常见格式，避免把订单日期等普通日期误报为生日）

命中即记为 `FAIL`，不判断“是否本人数据”等业务上下文。扫描结果只保留脱敏后的证据。

## 工作原理

1. Side Panel 请求开始扫描当前标签页。
2. Background Service Worker 通过 `chrome.debugger` 附加当前 Tab。
3. 使用 Chrome DevTools Protocol `Network` 域监听 `Fetch` / `XHR`。
4. `Network.loadingFinished` 后读取 `Network.getResponseBody`。
5. JSON 响应递归扫描并输出 JSONPath；非 JSON 文本进行全文扫描。
6. 结果保存在 `chrome.storage.session`，不上传服务器；证据只保存脱敏值，请求 URL 丢弃 query/fragment，并对疑似动态敏感 path 段做 redaction。

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
5. 打开普通网页，点击插件图标打开 Side Panel
6. 点击“开始扫描”，正常操作网页触发接口请求

## 当前限制

- 只监听用户主动启动扫描的当前标签页。
- 第一版只检查 Fetch / XHR 响应。
- 打开 Chrome DevTools 可能导致 `chrome.debugger` 会话被浏览器断开。
- 为控制内存，单次最多在界面保留 1000 条违规记录。

## Roadmap

- 可配置规则启停与自定义规则
- 域名白名单 / 接口排除
- 银行卡、邮箱、Token 等更多规则
- HTML / JSON 合规报告导出
- 请求级聚合与去重
- 大响应体扫描性能指标
