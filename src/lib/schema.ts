import { z } from 'zod'

// ========== 车型数据 Schema ==========
// 定义车型数据的结构和校验规则
export const CarSchema = z.object({
  id: z.string(),                                    // 车型唯一标识，格式如 "byd-han-ev-2024"
  brand: z.string(),                                 // 品牌名，如 "比亚迪"
  model: z.string(),                                 // 车型名，如 "汉 EV"
  price: z.number().min(3).max(100),                // 价格（万元），范围 3-100万，防止异常数据
  energy_type: z.enum(['纯电', '插混', '增程', '燃油']),  // 能源类型
  body_type: z.enum(['轿车', 'SUV', 'MPV', '猎装']),  // 车身类型
  range: z.number().min(0).max(2000),               // 续航里程（km），范围 0-2000km
  acceleration: z.number().min(0).max(20),          // 零百加速（秒），范围 0-20秒
  trunk_volume: z.number().min(0),                  // 后备箱容积（L）
  charging_time: z.number().min(0),                 // 充电时间（分钟）
  smart_drive_level: z.string(),                    // 智能驾驶级别，如 "L2"、"L2+"
  tags: z.array(z.string()),                        // 标签数组，如 ["露营", "空间大"]
  pros: z.array(z.string()),                        // 优点列表
  cons: z.array(z.string()),                        // 缺点列表
})

export type Car = z.infer<typeof CarSchema>

// ========== 工具参数 Schema ==========
// search_car_by_budget 工具参数校验
export const SearchCarArgsSchema = z.object({
  min_price: z.number().min(0).max(200),           // 最低预算（万元）
  max_price: z.number().min(0).max(200),           // 最高预算（万元）
  energy_type: z.enum(['纯电', '插混', '增程', '燃油']).optional(),  // 能源类型（可选）
  body_type: z.enum(['轿车', 'SUV', 'MPV']).optional(),            // 车身类型（可选）
  scene_tag: z.string().optional(),                // 用车场景标签（可选）
})

// get_car_detail 工具参数校验
export const GetCarDetailArgsSchema = z.object({
  car_id: z.string().min(1, '车型 ID 不能为空'),
})

// compare_cars 工具参数校验
export const CompareCarsArgsSchema = z.object({
  car_ids: z.array(z.string().min(1)).min(2, '至少需要 2 款车对比'),
})

// 类型导出，方便其他模块使用
export type SearchCarArgs = z.infer<typeof SearchCarArgsSchema>
export type GetCarDetailArgs = z.infer<typeof GetCarDetailArgsSchema>
export type CompareCarsArgs = z.infer<typeof CompareCarsArgsSchema>