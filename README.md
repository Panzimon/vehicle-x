# Vehicle-X 🚗

基于本地大模型的多 Agent 汽车智能决策助手。

## 核心特性

- **全本地运行** - 无需 API Key，基于 Ollama 本地部署的 qwen2.5 模型
- **MCP 协议** - 支持 Model Context Protocol，可扩展的工具调用系统
- **多 Agent 协作** - Supervisor-Worker 架构，支持复杂任务拆解与执行
- **流式对话** - SSE 实时流式输出，打字机效果
- **Function Calling** - 自动识别用户意图并调用对应工具
- **并行任务调度** - DAG 依赖图 + BFS 拓扑排序，支持任务并行执行
- **流式工具调用中断** - 流式输出过程中检测工具调用，中断后恢复

## 技术栈

- **前端**: Next.js 14 (App Router) + React 19 + shadcn/ui + Tailwind CSS
- **后端**: Next.js Server Actions + Ollama SDK
- **模型**: qwen2.5:14b (深度推理) + qwen2.5:7b (快速响应)
- **向量库**: Chroma (本地向量存储)
- **协议**: MCP (Model Context Protocol)

## 快速启动

### 前提条件

1. 安装 [Ollama](https://ollama.com)
2. 拉取所需模型：

```powershell
ollama pull qwen2.5:14b
ollama pull qwen2.5:7b
ollama pull nomic-embed-text
```

### 安装依赖

```powershell
cd vehicle-x
npm install
```

### 启动开发服务器

```powershell
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000) 即可使用。

## 项目结构

```
vehicle-x/
├── src/
│   ├── app/
│   │   ├── actions.ts       # Server Actions (工具执行、任务调度)
│   │   ├── api/
│   │   │   └── chat/route.ts # SSE 流式聊天 API
│   │   ├── page.tsx         # 主页面
│   │   └── layout.tsx       # 布局组件
│   ├── lib/
│   │   ├── supervisor.ts    # 任务调度器 (DAG 拓扑排序)
│   │   ├── tools.ts         # 工具定义
│   │   ├── data.ts          # 数据操作模块
│   │   └── schema.ts        # Zod 数据校验 Schema
│   └── components/          # React 组件
├── data/
│   └── cars.json            # 车型数据库
└── public/                  # 静态资源
```

## 核心功能模块

### 1. 任务调度器 (Supervisor)

`src/lib/supervisor.ts` 负责将用户查询分解为工具调用任务，并进行依赖分析和并行调度：

- **任务分解**: 将自然语言查询转换为结构化任务列表
- **依赖标记**: 支持 `depends_on` 字段标记任务依赖关系
- **拓扑排序**: BFS 算法进行任务分层，无依赖的任务可并行执行

### 2. SSE 流式处理

`src/app/api/chat/route.ts` 实现流式对话和工具调用中断：

- **流式输出**: 实时推送模型响应，打字机效果
- **工具检测**: 流式过程中实时检测 `tool_calls`
- **中断恢复**: 检测到工具调用后中断文本流，执行工具，结果注入上下文后恢复流式输出

### 3. 工具系统

支持的工具类型：

| 工具名 | 功能 | 参数 |
|--------|------|------|
| `search_car_by_budget` | 按预算筛选车型 | `min_price`, `max_price`, `energy_type`, `body_type`, `scene_tag` |
| `get_car_detail` | 获取车型详情 | `car_id` |
| `compare_cars` | 对比多款车型 | `car_ids` |
| `plan_route` | 规划驾车路线 | `from`, `to` |

### 4. 数据层

`src/lib/data.ts` 提供车型数据的查询操作：

- `loadCars()` - 加载车型数据
- `findCarByKeyword()` - 模糊匹配车型
- `searchCarByBudget()` - 按预算筛选
- `getCarDetail()` - 获取车型详情
- `compareCars()` - 对比车型

## 车型数据

当前 `cars.json` 包含以下字段：

| 字段 | 说明 |
|------|------|
| id | 车型唯一标识 |
| brand / model | 品牌与型号 |
| price | 售价 (万元) |
| energy_type | 能源类型 (纯电/插混/增程/燃油) |
| body_type | 车身类型 (SUV/轿车/MPV) |
| range | 续航里程 (km) |
| acceleration | 零百加速 (秒) |
| smart_drive_level | 智驾等级 |
| tags | 场景标签 |
| pros / cons | 优缺点 |

## 并行任务调度说明

系统支持 DAG（有向无环图）任务依赖管理：

1. **任务依赖标记**: Supervisor 分解任务时标注依赖关系
2. **拓扑排序分层**: 使用 BFS 算法将任务按依赖关系分层
3. **同层并行执行**: 同一层的任务可以同时执行（使用 `Promise.all`）
4. **跨层顺序执行**: 有依赖的任务等待前置任务完成后执行

**示例流程**:

用户查询："推荐25万SUV，然后对比比亚迪汉和特斯拉Model Y"

```
任务分解:
├─ 任务0: search_car_by_budget (无依赖)
├─ 任务1: get_car_detail("比亚迪汉") (依赖任务0)
├─ 任务2: get_car_detail("特斯拉Model Y") (依赖任务0)
└─ 任务3: compare_cars (依赖任务1, 任务2)

拓扑分层:
第1层: [任务0]              ← 先执行搜索
第2层: [任务1, 任务2]       ← 同时获取两款车详情
第3层: [任务3]              ← 最后对比
```

## 环境变量

如需配置可选环境变量，创建 `.env.local`：

```env
OLLAMA_HOST=http://localhost:11434
AMAP_KEY=your_amap_api_key  # 用于路线规划功能
```

## License

MIT