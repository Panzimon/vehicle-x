/**
 * 数据层模块
 * 提供车型数据的查询操作，被 actions.ts 和 api/chat/route.ts 共用
 */

import { readFileSync } from "fs";
import { join } from "path";
import { CarSchema, Car } from "@/lib/schema";
import { z } from "zod";

// ========== 语义匹配词库 ==========
// 同义词映射：关键词 -> 匹配词列表
const SEMANTIC_MAP: Record<string, string[]> = {
  // 场景
  '通勤': ['通勤', '代步', '上班', '日常', '省油', '省油', '经济', '低成本', '省钱'],
  '代步': ['代步', '通勤', '上班', '日常', '省油', '经济', '低成本', '省钱'],
  '上班': ['上班', '通勤', '代步', '日常', '省油', '经济', '低成本', '省钱'],
  '露营': ['露营', '户外', '越野', '四驱', '空间大', '后备箱大', '装载', '旅行', '自驾'],
  '户外': ['户外', '露营', '越野', '四驱', '空间大', '后备箱大', '装载', '旅行', '自驾'],
  '越野': ['越野', '露营', '户外', '四驱', '空间大', '后备箱大', '装载', '旅行', '自驾'],
  '家用': ['家用', '家庭', '带娃', '舒适', '空间大', '安全', '省心', '耐用'],
  '家庭': ['家庭', '家用', '带娃', '舒适', '空间大', '安全', '省心', '耐用'],
  '带娃': ['带娃', '家用', '家庭', '舒适', '空间大', '安全', '儿童', '婴儿'],
  '商务': ['商务', '接待', '豪华', '舒适', '面子', '排面', '档次'],
  '接待': ['接待', '商务', '豪华', '舒适', '面子', '排面', '档次'],
  '旅行': ['旅行', '长途', '自驾', '露营', '户外', '空间大', '舒适', '续航长'],
  '长途': ['长途', '旅行', '自驾', '续航长', '舒适', '省油', '省心'],

  // 属性
  '空间大': ['空间大', '宽敞', '后排大', '后备箱大', '装载', '家用', '露营', '舒适'],
  '宽敞': ['宽敞', '空间大', '后排大', '舒适', '家用'],
  '省油': ['省油', '省油', '经济', '低成本', '省钱', '混动', '插混', '增程'],
  '经济': ['经济', '省油', '低成本', '省钱', '实惠', '便宜', '代步', '通勤'],
  '省钱': ['省钱', '省油', '经济', '低成本', '实惠', '便宜'],
  '智驾': ['智驾', '智驾强', '智能驾驶', '辅助驾驶', '自动', 'NOA', '自动驾驶'],
  '智能驾驶': ['智能驾驶', '智驾', '智驾强', '辅助驾驶', '自动', 'NOA', '自动驾驶'],
  '舒适': ['舒适', '安静', '隔音', '悬挂', '减震', '家用', '商务', '豪华'],
  '安全': ['安全', '气囊', '碰撞', '车身', 'AEB', '主动安全', '儿童', '家用'],
  '豪华': ['豪华', '高档', '豪华', '舒适', '商务', '面子', '排面', '档次'],
  '运动': ['运动', '操控', '加速', '动力', '性能', '赛道', '驾驶乐趣'],
  '操控': ['操控', '运动', '加速', '动力', '性能', '驾驶乐趣', '底盘'],
  '动力': ['动力', '加速', '运动', '性能', '马力', '扭矩', '推背感'],
  '续航长': ['续航长', '长续航', '里程', '续航', '远', '长途', '旅行'],
  '快充': ['快充', '充电快', '超充', '800V', '高压', '充电'],
  '充电': ['充电', '快充', '充电快', '超充', '800V', '补能'],

  // 车身
  'SUV': ['SUV', '越野', '空间大', '后备箱大', '露营', '户外', '通过性'],
  '轿车': ['轿车', '舒适', '省油', '经济', '操控', '运动', '商务'],
  'MPV': ['MPV', '空间大', '家用', '家庭', '带娃', '商务', '接待', '舒适'],
}

/**
 * 语义匹配：检查文本是否包含关键词或其同义词
 * @param text - 待匹配的文本
 * @param keyword - 用户输入的关键词
 * @returns 是否匹配
 */
