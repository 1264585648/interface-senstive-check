# Chrome 插件开发规范

本文档用于约束 Interface Sensitive Check 的 Chrome 扩展实现，目标是符合 Manifest V3、Chrome 扩展安全规范和 Chrome Web Store 的最小权限 / 用户数据要求。

## 1. 平台基线

- 使用 Manifest V3。
- Background 使用 Extension Service Worker，不使用长期存活的 background page。
- UI 使用 Chrome Side Panel API，不向业务网页注入 UI。
- 最低 Chrome 版本设为 **114**。
  - `chrome.sidePanel` 从 Chrome 114 开始支持，这是当前产品 UI 方案的真正最低版本。
  - `chrome.debugger` 的 MV3 Promise API 在更早版本已支持，因此不是限制因素。
  - Chrome 118 起 active debugger session 会自动保持 Service Worker 存活；Chrome 114–117 没有这一增强，因此代码不能依赖 Service Worker 永久在线。

## 2. 单一用途

插件只做一件事：

> 用户主动开始采集后，检查当前 Tab 的 Fetch / XHR 接口响应是否包含明文敏感信息。

不加入与该目标无关的浏览器增强、广告、搜索、页面修改等功能。

## 3. 权限最小化

MVP 只申请必要权限：

```json
{
  "permissions": [
    "debugger",
    "sidePanel",
    "storage"
  ]
}
```

### debugger

用于连接当前 Tab 的 Chrome DevTools Protocol，并监听 Network 事件 / 获取 Response Body。

该权限会产生较强的 Chrome 权限提示，因此必须遵守：

- 只有用户点击“开始采集”后才 attach。
- 只 attach 用户当前选择的 Tab。
- 用户点击“结束采集”立即 detach。
- 不后台自动 attach 任意网页。

### sidePanel

用于展示规则、采集控制和检测结果。

### storage

允许保存两类**非敏感数据**：

1. 用户配置，例如规则是否启用。
2. 为兼容 Chrome 114–117 Service Worker 被回收而保存的采集元数据，例如：
   - 当前采集 tabId。
   - attached 状态。
   - requestId。
   - HTTP Method。
   - HTTP Status。
   - MIME Type。
   - 已去 query / fragment 且动态路径已裁剪的 URL。

禁止保存：

- Response Body。
- 原始手机号。
- 原始身份证号。
- 原始出生日期。
- 其他命中的敏感原文。

### 不申请 tabs 权限

获取当前激活 Tab 的 `tabId` 不要求 `tabs` 权限。需要判断目标 URL 时优先使用 `chrome.debugger.getTargets()` 返回的 TargetInfo，而不是依赖读取 `Tab.url`。

## 4. 敏感数据生命周期

### Response Body

Response Body 仅允许：

1. 通过 CDP 获取。
2. 在 Service Worker 当前事件处理中扫描。
3. 扫描结束后释放。

禁止写入任何持久化存储。

### 命中的原始敏感值

为了让测试人员确认接口确实返回了明文，结果 UI 必须展示原始命中值。

但原始值只允许存在于当前插件会话内存中：

```text
CDP Response
   ↓
Service Worker 扫描
   ↓
FINDINGS_ADDED message
   ↓
Side Panel React state
   ↓
用户查看
```

禁止写入：

- `chrome.storage.local`
- `chrome.storage.session`
- `chrome.storage.sync`
- localStorage
- IndexedDB
- CacheStorage
- console 日志
- 文件
- 远程服务

关闭 Side Panel / 重新加载插件后，已经展示的原始明文允许丢失。

## 5. Service Worker 设计

Extension Service Worker：

- 不访问 DOM。
- 只负责权限调用、CDP 监听、规则扫描和消息分发。
- 不假设普通全局变量可以永久存活。
- 所有事件监听器必须在模块顶层同步注册。
- Chrome 118+ 可受益于 active debugger session 自动保活。
- Chrome 114–117 必须允许 Service Worker 在空闲时被 Chrome 正常回收，不能用人为无限定时器强行保活。

### Chrome 114–117 恢复策略

为兼容 Service Worker 生命周期，以下数据可写入 `chrome.storage.session`：

```text
scan-state:<tabId>
pending-method:<tabId>:<requestId>
pending-response:<tabId>:<requestId>
```

其中 pending response 只能包含已经安全处理后的非敏感元数据。

当后续 debugger event 唤醒 Service Worker 时：

