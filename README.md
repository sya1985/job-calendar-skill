# job-calendar-skill

job-calendar 是一个招聘岗位核查技能。当你想确认某家公司在特定城市是否有匹配的在招岗位（官网、招聘平台、聚合站全覆盖），它可以全网核查并生成一份**可累积、可搜索**的 HTML 报告。

### 做什么

输入「公司 + 岗位 + 工作地点」→ 自动全网核查官网 / BOSS直聘 / 智联 / 猎聘 / 51job / 拉勾 / 脉脉 / 牛客等渠道 → 生成一份累积式 HTML 核查报告（不输出 md）。

还可以一键「全量搜索」：对报告中已勾选的企业，按它们各自最后一次搜索条件批量重新核查。

### 工作流程

| 步骤 | 内容 | 数据来源 |
| ---- | ---- | -------- |
| ① | 输入校验（公司 / 岗位 / 地点三项必填，缺一则停止不搜） | — |
| ② | 规划并行搜索：官网 + 招聘平台 + 资讯聚合站，多角度关键词 | WebSearch |
| ③ | 抓取关键职位页详情（岗位 / 地点 / 薪资 / 经验 / 学历 / 发布时间 / JD） | WebFetch |
| ④ | BOSS 直聘反爬专项核查（≥2 个定向变体，禁凭"没搜到"下"无在招"结论） | WebSearch |
| ⑤ | 分类：本地确认岗位 / 非关注地岗位 / 官方招聘渠道 / 建议 | 基于前几步 |
| ⑥ | 生成 entry JSON → 追加进数据文件并重渲染报告 | `build_report.py` |
| ⑦ | 多公司累积在同一份 HTML，左侧 Tab 分页查看 | — |

> **同公司同日只留最后一次**：同一家公司同一天无论改岗位 / 地点 / 社招校招，仅保留最近一次查询结果；完全相同的条件则跳过不重复搜索。

### 核心原则

实事求是，查不到就标「查不到」，绝不编造薪资或职责；BOSS 直聘等动态渲染 + 反爬渠道存在漏检，凡仅从搜索摘要看到的岗位一律标「⚠ 待 App 内确认」，结论不得写「无在招」而不提此局限。

### 前置依赖

**WebSearch / WebFetch 工具**：用于全网核查官网与招聘平台。无额外登录型 Connector 依赖。

**本地服务（由 WorkBuddy 自动启动，无需手动操作）**：仅需 **Node.js**（无需 Python 环境）。使用本技能时，WorkBuddy 会在后台自动检测并在需要时启动服务（端口 `8771`），之后删除与「加入全量搜索」勾选会真实写入本地数据文件；不启动则双击 HTML 仅可查看、删除不落盘。手动启动命令如下（通常不需要）：

```bash
node scripts/job_calendar_server.js --data job_calendar_data.json --html job_calendar_report.html --port 8771
# 浏览器打开 http://127.0.0.1:8771/
```

（Python 用户也可使用 `python scripts/build_report.py --delete "公司名" ...` 做永久删除。）

### 招聘核查报告

- **企业页**：完整企业名（含别名 / 英文名）+「加入全量搜索」勾选框 + 企业简介
- **本地确认岗位**：表格化展示，含「新鲜度提示 🍅」体系（红🍅=新鲜 / 灰🍅=陈旧，按发布时间自动计算）
- **非关注地岗位**：弱化折叠展示，供参考
- **官方招聘渠道**：仅汇总官网「加入我们」页、官方招聘平台（飞书等）等官方来源
- **给你的建议**：投递前行动建议
- **大日历控件**：有查询记录的日期蓝底高亮，点击某日弹窗展示当日岗位卡片
- **数据局限性横幅**（报告底部）：明确提示 BOSS 岗位需去 App 内二次确认

### 全量搜索模式（批量重新核查）

勾选报告里目标企业的「加入全量搜索」后，在对话中输入：

```
@skill:job-calendar 全量搜索
```

- 不再需要、也不解析公司 / 岗位 / 工作地点（附带也一律无视）。
- 对 `job_calendar_data.json` 中 `scheduled === true` 的全部企业，按各自**最后一次搜索条件**（最近一次 queryDate 的公司 / 岗位 / 地点 / 社招校招）重新核查一遍。
- **一天内同条件只搜一次**：今日已搜过相同条件则跳过提示，不发起搜索。
- **空清单保护**：没有任何企业勾选全量搜索时，仅返回提示、不发起任何搜索。

### 使用方式

#### 安装

下载 WorkBuddy：https://www.codebuddy.cn/events/invite?inviteCode=acjtmw4jtix2rv
> 编写和测试用的都是腾讯的 WorkBuddy，其他像扣子、openClaw、Claude Code 应该也能用。

```bash
# 克隆到 WorkBuddy 技能目录
git clone <repo-url> ~/.workbuddy/skills/job-calendar/
```
或手动下载后放入 `~/.workbuddy/skills/job-calendar/`。

#### 使用

在 WorkBuddy 对话中输入：

```
@skill:job-calendar 公司名 岗位 工作地点 [社招/校招]
```

示例：

```
@skill:job-calendar 阿里巴巴 测试开发 杭州
@skill:job-calendar 字节跳动 后端Go 上海 校招
```

- `公司名`、`岗位`、`工作地点` 为**必填项**，缺任意一项将停止并提示补齐。
- `社招/校招` 选填，缺省按 **社招** 处理。

批量重搜：

```
@skill:job-calendar 全量搜索
```

#### 输出

每次核查生成 / 更新：

1. `job_calendar_data.json` — 累积的查询数据（每次追加，同一公司同日只留最后一次）
2. `job_calendar_report.html` — 多公司累积式核查报告（左侧 Tab 分页，日历控件浏览历史查询）

**本地服务自动启动**：使用本技能时，WorkBuddy 会在后台自动检测并在需要时启动服务（仅需 Node.js，无需 Python 环境），命令为：

```bash
node scripts/job_calendar_server.js --data job_calendar_data.json --html job_calendar_report.html --port 8771
# 浏览器打开 http://127.0.0.1:8771/
```

启动后浏览器打开 `http://127.0.0.1:8771/` 可勾选「加入全量搜索」、悬停 Tab 点 `×` 删除（真实落盘）；直接双击 HTML 仅可查看。

### 目录结构

```
job-calendar/
├── SKILL.md                     # 技能说明（触发条件 / 校验 / 流程 / 全量搜索）
├── README.md                    # 本文件
└── scripts/
    ├── build_report.py          # Python 渲染器：追加 entry / 重渲染 / 删除
    ├── job_calendar_server.js     # Node 本地服务：实时渲染 + DELETE/PUT/GET 接口（仅需 Node.js，无需 Python）
    └── report_template.html     # 共享 HTML 模板（含 ___DATA___ 占位符）
```