function matchSemantic(text: string, keyword: string): boolean {
  const lowerText = text.toLowerCase();
  const lowerKeyword = keyword.toLowerCase();

  // 直接包含
  if (lowerText.includes(lowerKeyword)) return true;

  // 查找同义词列表
  const synonyms = SEMANTIC_MAP[lowerKeyword];
  if (synonyms) {
    return synonyms.some((syn) => lowerText.includes(syn.toLowerCase()));
  }

  return false;
}

// 缓存已加载的车型数据
let tempCars: Car[] = [];

/**
 * 加载车型数据
 * 首次调用时从 cars.json 读取并验证数据格式，之后返回缓存
 */
export function loadCars(): Car[] {
  if (tempCars.length > 0) return tempCars;
  const path = join(process.cwd(), "data", "cars.json");
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  const result = z.array(CarSchema).safeParse(raw);
  if (!result.success) {
    console.error("cars.json 数据格式错误:", result.error.issues);
    throw new Error("车型数据校验失败，请检查 data/cars.json");
  }
  tempCars = result.data;
  return tempCars;
}

/**
 * 通过关键词模糊匹配车型
 * 支持通过 ID、品牌名、车型名进行匹配
 * @param keyword - 搜索关键词
 * @returns 匹配的车型，未找到返回 null
 */
export function findCarByKeyword(keyword: string): Car | null {
  if (!keyword) return null;
  const cars = loadCars();
  const lowerKeyword = keyword.toLowerCase().replace(/\s+/g, "");

  return (
    cars.find((car) => {
      const idMatch = car.id.toLowerCase().replace(/\s+/g, "").includes(lowerKeyword);
      const brandMatch = car.brand.toLowerCase().replace(/\s+/g, "").includes(lowerKeyword);
      const modelMatch = car.model.toLowerCase().replace(/\s+/g, "").includes(lowerKeyword);
      return idMatch || brandMatch || modelMatch;
    }) || null
  );
}

/**
 * 按预算筛选车型
 * @param minPrice - 最低预算（万元）
 * @param maxPrice - 最高预算（万元）
 * @param energyType - 能源类型（纯电/插混/增程/燃油），可选
 * @param bodyType - 车身类型（轿车/SUV/MPV），可选
 * @param sceneTag - 用车场景标签（露营/通勤/家用），可选
 */
export function searchCarByBudget(
  minPrice: number,
  maxPrice: number,
  energyType?: string,
  bodyType?: string,
  sceneTag?: string
): Car[] {
  const cars = loadCars();
  
  // 安全机制：如果预算范围太窄（小于等于5万），自动扩展
  let adjustedMin = minPrice;
  let adjustedMax = maxPrice;
  if (maxPrice - minPrice <= 5) {
    adjustedMin = Math.max(0, minPrice - 5);
    adjustedMax = maxPrice + 5;
    console.log('预算范围过窄，自动扩展:', { original: { minPrice, maxPrice }, adjusted: { adjustedMin, adjustedMax } });
  }

  console.log('searchCarByBudget 参数:', { adjustedMin, adjustedMax, energyType, bodyType, sceneTag })
  
  const results = cars.filter((car) => {
    if (car.price < adjustedMin || car.price > adjustedMax) {
      return false;
    }
    if (energyType && car.energy_type !== energyType) {
      return false;
    }
    if (bodyType && car.body_type !== bodyType) {
      return false;
    }

    // 如果指定了场景标签，在 tags、pros、cons、model 中语义匹配
    if (sceneTag) {
      const keywords = sceneTag.split(/[,，、/\\]/).map((k) => k.trim()).filter(Boolean);
      const carText = `${car.tags.join(" ")} ${car.pros.join(" ")} ${car.cons.join(" ")} ${car.model}`;
      const matched = keywords.some((kw) => matchSemantic(carText, kw));
      if (!matched) return false;
    }

    return true;
  });

  console.log('找到', results.length, '款车，详情:', results.map((c) => ({ id: c.id, price: c.price, body_type: c.body_type })))
  return results;
}

/**
 * 获取车型详情
 * @param carIdOrName - 车型ID或名称
 */
export function getCarDetail(carIdOrName: string): Car | null {
  return findCarByKeyword(carIdOrName);
}

/**
 * 对比多款车型
 * @param carIdsOrNames - 车型ID或名称数组
 */
export function compareCars(carIdsOrNames: string[]): Car[] {
  const results: Car[] = [];

  for (const keyword of carIdsOrNames) {
    const car = findCarByKeyword(keyword);
    // 避免重复添加同一车型
    if (car && !results.find((c) => c.id === car.id)) {
      results.push(car);
    }
  }

  return results;
}