- 从 `chrome.storage.session` 读取所需 request metadata。
- 获取 Response Body。
- 在内存完成扫描。
- 将命中明文通过 runtime message 发送到 Side Panel。
- 随即删除 pending metadata。

任何情况下都不得为了恢复 Service Worker 而持久化 Response Body 或命中原文。

## 6. CDP 使用范围

仅使用项目真正需要的 Network 能力：

- `Network.enable`
- `Network.requestWillBeSent`
- `Network.responseReceived`
- `Network.loadingFinished`
- `Network.loadingFailed`
- `Network.getResponseBody`

MVP 不使用 CDP 修改页面、执行脚本、修改 DOM、拦截或改写请求。

只处理：

- Fetch
- XHR

## 7. Side Panel 规范

Side Panel 是插件唯一主界面。

页面只包含：

1. 规则列表。
2. 开始采集。
3. 结束采集。
4. 检测结果。

Side Panel 内存负责保存当前 UI 会话中的原始 Finding。

当收到：

```text
FINDINGS_ADDED
```

时追加结果。

当开始新一轮采集时清空上一轮结果。

## 8. 消息安全

`chrome.runtime.onMessage` 只接受明确声明的消息类型。

所有携带 `tabId` 的操作都必须验证：

- tabId 是 number。
- 对应 debugger target 存在。
- 目标为普通 `http://` / `https://` 页面。

不支持从网页 / content script 触发任意 debugger 命令。

MVP 不配置 `externally_connectable`。

## 9. URL 安全

结果中 URL：

- 去掉 query string。
- 去掉 fragment。
- 对疑似包含大量数字 / 长标识符的 path segment 做 redaction。

避免 URL 自身再次保存敏感数据。

## 10. Content Security Policy

所有 JavaScript 必须随扩展打包发布。

禁止：

- 远程加载 JS。
- `eval()`。
- `new Function()`。
- 从远程接口下载代码并执行。

Manifest 明确设置：

```json
{
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self';"
  }
}
```

## 11. Chrome Web Store 用户数据要求

HTTP 请求 / 响应内容和浏览活动都属于 Chrome Web Store 用户数据政策覆盖范围。

因此上架时必须明确披露：

- 插件会在用户主动开始采集后读取当前 Tab 的接口响应内容。
- 读取仅用于检测敏感信息明文。
- 数据在本地处理。
- 不上传 Response Body。
- 不上传敏感信息。
- 不用于广告、画像或与本功能无关的用途。

如果公开上架，需要提供隐私政策和 Privacy practices 声明。

## 12. debugger detach 行为

Chrome 在以下情况可能断开 debugger：

- Tab 关闭。
- 用户对同一个 Tab 打开 DevTools。
- 用户 / Chrome 主动取消调试会话。

插件必须监听 `chrome.debugger.onDetach` 并：

- 将采集状态切换为结束 / 中断。
- 清理 pending metadata。
- 在 Side Panel 给出明确提示。
- 不自动重新 attach，等待用户再次点击开始采集。

## 13. 性能约束

- 单 Response 最大扫描体积：10 MB。
- 最大 JSON 深度：30。
- 最大 JSON 节点数：50,000。
- 二进制响应跳过。
- 单个 Response 失败不能中断整个采集 Session。

## 14. 工程要求

每次提交至少执行：

```bash
npm test
npm run build
```

核心规则必须有单元测试覆盖：

- 正常命中。
- 已脱敏值不命中。
- 非法身份证校验码不命中。
- 普通业务日期不误报出生日期。
- JSON 大整数兜底。

兼容性至少覆盖：

- Chrome 114–117：Service Worker 可被正常回收后继续处理新 debugger events。
- Chrome 118+：利用浏览器自身 debugger lifetime 改善，不写版本专属业务逻辑。

## 15. 当前架构决定

MVP 最终数据流：

```text
用户点击开始采集
        ↓
Side Panel -> START_SCAN(tabId)
        ↓
Service Worker
        ↓
chrome.debugger.attach
        ↓
CDP Network Events
        ↓
非敏感 request metadata -> chrome.storage.session（兼容恢复）
        ↓
Network.getResponseBody
        ↓
Rule Engine
        ↓
FINDINGS_ADDED(rawValue)
        ↓
Side Panel 内存展示明文
        ↓
用户点击结束采集
        ↓
chrome.debugger.detach
```

敏感明文不进入持久化存储。