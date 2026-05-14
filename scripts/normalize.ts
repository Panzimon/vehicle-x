// 示例：把从网页/LLM 提取的脏数据，洗成标准格式
import { CarSchema, Car } from '../src/lib/schema'

// 假设这是从网页爬的/LLM 提取的脏数据
const rawDataFromWeb = [
  {
    brand: '特斯拉',
    model: 'Model Y',
    price: '24.99万',      // 脏：带"万"字
    energy_type: '纯电动',  // 脏：不是标准枚举
    // 缺少很多字段...
  }
]

// normalize 函数
function normalizeCar(raw: Partial<Car>) {
  return {
    id: `${raw.brand}-${raw.model}-2024`.toLowerCase().replace(/\s+/g, '-'),
    brand: raw.brand,
    model: raw.model,
    price: typeof raw.price === 'string' ? parseFloat((raw.price as string).replace('万', '')) : raw.price,
    energy_type: raw.energy_type?.includes('纯电') ? '纯电' : 
                 raw.energy_type?.includes('插混') ? '插混' : 
                 raw.energy_type?.includes('增程') ? '增程' : '燃油',
    body_type: raw.body_type || 'SUV',
    range: raw.range || 500,
    acceleration: raw.acceleration || 6,
    trunk_volume: raw.trunk_volume || 400,
    charging_time: raw.charging_time || 30,
    smart_drive_level: raw.smart_drive_level || 'L2',
    tags: raw.tags || [],
    pros: raw.pros || [],
    cons: raw.cons || [],
  }
}

// 清洗 + 校验
const normalized = rawDataFromWeb.map((raw: unknown) => normalizeCar(raw as Partial<Car>))
const validCars = normalized
  .map(car => CarSchema.safeParse(car))
  .filter(r => r.success)
  .map(r => r.data)

console.log('清洗后有效数据:', validCars.length, '款')
console.log(JSON.stringify(validCars, null, 2))