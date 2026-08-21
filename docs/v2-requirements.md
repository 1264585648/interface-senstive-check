# Interface Sensitive Check V2 需求文档

## 1. 版本目标

基于 MVP 已完成的接口敏感信息检测能力，二期增强规则管理、结果管理和测试报告能力。

核心能力：

1. 规则支持增删改
2. 检测结果支持按接口去重（可选）
3. 检测结果支持导出（仅接口和位置）

---

# 2. 规则管理

## 2.1 规则列表

新增规则管理能力。

每条规则展示：

- 启用状态
- 规则名称
- 描述
- 匹配方式
- 表达式
- 更新时间
- 编辑/删除操作

## 2.2 新增规则

字段：

- 规则名称
- 规则描述
- 匹配类型
- 表达式
- 测试输入

支持：

- Regex
- 自定义检测函数

## 2.3 编辑规则

支持修改：

- 名称
- 描述
- 表达式
- 启用状态

修改后仅影响后续接口检测。

## 2.4 删除规则

删除前二次确认。

删除后：

- 不参与后续检测
- 历史结果保留

---

# 3. 检测结果接口去重

## 3.1 开关

结果页面增加：

接口去重 Switch

默认关闭。

## 3.2 去重规则

唯一标识：

HTTP Method + URL Path

例如：

GET /api/user/detail?id=1
GET /api/user/detail?id=2

聚合为：

GET /api/user/detail

## 3.3 展示

去重模式展示：

- 接口
- 命中规则列表
- 命中次数
- 查看详情

展开后查看 JSONPath 位置。

---

# 4. 检测结果导出

## 4.1 导出入口

结果页增加导出按钮。

## 4.2 格式

二期支持 CSV。

## 4.3 导出字段

仅导出：

- 接口
- 位置

不导出：

- 敏感明文
- Response Body
- 请求参数

示例：

接口,位置
GET /api/user/detail,$.data.phone

---

# 5. 数据结构调整

## Rule

```ts
interface ComplianceRule {
 id:string;
 name:string;
 description:string;
 type:"regex"|"custom";
 expression:string;
 enabled:boolean;
}
```

## FindingGroup

```ts
interface FindingGroup {
 key:string;
 method:string;
 url:string;
 count:number;
 rules:string[];
 locations:string[];
}
```

---

# 6. 高保真页面规划

## 页面 1：规则管理

顶部：

规则管理 + 新建规则按钮

列表卡片：

- 状态 Switch
- 名称
- 描述
- 编辑
- 删除

## 页面 2：新增规则弹窗

字段：

规则名称
描述
匹配类型
表达式
测试输入

按钮：

取消 / 保存

## 页面 3：检测结果

顶部：

检测结果

按钮：

- 接口去重
- 导出

## 页面 4：去重结果

展示：

接口
命中规则
次数
查看详情

## 页面 5：导出弹窗

提示：

仅导出接口和位置，不导出敏感数据。

---

# 7. 验收标准

- 支持规则新增、编辑、删除
- 新规则立即参与扫描
- 支持接口维度去重
- 去重后可查看详细位置
- CSV 导出仅包含接口和位置
