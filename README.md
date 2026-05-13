# Vehicle-X 🚗

基于本地大模型的多 Agent 汽车智能决策助手。

## 核心特性

- **全本地运行** - 无需 API Key，基于 Ollama 本地部署的 qwen2.5 模型
- **MCP 协议** - 支持 Model Context Protocol，可扩展的工具调用系统
- **多 Agent 协作** - Supervisor-Worker 架构，支持复杂任务拆解与执行
- **流式对话** - SSE 实时流式输出，打字机效果
- **Function Calling** - 自动识别用户意图并调用对应工具

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
│   ├── app/              # Next.js App Router
│   │   ├── actions.ts   # Server Actions (Ollama 调用)
│   │   ├── page.tsx     # 主页面
│   │   └── api/         # API Routes
│   └── components/      # React 组件
├── data/
│   └── cars.json       # 车型数据库
└── public/             # 静态资源
```

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

## 环境变量

如需配置可选环境变量，创建 `.env.local`：

```env
OLLAMA_HOST=http://localhost:11434
```

## License

MIT
