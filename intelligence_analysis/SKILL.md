---
name: intelligence_analysis
nickname: 商业航天情报分析
description: ORBITALINTEL 商业航天情报分析：全产业链公司/产品/发射/融资/关系数据库、事故案例库、监管知识库、AI 合规审查，三维地球情报舱联动。外部 AI 经同源 api 读写数据、经 pageDesc 指令驱动地图
keywords: [航天, 商业航天, 公司分析, 事故案例, 监管法规, 合规审查, 情报分析, aerospace, space, launch, satellite, regulation, compliance]
icon: fa-solid fa-satellite
ui:
  - path: index.html
    desc: ORBITALINTEL 情报舱主页面/默认首页（Cesium 三维地球高清卫星影像 + 航天设施/公司/事故图层 + 任意地点搜索定位 + 情报卡，AI 地图联动指令面）
  - path: companies.html
    desc: 公司列表（搜索/筛选/分页）
  - path: company.html
    desc: 公司详情页（?id= 必填：基本信息 + 产品/发射/融资/关系网络）
  - path: news.html
    desc: 动态资讯列表（关键词搜索 + 类型筛选 + 分页，标题链原文、公司链详情）
  - path: accidents.html
    desc: 事故案例库列表（类型/严重度/调查状态筛选）
  - path: accident.html
    desc: 事故详情页（?id= 必填：根因/教训/纠正措施/关联项全字段）
  - path: regulations.html
    desc: 监管知识库列表（类型/机构/状态筛选）
  - path: regulation.html
    desc: 法规详情页（?id= 必填：含全文 content 与版本链）
  - path: reviews.html
    desc: 合规审查案件列表（新建审查入口）
  - path: review.html
    desc: 审查案件详情页（?id= 必填：发现项明细与处理状态）
---

# 商业航天情报分析（ORBITALINTEL）

专业的商业航天（Commercial Aerospace / New Space）行业分析 skill，四大板块 + 设施情报：

- **板块一：公司分析** —— 全产业链公司、产品、发射、融资、关系网络、动态资讯
- **板块二：事故案例库** —— 发射事故/地面测试事故/设施事故/发动机测试，追溯根因与经验教训
- **板块三：监管知识库** —— 法律法规、政策文件、标准规范、审批规则、技术指南、监管经验
- **板块四：AI 合规审查** —— 对申报材料智能初审：缺项、冲突、风险、整改建议
- **航天设施情报** —— 全球发射场/试车台/着陆区/测控站（含经纬度，地图标注）

数据存于本 skill 私有 sqlite（11 张表），经 `api/` 声明式接口读写。页面零内嵌 AI——
操控面 = `pageDesc` 指令 + 同源 api，全部由外部 AI 驱动。

## 页面结构（平台直路由）

- skill 只画页面，**路由由平台负责**：`/skills/{scope}/{ref}/{page}` → 装载包
  `ui/{page}.html`（缺省 `index`）；裸前缀 `/skills/{scope}/{ref}` 自动规范化到
  `/index`。页内导航写**干净路径名**（`$router.push('news')` / `<a href="news">`，
  不带 `.html`）；详情页带 `?id=`：`open {url_prefix}/company?id=<记录id>`。
- **唯一带地图指令的页面是 `index.html`**（情报舱主页面）；其余页面（公司/事故/
  法规/审查/新闻的列表与详情）不声明 `pageDesc`，纯数据展示。
- 页面数据走 `$fetch('api/{name}', { params })`（包 env.js 固定定义，模块锚定包前缀）；
  同页 query 变化（如 `regulation?id=A` → `?id=B`）不重建组件，页面经
  `$router.onChange(() => init())` 自刷新。
- 平台 `page list` 可看到窗口与 `{win_id}.*` 事件；换页后指令面会重建，需重新 `list`
  确认事件名（`{win_id}` 可能变化）。

## 外部 AI 操作方式

1. **打开页面**：`open {url_prefix}/index`（`url_prefix` 由 skills 工具返回，形如
   `/skills/local/intelligence_analysis` 或 `/skills/public/{id}`，**勿硬编码**）。
   用户亦可从 skill 列表/关联技能点击开窗。
2. **窗口复用（默认做法）**：情报舱开好后，列表/详情页一律在同一窗口内打开，**不要另开新窗口**：
   - 列表页：`open {url_prefix}/companies --win <win_id>`（同理 accidents/regulations/reviews/news）
   - 详情页：`open {url_prefix}/company?id=<记录id> --win <win_id>`（同理 accident/regulation/review）
   - 列表/详情页**无地图指令面**，看完记得导航回 `open {url_prefix}/index --win <win_id>`
     恢复地图指令；全程只保留一个情报窗口，避免窗口越开越多。
