# Interface Sensitive Check — MVP 需求文档

## 1. 产品目标

开发一个纯浏览器插件，用于在用户正常访问网页时，采集当前页面产生的接口响应，并根据预设规则检查返回内容中是否存在明文敏感信息。

MVP 只解决一个问题：

> **接口响应中是否出现了不允许明文返回的敏感数据。**

不判断业务上下文、不判断“是否本人数据”、不做漏洞评级。只要命中启用中的合规规则，即记录为违规项。

## 2. Chrome 兼容性

- Manifest V3
- Chrome 114+
- Side Panel API

Chrome 114 是 MVP 最低支持版本，因为 Side Panel API 从 Chrome 114 开始可用。

Chrome 114–117 的 Extension Service Worker 可能在空闲时被浏览器回收，因此实现不得依赖 Service Worker 永久在线。允许把非敏感采集状态和请求元数据临时存入 `chrome.storage.session` 做事件恢复，但禁止持久化 Response Body 和命中的敏感明文。

Chrome 118+ 可自然受益于 active `chrome.debugger` session 对 Service Worker 生命周期的改善，但业务逻辑不得依赖该版本特性。

---

## 3. MVP 范围

MVP 仅包含以下四个核心能力：

1. 维护敏感信息规则列表
2. 开始采集当前页面接口响应
3. 结束采集
4. 展示采集到的敏感信息

以下功能暂不进入 MVP：

- 风险评分
- 漏洞定级
- 用户身份判断
- 业务上下文推断
- 自动判断数据是否属于当前用户
- 云端上传
- 多用户协作
- 报告中心
- 复杂统计看板

---

## 4. 使用流程

```text
打开目标网页
   ↓
打开浏览器插件
   ↓
确认启用的规则
   ↓
点击「开始采集」
   ↓
正常操作网页
   ↓
插件监听当前 Tab 的 Fetch / XHR 响应
   ↓
响应内容进入本地规则引擎
   ↓
命中规则则记录敏感信息
   ↓
右侧实时展示接口返回的敏感信息明文
   ↓
点击「结束采集」
```

---

## 5. 页面结构

整体采用简单的双栏布局；在浏览器 Side Panel 较窄时自动切换为纵向布局。

### 左侧：规则列表 + 采集控制

#### 5.1 规则列表

每条规则显示：

- 是否启用
- 规则名称
- 规则说明
- 匹配方式/表达式

MVP 不提供新增、编辑、删除规则 UI，只维护内置规则和启停开关。

示例：

| 启用 | 规则名称 | 说明 |
| --- | --- | --- |
| ✓ | 手机号 | 中国大陆完整手机号 |
| ✓ | 身份证号 | 中国居民身份证号 |
| ✓ | 完整出生日期 | 生日语义字段中的完整年月日 |

#### 5.2 采集控制

只保留两个主要操作：

- **开始采集**
- **结束采集**

状态：

- 未采集
- 采集中
- 已结束

开始采集后，只监听用户发起采集时所在的当前 Tab。

---

### 右侧：检测结果

展示本次采集过程中命中的敏感信息。

表格字段：

| 字段 | 说明 |
| --- | --- |
| 时间 | 检测到该数据的时间 |
| 接口 | HTTP Method + 接口地址 |
| 类型 | 命中的规则名称 |
| 敏感信息（明文） | 接口实际返回的原始敏感值 |
| 位置 | JSONPath 或响应中的定位信息 |

示例：

| 时间 | 接口 | 类型 | 敏感信息（明文） | 位置 |
| --- | --- | --- | --- | --- |
| 14:30:25 | GET /api/user/detail | 手机号 | 13800138000 | $.data.user.phone |
| 14:30:21 | POST /api/order/create | 身份证号 | 11010519491231002X | $.data.idCard |
| 14:30:18 | GET /api/user/info | 完整出生日期 | 1990-05-18 | $.data.birthDate |

结果默认按检测时间倒序排列。

明文显示是产品要求：测试人员必须能够据此确认接口确实返回了完整敏感数据，而不是仅凭规则名称或脱敏值推断。

---

## 6. 内置规则

### 6.1 中国大陆手机号

目标：检测接口响应中的完整中国大陆手机号。

需要支持常见格式：

```text
13800138000
+86 13800138000
+86-138-0013-8000
138-0013-8000
138 0013 8000
```

以下已脱敏格式不得命中：

```text
138****8000
138****0000
```

命中后 UI 展示接口实际返回原文，例如：

```text
13800138000
```

---

### 6.2 中国居民身份证号

检测：

- 18 位身份证号
- 15 位历史身份证号

18 位身份证必须执行：

- 长度校验
- 出生日期合法性校验
- 校验码验证

示例：

