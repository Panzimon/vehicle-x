export const tools = [
  {
    type: "function",
    function: {
      name: "search_car_by_budget",
      description:
        "根据用户预算、车型偏好和用车场景筛选车型。当用户提到预算、价格、买车、推荐车型、选车、适合某种场景（如露营、通勤）等需求时，必须调用此工具。",
      parameters: {
        type: "object",
        properties: {
          min_price: { type: "number", description: "最低预算（万元）" },
          max_price: { type: "number", description: "最高预算（万元）" },
          energy_type: {
            type: "string",
            enum: ["纯电", "插混", "增程", "燃油"],
          },
          body_type: { type: "string", enum: ["轿车", "SUV", "MPV"] },
          scene_tag: {
            type: "string",
            description: '用车场景标签，如"露营"、"通勤"、"家用"等（可选）',
          },
        },
        required: ["min_price", "max_price"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_car_detail",
      description: "根据车型 ID 获取详细参数和优缺点",
      parameters: {
        type: "object",
        properties: {
          car_id: {
            type: "string",
            description: "车型 ID，如 tesla-model-y-2024",
          },
        },
        required: ["car_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "compare_cars",
      description: "对比多款车的核心参数，返回对比表格",
      parameters: {
        type: "object",
        properties: {
          car_ids: {
            type: "array",
            items: { type: "string" },
            description:
              '车型 ID 数组，如 ["tesla-model-y-2024", "li-l6-2024"]',
          },
        },
        required: ["car_ids"],
      },
    },
  },
];