3. **数据读写与地图指令都依赖窗口存在**：页面未打开时 `exec 1host=page` 无响应——
   先 `open`，再 `exec 1host=page list` 确认窗口与 `{win_id}.*` 事件。
4. **探测/调用地图指令**：`exec 1host=page commands`（或 `list`）看指令清单（以 pageDesc 声明为准）；
   调用格式为 `exec 1host=page {win_id}.{指令名}` + argv，例：
   `exec 1host=page w045h.orbital_status`、`exec 1host=page w045h.focus_site --name 酒泉`。
   指令是 exec action **不是 URL，勿用 curl 调**（会 404）。换页后先重新 `list` 拿最新 `{win_id}`。
   首开建议先 `{win_id}.orbital_status` 确认 `ready: true`（Cesium 引擎/高清瓦片异步加载）；
   `ready: false` 时稍候重试。
5. **读写数据**：page 通道 `curl` **同源**调 `{url_prefix}/api/{name}`（浏览器带登录态，
   服务端注入 user_id，无需也不能伪造）：

   ```
   exec 1host=page curl "{url_prefix}/api/companies?q=%E8%93%9D%E7%AE%AD&sub_sector=&status="
   exec 1host=page curl -X POST -H "Content-Type: application/json" -d '{"id":"…","name":"…",…}' "{url_prefix}/api/company"
   ```

   get 走 query 参数；post 走 JSON body。响应：get → `{"rows":[…],"truncated":bool}`
   （恒数组；`truncated:true` 表示结果被截断，可加筛选缩小范围）；
   post → `{"rows":[],"affected":n,"last_insert_id":n}`。

**URL 形态**：api 文件名 `{get|post}.{name}.sqlx` 的前缀是 HTTP 方法绑定描述符，
**不进 URL**——端点路径一律是 `{url_prefix}/api/{name}`（name = 文件名去掉
`get.`/`post.` 前缀），方法由前缀决定（get.*=GET，post.*=POST，curl 默认 GET）。
例：`api/get.companies.sqlx` → `GET {url_prefix}/api/companies`。

**参数纪律**：sqlx 里声明的**每个参数都必须传**（缺失报 `missing sqlx param`，
400）；空串 `""` = 不限/不变（按端点语义），未知可空字段传 `null`。
例如 `company?id=`（空串）返回空数组（查无此记录），而 `company` 不带 id 才报 400。

**测试数据约定**：测试/演练写入请用 `deadbeef` 开头的 id 并在名称中标注"测试"（如
"ZZ接口验证测试公司"），便于与正式数据区分；清理时按下方 delete 端点逐个删除（幂等，
不存在的 id 不影响），正式采集不要用该前缀。

## 数据通道（api 清单）

### 读取（GET `{url_prefix}/api/{下表名}`，query 参数全传；空串 = 不限）

| 端点 name | 参数 | 用途 |
|---|---|---|
| `dashboard_counts` | — | 七板块记录数（单行；数值为字符串类型） |
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
| `news` | `company_id` `news_type` `q` | 动态资讯列表（标题/摘要模糊；company_id/news_type 空串 = 不限） |
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
**空串 = 不改**，只传要更新的字段）。`review_finding_status` 与 `review_case_update`
均按 `id + user_id` 双重过滤——只能更新**自己的**记录。

### 删除（POST `{url_prefix}/api/delete_{表名}`，JSON body：`{"id":"…"}`）

| 端点 | 删除目标 | 说明 |
|---|---|---|
| `delete_company` / `delete_product` / `delete_launch` / `delete_funding` / `delete_relation` / `delete_news` | 公司主表 / 产品 / 发射 / 融资 / 关系 / 动态 | 按 id 删；**先删子表再删主表**（product/launch/funding/relation/news 依赖 company） |
| `delete_accident` / `delete_regulation` | 事故 / 法规 | 按 id 删 |
| `delete_site` | 航天设施 | 按 id 删 |
| `delete_review_finding` / `delete_review_case` | 审查发现项 / 审查案件 | **先删发现项再删案件**（findings 依赖 case）；无级联 |

规则：`id` 必传；按 `id + user_id` 双重过滤（只能删自己的数据）；**幂等**——
不存在的 id 返回 `affected:0` 不报错；响应同 post：`{"rows":[],"affected":n,"last_insert_id":n}`
（affected=0 时可能省略该字段）。

