# Vehicle-X 🚗

基于本地大模型的多 Agent 汽车智能决策助手。融合高德地图 MCP 实时路线规划 + 120+ 款车型数据库，实现"选车-对比-规划出行"一站式对话体验。

## 核心特性

- **全本地运行** - 无需 API Key，基于 Ollama 本地部署的 qwen2.5 模型
- **MCP 协议** - 支持 Model Context Protocol，通过 Stdio 模式连接高德地图 MCP Server
- **多 Agent 协作** - Supervisor-Worker 架构，支持复杂任务拆解与执行
- **流式对话** - SSE 实时流式输出，打字机效果，工具调用过程无缝衔接
- **Function Calling** - 自动识别用户意图并调用对应工具，支持中文语义路由
- **并行任务调度** - DAG 依赖图 + BFS 拓扑排序，支持任务并行执行
- **高德路线规划** - 集成高德地图 Web 服务，支持地址→经纬度→驾车路线全链路
- **Markdown 渲染** - 支持 GFM 完整格式：列表、代码块、表格、加粗斜体等
- **历史上下文** - 支持多轮对话记忆，保持选车偏好与预算信息连贯

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Next.js 14 (App Router) + React 19 + shadcn/ui + Tailwind CSS |
| 后端 | Next.js Server Actions + Route Handlers (SSE) |
| 模型 | qwen2.5:14b（深度推理）+ qwen2.5:7b（快速响应）|
| 工具协议 | MCP（Stdio 模式）+ Function Calling |
| 外部数据 | 高德地图 Web 服务（地理编码 + 驾车路线）|
| 本地数据 | JSON 文件数据库（120+ 车型）|

## 快速启动

### 前提条件

1. 安装 [Ollama](https://ollama.com)
2. 拉取所需模型：

```powershell
ollama pull qwen2.5:14b
ollama pull qwen2.5:7b
```

### 安装依赖

```powershell
cd vehicle-x
npm install
```

### 配置环境变量（可选）

```powershell
# 创建 .env.local
OLLAMA_HOST=http://localhost:11434
AMAP_KEY=你的高德Web服务Key  # 用于路线规划，可选
```

### 启动

```powershell
npm run dev
```

Ollama 服务会自动检测并启动（若未运行），然后打开 [http://localhost:3000](http://localhost:3000) 即可使用。

## 功能演示

### 选车咨询

```
用户: 预算25万，有什么新能源SUV推荐？
     ↓ 工具: search_car_by_budget
     ↓ 筛选: 20-30万 / 新能源 / SUV
     ↓ 回复车型列表及亮点
```

### 车型对比

```
用户: 对比一下比亚迪汉和特斯拉Model Y
     ↓ 工具: compare_cars
     ↓ 展示: 价格 / 续航 / 智驾 / 优缺点 横向对比
```

### 路线规划

```
用户: 从北京到上海怎么走？多远？
     ↓ 工具: plan_route (高德MCP)
     ↓ 地理编码: "北京" → "116.397,39.909"
     ↓ 驾车路线: 距离 / 耗时 / 过路费 / 导航步骤
```

## 项目结构

```
vehicle-x/
├── src/
│   ├── app/
│   │   ├── page.tsx              # 主页面（含聊天 UI / 路线规划 UI）
│   │   ├── layout.tsx            # 布局组件
│   │   ├── actions.ts           # Server Actions（工具执行 / MCP 连接）
│   │   └── api/
│   │       └── chat/route.ts    # SSE 流式聊天 API
│   └── lib/
│       ├── supervisor.ts         # 任务调度器（DAG 拓扑排序）
│       ├── tools.ts              # 工具定义（Function Calling Schema）
│       ├── schema.ts             # Zod 数据校验 Schema
│       └── data.ts               # 车型数据查询模块
├── data/
│   └── cars.json                 # 车型数据库（120+ 款）
├── start-all.ps1                 # 一键启动脚本
└── package.json
```

## 核心模块

### Supervisor 任务调度器

`src/lib/supervisor.ts` 将用户查询分解为工具调用任务，支持 DAG 依赖管理：

- **任务分解**: 自然语言 → 结构化任务列表
- **依赖标记**: `depends_on` 字段标注任务依赖关系
- **拓扑分层**: BFS 算法将任务按依赖分层
- **并行执行**: 同一层任务 `Promise.all` 并发执行

### SSE 流式处理

`src/app/api/chat/route.ts` 实现流式对话与工具调用：

- 流式输出实时推送模型响应，打字机效果
- 流式过程中实时检测 `tool_calls`，自动中断并执行
- 工具结果注入上下文后恢复流式输出
- 多工具可并行调用，提高响应速度

### 高德地图 MCP 集成

`src/app/actions.ts` 通过 MCP Stdio 模式连接高德地图：

```
getAmapClient() → StdioClientTransport → npx @amap/amap-maps-mcp-server
                                                         ↓
                                              maps_geo（地理编码）
                                              maps_direction_driving（驾车路线）
```

### 工具系统

| 工具 | 功能 | 参数 |
|------|------|------|
| `search_car_by_budget` | 按预算筛选车型 | `min_price`, `max_price`, `energy_type`, `body_type`, `scene_tag` |
| `get_car_detail` | 获取车型详情 | `car_id` |
| `compare_cars` | 对比多款车型 | `car_ids` |
| `plan_route` | 规划驾车路线（高德MCP）| `from`, `to` |

## 车型数据

`data/cars.json` 当前收录 120+ 款车型，字段如下：

| 字段 | 说明 |
|------|------|
| `id` | 车型唯一标识 |
| `brand` / `model` | 品牌与型号 |
| `price` | 售价（万元）|
| `energy_type` | 能源类型（纯电 / 插混 / 增程 / 燃油）|
| `body_type` | 车身类型（SUV / 轿车 / MPV）|
| `range` | 续航里程（km）|
| `acceleration` | 零百加速（秒）|
| `smart_drive_level` | 智驾等级 |
| `tags` | 场景标签（家用 / 商务 / 越野等）|
| `pros` / `cons` | 优缺点 |

## License

MIT