```text
11010519491231002X
```

命中后 UI 直接显示该原文。

---

### 6.3 完整出生日期

检测完整出生年月日，例如：

```text
1990-05-18
1990/05/18
1990.05.18
19900518
1990年05月18日
```

为了降低普通业务日期误报，MVP 仅在具有生日语义的字段中判定出生日期。

生日字段关键词示例：

```text
birthday
birthDate
birth_date
birthDay
birthMonth
dateOfBirth
dob
出生日期
出生年月
生日
```

例如：

```json
{
  "birthday": "1990-05-18"
}
```

需要命中。

而：

```json
{
  "createdAt": "2026-08-21"
}
```

不应命中。

命中后 UI 直接展示接口原值，例如：

```text
1990-05-18
```

---

## 7. 采集范围

MVP 只处理当前 Tab 中的：

- Fetch
- XMLHttpRequest / XHR

采集内容：

- Request URL
- HTTP Method
- HTTP Status
- Response MIME Type
- Response Body

Response Body 只在当前 debugger 事件处理中用于扫描，不得写入持久化存储。

---

## 8. 响应处理

### JSON 响应

优先解析 JSON，并递归扫描所有字段值。

需要记录命中位置，例如：

```text
$.data.user.phone
$.data.list[3].idCard
```

### 非 JSON 响应

对于文本类响应，可直接对正文执行规则扫描。

MVP 不要求支持二进制响应。

### JSON 大整数

身份证号如果被服务端错误地以 JSON number 返回，JavaScript `JSON.parse` 可能发生整数精度丢失。

因此对于手机号 / 身份证等与字段语义无关的通用数字标识，需要额外对原始 JSON 文本做兜底扫描，避免漏检。

---

## 9. 隐私与安全要求

这是本插件的强制要求。

### 9.1 全部本地处理

- Response 不上传服务器
- 敏感信息不上传服务器
- 规则扫描全部在浏览器本地完成

### 9.2 敏感明文允许展示，但禁止持久化

命中后，UI 必须直接展示接口返回的原始敏感值，用于确认接口确实存在明文返回。

允许的数据流：

```text
Response Body
   ↓
Service Worker 内存扫描
   ↓
RuntimeFinding.rawValue
   ↓
chrome.runtime message
   ↓
Side Panel React state
   ↓
当前会话 UI 明文展示
```

禁止把命中的原始值写入：

- localStorage
- IndexedDB
- chrome.storage.local
- chrome.storage.session
- chrome.storage.sync
- CacheStorage
- 日志文件
- console 日志
- 远程接口

Side Panel 关闭、扩展重新加载后，已展示的敏感明文允许丢失。

### 9.3 允许持久化的非敏感状态

为了兼容 Chrome 114–117 Service Worker 生命周期，可以在 `chrome.storage.session` 中保存：

- 当前采集 tabId
- attached 状态
- scannedResponses 计数
- requestId
- method
- status
- MIME type
- 已安全处理的 URL

这些数据不得包含 Response Body 或规则命中的原始值。

### 9.4 URL 处理

结果列表中不保存 query string 和 fragment，避免 URL 本身包含敏感参数。

例如：

```text
https://example.com/api/user?idCard=11010519491231002X
```

结果只记录：

```text
https://example.com/api/user
```

对于包含大量数字或超长动态标识的 path segment，也需要替换为 `:redacted`。

---

## 10. 采集状态

### 开始采集

点击后：

1. 校验当前 Tab 对应普通 HTTP/HTTPS 页面。
2. 绑定当前 Tab。
3. 开启 Network 监听。
4. 清空上一轮 pending request metadata。
5. 清空当前 Tab 在 Side Panel 内存中的上一轮检测结果。
6. 状态切换为“采集中”。

### 结束采集

点击后：

1. `chrome.debugger.detach` 当前 Tab。
2. 不再处理新的 Response。
3. 清理 pending request metadata。
4. 保留当前 Side Panel 内存中的本轮检测结果供用户查看。
5. 状态切换为“已结束”。

---

## 11. 规则数据结构

规则引擎需要可扩展，但 MVP 不做复杂 DSL。

```ts
interface ComplianceRule {
  id: RuleId;
  name: string;
  description: string;
  expression: string;
  detect: (
    value: string,
    context: {
      path: string;
    }
  ) => string[];
}
```

规则启用状态单独保存为非敏感配置。

---

## 12. 检测结果数据结构

扫描器输出：

```ts
interface Detection {
  ruleId: RuleId;
  ruleName: string;
  path: string;
  rawValue: string;
}
```

运行时 UI 结果：

```ts
interface Finding extends Detection {
  id: string;
  detectedAt: number;
  tabId: number;
  requestId: string;
  method: string;
  url: string;
  status: number;
  mimeType: string;
}
```