## pageDesc 指令表（情报舱地图联动）

| 指令 | argv | 返回/效果 |
|---|---|---|
| `orbital_status` | 无 | `{ready, layers, counts}` 就绪探测（counts 为字符串值） |
| `focus_site` | `--name <名称>` | 聚焦设施并弹情报卡（中英模糊） |
| `focus_company` | `--name <名称>` | 聚焦公司总部并弹公司卡 |
| `open_accident` | `--title <模糊>` 或 `--id` | 聚焦事故点并弹事故卡 |
| `locate` | `--name <任意地名>` | 地理编码定位任意地点（三维地球飞达+青色定位钉，中文名优先 open-meteo GeoNames，如 `西安`、`Jiuquan`；外部服务不可达时自动回退库内设施/公司/事故模糊匹配） |
| `set_layers` | `--sites/--companies/--accidents on\|off` | 开关图层 |
| `clear_card` | 无 | 关闭情报卡 |
| `list_targets` | 无 | 全部可聚焦目标名清单 |

返回统一 `{content: "<JSON 字符串>"}`，反序列化后 `{ok:true, …}` 或
`{ok:false, error}`（可原样转述用户）。找不到目标时先 `list_targets` 再重试。
以上指令**仅 `index.html`（情报舱主页面）提供**；列表/详情页无地图指令面。
讲解地点/公司/事故时**必须同步调用对应指令**让地图聚焦（"边讲边指"）；
讲到一个地名（非库内目标）时用 `locate` 定位。

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
技术突破/政策/财报/人事/行业/事故/合同/并购/战略）`source`

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
1. `companies?q=` 先查库；已有则 `news?company_id=` 查该司既有动态判断是否需补充，无则采集
2. `web_search`/`web_fetch` 采集 → `company` post 端点（新）或补充写入
   products/launches/fundings/relations/news（**先查后写**，避免重复入库）
3. 产业链展示：`company_relations?company_id=` + `company_names` 解析对端名称，
   按 supplier/customer/partner/investor 分类列出上下游
4. 返回时标注数据来源（数据库记录 id vs 网络来源 URL）

### 事故分析（"分析/讲解某某事故/故障"）
1. `accidents?q=` 或 `accident?id=` 取详情（先查库，无结果再 `web_search` 采集入库）
2. 同步调用 `open_accident`（或 `focus_site`/`locate` 定位地点）——"边讲边指"
3. 输出结构化分析：事件经过 → 直接原因 → 根本原因 → 促成因素 → 经验教训 →
   纠正措施 → 调查状态（调查中注明"待结案"）；跨案例对比用 Markdown 表格
4. 关联项（related_*_ids）顺带点出影响面；引用记录 id 与 source_url

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

## 排障速查

| 现象 | 处理 |
|---|---|
| `exec 1host=page` 无响应 | 页面未打开：先 `open {url_prefix}/index`，再 `page list` 确认窗口 |
| 指令调用返回 HTTP 404 | 误用 curl 调指令：pageDesc 指令是 `exec` action（`{win_id}.{event}`），不是 URL；curl 只能访问 `{url_prefix}/api/*` |
| `orbital_status.ready=false` | Cesium 引擎/瓦片异步加载中，稍候重试 |
| 指令报 `{ok:false, error:"not found"}` | 先 `list_targets` 取准确名称（支持中英模糊），或另用 `locate` 定位相近地名 |
| `locate` 超时/失败 | 编码多源自动切换（open-meteo→photon→库内兜底，单源 8s 超时 AbortController），网络全挂时库内目标仍可定位；库内目标建议优先 `focus_site`/`focus_company` |
| get 响应 `truncated:true` | 加筛选参数（如 `q=`、`status=`）缩小范围后重查 |
| post 报 `missing sqlx param` | 该端点声明参数缺传：按上文 api 清单补齐（空串或 null 填位） |
| 窗口越开越多 | 用 `--win <win_id>` 复用已开窗口；多余窗口 `close <win_id>` 关闭 |
| 换页后旧指令失效 | SPA 路由切换会清空 pageDesc，重新 `page list` 获取新 `{win_id}` 与事件 |

## 其他

- 需求背景文档（智能体集群模块需求书节选）在包根目录
  `需求文档_商业航天智能体集群模块.md`，需要业务背景时经 fs.read 只读查看
  （`/u/{uid}/skills/intelligence_analysis/` 前缀）。
- 界面为中文；`status`/`overall_result` 等枚举值按表结构原样写库，展示时中文化。
