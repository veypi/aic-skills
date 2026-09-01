---
name: intelligence_analysis
nickname: 商业航天情报分析
description: ORBITALINTEL 商业航天情报分析：全产业链公司/产品/发射/融资/关系数据库、事故案例库、监管知识库、AI 合规审查，世界地图情报舱联动。外部 AI 经同源 api 读写数据、经 pageDesc 指令驱动地图
keywords: [航天, 商业航天, 公司分析, 事故案例, 监管法规, 合规审查, 情报分析, aerospace, space, launch, satellite, regulation, compliance]
icon: fa-solid fa-satellite
ui:
  - path: index.html
    desc: ORBITALINTEL 情报舱主页面（世界地图 + 航天设施/公司/事故图层 + 情报卡，AI 地图联动指令面）
  - path: companies.html
    desc: 公司列表（搜索/筛选/分页）
  - path: accidents.html
    desc: 事故案例库列表（类型/严重度/调查状态筛选）
  - path: regulations.html
    desc: 监管知识库列表（类型/机构/状态筛选）
  - path: reviews.html
    desc: 合规审查案件列表（新建审查入口）
---

# 商业航天情报分析（ORBITALINTEL）

专业的商业航天（Commercial Aerospace / New Space）行业分析 skill，四大板块 + 设施情报：

- **板块一：公司分析** —— 全产业链公司、产品、发射、融资、关系网络
- **板块二：事故案例库** —— 发射事故/地面测试事故/设施事故/发动机测试，追溯根因与经验教训
- **板块三：监管知识库** —— 法律法规、政策文件、标准规范、审批规则、技术指南、监管经验
- **板块四：AI 合规审查** —— 对申报材料智能初审：缺项、冲突、风险、整改建议
- **航天设施情报** —— 全球发射场/试车台/着陆区/测控站（含经纬度，地图标注）

数据存于本 skill 私有 sqlite（11 张表），经 `api/` 声明式接口读写。页面零内嵌 AI——
操控面 = `pageDesc` 指令 + 同源 api，全部由外部 AI 驱动。

## 外部 AI 操作方式

1. **打开页面**：`open {url_prefix}/index.html`（`url_prefix` 由 skills 工具返回，形如
   `/skills/local/intelligence_analysis` 或 `/skills/public/{id}`，**勿硬编码**）。
   用户亦可从 skill 列表/关联技能点击开窗。
2. **数据读写与地图指令都依赖窗口存在**：页面未打开时 `exec 1host=page` 无响应——
   先 `open`，再 `exec 1host=page list` 确认窗口与 `{win_id}.*` 事件。
3. **探测地图指令**：`exec 1host=page commands`（或 `list`），指令清单以 pageDesc 声明为准。
   首开建议先 `{win_id}.orbital_status` 确认 `ready: true`（echarts/世界地图异步加载）。
4. **读写数据**：page 通道 `curl` **同源**调 `{url_prefix}/api/{name}`（浏览器带登录态，
   服务端注入 user_id，无需也不能伪造）：

   ```
   exec 1host=page curl "{url_prefix}/api/companies?q=%E8%93%9D%E7%AE%AD&sub_sector=&status="
   exec 1host=page curl -X POST -H "Content-Type: application/json" -d '{"id":"…","name":"…",…}' "{url_prefix}/api/company"
   ```

   get 走 query 参数；post 走 JSON body。响应：get → `{"rows":[…],"truncated":bool}`
   （恒数组）；post → `{"rows":[],"affected":n,"last_insert_id":n}`。

**URL 形态**：api 文件名 `{get|post}.{name}.sqlx` 的前缀是 HTTP 方法绑定描述符，
**不进 URL**——端点路径一律是 `{url_prefix}/api/{name}`（name = 文件名去掉
`get.`/`post.` 前缀），方法由前缀决定（get.*=GET，post.*=POST，curl 默认 GET）。
例：`api/get.companies.sqlx` → `GET {url_prefix}/api/companies`。

**参数纪律**：sqlx 里声明的**每个参数都必须传**（缺失报 `missing sqlx param`，
400）；空串 `""` = 不限/不变（按端点语义），未知可空字段传 `null`。

## 数据通道（api 清单）

### 读取（GET `{url_prefix}/api/{下表名}`，query 参数全传；空串 = 不限）

| 端点 name | 参数 | 用途 |
|---|---|---|
| `dashboard_counts` | — | 六板块记录数（单行） |
| `map_sites` / `map_companies` / `map_accidents` | — | 情报舱地图点位（只要带坐标的行） |
| `companies` | `q` `sub_sector` `status` | 公司列表（名称/英文名/简称模糊） |
| `company` | `id` | 公司详情 |
| `company_products` / `company_launches` / `company_fundings` / `company_relations` | `company_id` | 公司子表 |
| `company_names` | — | 全部 `{id, name}`（关系对端名解析/下拉） |
| `accidents` | `q` `accident_type` `severity` `investigation_status` | 事故列表 |
| `accident` | `id` | 事故详情 |
| `regulations` | `q` `doc_type` `issuing_authority` `status` | 法规列表 |
| `regulation` | `id` | 法规详情（含全文 content） |
| `regulation_successor` | `id` | 版本链：谁替代了本文档 |
| `review_cases` | `case_type` `status` | 审查案件列表 |
| `review_case` / `review_findings` | `id` / `case_id` | 案件详情 / 发现项 |

