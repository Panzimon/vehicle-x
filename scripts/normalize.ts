import { CarSchema, Car } from '../src/lib/schema'
import fs from 'fs'
import path from 'path'

const jsonPath = path.join(__dirname, '../data/cars.json')

const rawData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))

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

const normalized = rawData.map((raw: unknown) => normalizeCar(raw as Partial<Car>))
const validCars = normalized
  .map((car: unknown) => CarSchema.safeParse(car))
  .filter((r: { success: boolean }): r is { success: true; data: Car } => r.success)
  .map((r: { data: Car }) => r.data)

console.log('原始数据:', rawData.length, '款')
console.log('清洗后有效数据:', validCars.length, '款')

fs.writeFileSync(jsonPath, JSON.stringify(validCars, null, 2), 'utf-8')
console.log('已写入:', jsonPath)