`Finding.rawValue` 只允许在运行时消息和 Side Panel 内存中存在。

禁止将整个 `Finding` 写入 `chrome.storage.*`。

---

## 13. UI 交互要求

### 规则列表

- Switch 开启/关闭规则
- 开启后立即用于后续 Response 扫描
- 默认启用全部内置规则
- 已经采集到的历史结果不因关闭规则而消失

### 开始采集

未采集状态可点击。

点击成功后：

```text
开始采集 → disabled
结束采集 → enabled
```

### 结束采集

采集中可点击。

点击后：

```text
开始采集 → enabled
结束采集 → disabled
```

### 结果列表

- 新结果实时显示
- 默认最新结果在最上面
- 敏感信息直接展示接口原文
- 明文使用醒目的红色视觉样式
- 没有结果时显示空状态：

```text
暂无敏感信息
```

---

## 14. 异常处理

### 不支持的页面

例如：

```text
chrome://
edge://
chrome-extension://
```

提示：

```text
当前页面不支持采集，请打开普通 HTTP/HTTPS 页面后重试。
```

### Debugger 被占用

如果当前页面已经被 DevTools 或其他 debugger 工具占用，提示用户关闭后重试，不自动抢占。

### Debugger 被断开

如果用户打开 DevTools 或其他原因导致 debugger session 被断开：

- 自动结束当前采集状态
- 清理 pending metadata
- 页面提示采集已中断
- 用户可重新点击开始采集

### Response 获取失败

单个 Response 获取失败不得导致整个采集过程停止。

只跳过该请求。

---

## 15. 性能要求

MVP 目标：

- 普通页面使用时无明显卡顿
- 单个 Response 扫描不得阻塞 UI
- 对深层 JSON 设置最大递归深度
- 对超大对象设置最大扫描节点数
- 限制单个响应最大扫描体积

当前限制：

```text
最大递归深度：30
最大 JSON 节点：50,000
单 Response 最大扫描体积：10 MB
Side Panel 当前会话最多保留：1,000 条 Finding
```

超过限制直接跳过，不保存响应正文。

---

## 16. MVP 验收标准

### 手机号

接口返回：

```json
{
  "phone": "13800138000"
}
```

结果：必须出现一条手机号检测结果。

显示：

```text
13800138000
```

### 身份证

接口返回合法 18 位身份证：

```json
{
  "idCard": "11010519491231002X"
}
```

结果：必须出现身份证号检测结果，并直接显示该原值。

非法校验码不得命中。

### 出生日期

```json
{
  "birthday": "1990-05-18"
}
```

必须命中并显示 `1990-05-18`。

```json
{
  "createdAt": "2026-08-21"
}
```

不得命中出生日期规则。

### 已脱敏数据

```json
{
  "phone": "138****8000"
}
```

不得产生手机号检测结果。

### 开始/结束

- 点击开始采集后，新接口响应能够被扫描
- 点击结束采集后，新接口响应不得再进入扫描结果

### 数据安全

检查插件存储后：

- 不得存在原始 Response Body
- 不得存在完整手机号
- 不得存在完整身份证号
- 不得存在完整出生日期原值

但在当前 Side Panel React state / 页面 DOM 中允许看到命中的明文，因为这正是确认接口泄露的产品需求。

### Chrome 114–117

- Service Worker 在空闲后允许被 Chrome 回收
- 后续 debugger 事件到达后仍能继续处理请求
- 不依赖永久定时器保活
- 恢复过程中不得把敏感正文或 rawValue 写入 storage

---

## 17. 非 MVP 功能

以下能力后续再做：

- 自定义规则新增/编辑
- 银行卡
- 邮箱
- Token / API Key
- 域名白名单
- 接口忽略规则
- 搜索和筛选
- 导出报告
- 分页
- 统计信息
- 请求级聚合
- 多 Tab 同时采集
- Firefox 独立适配

---

## 18. MVP 最终形态

用户打开插件后只需要看到三部分：

```text
┌──────────────────────────────────────────────────────────────────────┐
│ 接口敏感信息检测                                      ● 采集中     │
├────────────────────────────┬─────────────────────────────────────────┤
│ 规则列表                   │ 检测结果                                │
│                            │                                         │
│ ☑ 手机号                   │ 时间   接口   类型   敏感信息(明文) 位置 │
│ ☑ 身份证号                 │ ...                                    │
│ ☑ 完整出生日期             │                                         │
│                            │                                         │
│ 采集控制                   │                                         │
│ [开始采集] [结束采集]      │                                         │
└────────────────────────────┴─────────────────────────────────────────┘
```

这是 MVP 的完整范围。