### 写入（POST `{url_prefix}/api/{下表名}`，JSON body）

`company` `product` `launch` `funding` `relation` `news` `accident` `regulation` `site`
—— 数据采集入库（参数 = 对应表全字段，
见下文表结构；**写入契约**：

- `id`：你生成，32 位十六进制（`crypto.randomUUID().replaceAll('-','')` 形态），全库唯一
- `user_id`：服务端注入，**不要传**
- 未知/不适用字段传 `null`（JSON null 落 NULL）；字符串字段无值传 `""`；数字/布尔/时间未知传 `null`
- 时间字段：ISO 8601（如 `2026-08-01T10:00:00+08:00`），日期精度可只给 `2026-08-01`
- `created_at`/`updated_at` 由服务端自动填，不要传

`review_case`（创建审查案件：`id` `company_id` `case_type` `title`
`materials_list` `submitted_at`；status 恒 pending）、`review_finding`
（`id` `case_id` `finding_type` `severity` `rule_id` `rule_ref` `description`
`recommendation`；resolution_status 恒 unresolved）、`review_finding_status`
（`id` `resolution_status`：unresolved→resolved→closed）、`review_case_update`
（`id` `status` `overall_result` `summary` `reviewed_by` `reviewed_at`；
**空串 = 不改**，只传要更新的字段）。

## pageDesc 指令表（情报舱地图联动）

| 指令 | argv | 返回/效果 |
|---|---|---|
| `orbital_status` | 无 | `{ready, layers, counts}` 就绪探测 |
| `focus_site` | `--name <名称>` | 聚焦设施并弹情报卡（中英模糊） |
| `focus_company` | `--name <名称>` | 聚焦公司总部并弹公司卡 |
| `open_accident` | `--title <模糊>` 或 `--id` | 聚焦事故点并弹事故卡 |
| `set_layers` | `--sites/--companies/--accidents on\|off` | 开关图层 |
| `clear_card` | 无 | 关闭情报卡 |
| `list_targets` | 无 | 全部可聚焦目标名清单 |

返回统一 `{content: "<JSON 字符串>"}`，反序列化后 `{ok:true, …}` 或
`{ok:false, error}`（可原样转述用户）。找不到目标时先 `list_targets` 再重试。
讲解地点/公司/事故时**必须同步调用对应指令**让地图聚焦（"边讲边指"）。

## 数据库架构（11 表）

通用基列（每张表都有，下文不重复列出）：`id`(PK) `user_id` `created_at` `updated_at`。

### `space_companies` 公司主表
`name*` 公司全称（唯一）、`name_en` `short_name` `founder` `established_at`
`headquarters` `website` `description` `sub_sector`（火箭制造/发动机/卫星制造/发射服务/
卫星运营/遥感服务/航天材料/地面设备/测控/航天电子/太空旅游…）`employee_count`
`status`(active/inactive) `tags`（逗号分隔）`hq_lat` `hq_lng`（**地图必填**）

### `space_products` 产品/业务线
`company_id*` `name*` `product_type*`（rocket/engine/satellite/launch_service/
component/material/software/service/ground_equipment/constellation/other）`sub_type`
（固体/液体/可重复使用/液氧煤油/液氧甲烷/电推…）`description` `key_params`（JSON 字符串）
`status`（研发中/在产/已退役/首飞成功/首飞失败）`reusable`(bool) `first_flight_at` `source`

### `space_launches` 发射记录
`company_id*` `product_id` `mission_name` `flight_number`（遥一/海遥一）`launch_at*`
`launch_site` `launch_method`（陆射/海射）`orbit_type`（LEO/SSO/GTO/GEO/MEO）
`payload` `payload_count` `customer` `result`（成功/失败/部分成功）`failure_reason`
`source` `notes`

### `space_fundings` 融资记录
`company_id*` `round`（天使轮/Pre-A/A轮/B轮…）`amount`（亿元）`currency` `announced_at`
`investors` `valuation` `source`。**与关系表分工**：fundings 记融资事件，relations 的
investor 记长期持股关系。

### `space_company_relations` 公司关系（产业链推导核心）
`company_a_id*` `company_b_id*` `relation_type*`（supplier/customer/partner/investor/
competitor/joint_venture/other）`contract_name` `description` `signed_at` `end_at`
`status` `source`。
推导规则（以 supplier 为例）：上游供应商 = `company_b_id=目标` 取 a；下游客户 =
`company_a_id=目标` 取 b；合作伙伴 = partner 任一方向；投资方 = `company_b_id=目标` 取 a。

