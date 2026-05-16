/**
 * 数据层模块
 * 提供车型数据的查询操作，被 actions.ts 和 api/chat/route.ts 共用
 */

import { readFileSync } from "fs";
import { join } from "path";
import { CarSchema, Car } from "@/lib/schema";
import { z } from "zod";

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
  return cars.filter((car) => {
    if (car.price < minPrice || car.price > maxPrice) return false;
    if (energyType && car.energy_type !== energyType) return false;
    if (bodyType && car.body_type !== bodyType) return false;

    // 如果指定了场景标签，在 tags、pros、cons、model 中模糊匹配
    if (sceneTag) {
      const keywords = sceneTag.split(/[,，、]/).map((k) => k.trim()).filter(Boolean);
      const carText = `${car.tags.join(" ")} ${car.pros.join(" ")} ${car.cons.join(" ")} ${car.model}`;
      const matched = keywords.some((kw) => carText.includes(kw));
      if (!matched) return false;
    }

    return true;
  });
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