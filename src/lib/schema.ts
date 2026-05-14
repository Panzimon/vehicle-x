import { z } from 'zod'

// ========== 车型数据 Schema ==========
export const CarSchema = z.object({
  id: z.string(),
  brand: z.string(),
  model: z.string(),
  price: z.number().min(3).max(100),        // 3-100万，防脏数据
  energy_type: z.enum(['纯电', '插混', '增程', '燃油']),
  body_type: z.enum(['轿车', 'SUV', 'MPV', '猎装']),
  range: z.number().min(0).max(2000),        // 续航 0-2000km
  acceleration: z.number().min(0).max(20), // 零百 0-20秒
  trunk_volume: z.number().min(0),
  charging_time: z.number().min(0),
  smart_drive_level: z.string(),
  tags: z.array(z.string()),
  pros: z.array(z.string()),
  cons: z.array(z.string()),
})

export type Car = z.infer<typeof CarSchema>

// ========== 工具参数 Schema ==========
export const SearchCarArgsSchema = z.object({
  min_price: z.number().min(0).max(200),
  max_price: z.number().min(0).max(200),
  energy_type: z.enum(['纯电', '插混', '增程', '燃油']).optional(),
  body_type: z.enum(['轿车', 'SUV', 'MPV']).optional(),
  scene_tag: z.string().optional(),
})

export type SearchCarArgs = z.infer<typeof SearchCarArgsSchema>
