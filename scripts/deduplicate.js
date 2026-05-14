const fs = require("fs");
const path = "d:/CAI/vehicle-x/data/cars.json";
const data = JSON.parse(fs.readFileSync(path, "utf8"));
const seen = new Set();
const unique = data.filter(car => {
  if (seen.has(car.id)) return false;
  seen.add(car.id);
  return true;
});
const duplicates = data.length - unique.length;
fs.writeFileSync(path, JSON.stringify(unique, null, 2));
console.log("去重完成！原数据: " + data.length + " 条, 去重后: " + unique.length + " 条, 移除重复: " + duplicates + " 条");