### `space_news` 动态资讯
`company_id*` `title` `url` `published_at` `summary` `news_type`（发射/融资/合作/
技术突破/政策/财报/人事/行业）`source`

### `space_accidents` 事故案例
`title*` `incident_date` `location` `company_name` `company_id` `vehicle` `mission`
`accident_type*`（飞行事故/地面测试事故/设施事故/发动机测试）`severity`（致命/重大/
较大/一般）`phase`（起飞/上升/级间分离/上面级/再入/着陆/静态点火/地面试车/压力测试）
`casualties` `property_damage` `description` `immediate_cause` `root_cause`
`contributing_factors` `lessons_learned` `corrective_actions` `investigation_body`
`investigation_status`（调查中/已结案/报告已发布）`investigation_report_url`
`related_company_ids` `related_regulation_ids` `related_accident_ids`（连锁事故，逗号分隔）
`source` `source_url` `tags` `keywords` `lat` `lng`（**地图必填**）

### `space_regulations` 监管知识库
`title*` `doc_type*`（law/regulation/policy/standard/approval_rule/technical_guide/
regulatory_experience）`issuing_authority` `document_number` `published_at`
`effective_at` `status`（现行有效/已废止/已修订/修订中）`summary` `content`（全文）
`keywords` `tags` `source` `source_url` `version` `replaces_id`（版本链追溯）`notes`

### `space_review_cases` 审查案件
`company_id*` `case_type*`（launch_application/test_plan/frequency_usage/remote_sensing/other）
`title` `materials_list`（JSON 数组字符串）`submitted_at` `status`（pending/in_review/
completed/returned）`overall_result`（pass/conditional_pass/fail）`summary` `reviewed_at`
`reviewed_by`

### `space_review_findings` 审查发现项
`case_id*` `finding_type*`（missing_item/rule_conflict/risk_point/suggestion）`severity`
（critical/major/minor/info）`rule_id`（关联法规或事故 id）`rule_ref`（法规原文摘录）
`description` `recommendation` `resolution_status`（unresolved/resolved/closed）
`resolution_notes`

### `space_sites` 航天设施
`name*` `name_en` `site_type*`（launch_site/test_facility/landing_zone/tracking_station/
spaceport）`country` `region` `lat*` `lng*` `operator` `status`（active/inactive/construction）
`established` `description` `source`

## 工作流

### 公司调研（"搜索/调研某公司"）
1. `companies?q=` 先查库；已有则补充最新动态，无则采集
2. `web_search`/`web_fetch` 采集 → `company` post 端点（新）或补充写入
   products/launches/fundings/relations/news
3. 返回时标注数据来源（数据库记录 id vs 网络来源 URL）

### 事故采集
`web_search`（英语关键词 "rocket explosion"/"launch failure"/"anomaly" 优先）→ 详情页 →
`accident` post 端点：accident_type/severity/incident_date/location/company_name/vehicle/
description/immediate_cause/root_cause/lessons_learned/corrective_actions/
investigation_body/investigation_status/source(Wikipedia 优先)/source_url 必填全，
lat/lng 有坐标必给，连锁事故写 related_accident_ids。

### 法规采集
`web_search` → 全文 → `regulation` post 端点，doc_type 区分，keywords/tags 必填以便检索；
替代关系写 replaces_id。

### 合规审查（用户提交材料）
1. `review_case` post 建案件 → 2. 提取关键信息（火箭/轨道/发射方式/载荷）→
3. `regulations?q=` + `accidents?q=` 检索适用规则与事故先例 →
4. 逐项比对，`review_finding` post 生成发现项（missing_item 多为 major；
rule_conflict 标 rule_id+rule_ref，多为 critical/major；risk_point 多为 minor；
suggestion 为 info）→ 5. `review_case_update` 汇总结论：
有 critical → fail；有 major 无 critical → conditional_pass；仅 minor/info → pass；
写 summary/reviewed_at。发现项必须关联 rule_id 或引用 rule_ref，不得凭空判断。

## 交互规范

1. **先查库再搜索**：提问先查库，无结果再 web_search
2. **采集即入库**：新信息先写入数据库再返回给用户
3. **引用标注来源**：结论标注记录 id 与来源 URL
4. **审查必须有据**：发现项必关联 rule_id/rule_ref
5. **地图联动**：讲解地点/公司/事故时同步调用 pageDesc 聚焦指令
6. 中文为主、英文术语保留原文；结构化信息优先 Markdown 表格

## 其他

- 需求背景文档（智能体集群模块需求书节选）在包根目录
  `需求文档_商业航天智能体集群模块.md`，需要业务背景时经 fs.read 只读查看
  （`/u/{uid}/skills/intelligence_analysis/` 前缀）。
