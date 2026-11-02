/** 内置组件目录；图元颜色属于画布内容，沿用星屿配色的固定墨色。 */

export type LibraryCategoryId = "basic" | "architecture" | "flow" | "prototype" | "chart" | "mine";

export interface LibraryCategory {
  id: LibraryCategoryId;
  label: string;
  hint: string;
}

export const LIBRARY_CATEGORIES: LibraryCategory[] = [
  { id: "basic", label: "基础", hint: "形状、文本与便签" },
  { id: "architecture", label: "架构", hint: "服务、数据与网络" },
  { id: "flow", label: "流程建模", hint: "流程图与连线" },
  { id: "prototype", label: "产品原型", hint: "控件与页面容器" },
  { id: "chart", label: "数据图表", hint: "统计图与数据卡片" },
  { id: "mine", label: "我的组件", hint: "从组件库启用或导入的组件" },
];

export interface CatalogComponent {
  key: string;
  name: string;
  category: Exclude<LibraryCategoryId, "mine">;
  section: string;
  skeletons: BoardSkeleton[];
}

export type BoardSkeleton = Record<string, unknown> & { type: string };

const INK = "#2B2420";
const MUTED = "#626663";
const LINE = "#8C847C";
const PAPER = "#FAF6F1";
const WHITE = "#FFFFFF";
const GREEN = "#5C8F83";
const GREEN_FILL = "#E7F1ED";
const AMBER = "#B08A55";
const AMBER_FILL = "#F7F0E5";
const BLUE = "#7C82B8";
const BLUE_FILL = "#EFEFF8";
const RED = "#C0554E";
const RED_FILL = "#FAEDEA";

interface BoxOptions {
  fill?: string;
  stroke?: string;
  dashed?: boolean;
  round?: boolean;
  label?: string;
  labelColor?: string;
  fontSize?: number;
  opacity?: number;
}

function box(x: number, y: number, w: number, h: number, options: BoxOptions = {}): BoardSkeleton {
  return {
    type: "rectangle",
    x,
    y,
    width: w,
    height: h,
    strokeColor: options.stroke ?? LINE,
    backgroundColor: options.fill ?? "transparent",
    fillStyle: "solid",
    strokeWidth: 1.5,
    strokeStyle: options.dashed ? "dashed" : "solid",
    roughness: 0,
    opacity: options.opacity ?? 100,
    ...(options.round ? { roundness: { type: 3 } } : {}),
    ...(options.label
      ? {
          label: {
            text: options.label,
            fontSize: options.fontSize ?? 13,
            fontFamily: 2,
            strokeColor: options.labelColor ?? INK,
          },
        }
      : {}),
  };
}

function ellipse(x: number, y: number, w: number, h: number, options: BoxOptions = {}): BoardSkeleton {
  return {
    type: "ellipse",
    x,
    y,
    width: w,
    height: h,
    strokeColor: options.stroke ?? LINE,
    backgroundColor: options.fill ?? "transparent",
    fillStyle: "solid",
    strokeWidth: 1.5,
    strokeStyle: options.dashed ? "dashed" : "solid",
    roughness: 0,
    opacity: options.opacity ?? 100,
    ...(options.label
      ? {
          label: {
            text: options.label,
            fontSize: options.fontSize ?? 13,
            fontFamily: 2,
            strokeColor: options.labelColor ?? INK,
          },
        }
      : {}),
  };
}

function diamond(x: number, y: number, w: number, h: number, options: BoxOptions = {}): BoardSkeleton {
  return {
    type: "diamond",
    x,
    y,
    width: w,
    height: h,
    strokeColor: options.stroke ?? LINE,
    backgroundColor: options.fill ?? "transparent",
    fillStyle: "solid",
    strokeWidth: 1.5,
    roughness: 0,
    ...(options.label
      ? {
          label: {
            text: options.label,
            fontSize: options.fontSize ?? 12,
            fontFamily: 2,
            strokeColor: options.labelColor ?? INK,
          },
        }
      : {}),
  };
}

function text(
  x: number,
  y: number,
  value: string,
  options: { size?: number; color?: string; align?: "left" | "center" | "right" } = {},
): BoardSkeleton {
  return {
    type: "text",
    x,
    y,
    text: value,
    fontSize: options.size ?? 13,
    fontFamily: 2,
    strokeColor: options.color ?? INK,
    textAlign: options.align ?? "left",
    verticalAlign: "top",
  };
}

function arrow(
  x: number,
  y: number,
  w: number,
  h: number,
  options: { dashed?: boolean; double?: boolean; color?: string } = {},
): BoardSkeleton {
  return {
    type: "arrow",
    x,
    y,
    width: w,
    height: h,
    strokeColor: options.color ?? GREEN,
    strokeWidth: 1.5,
    strokeStyle: options.dashed ? "dashed" : "solid",
    roughness: 0,
    points: [
      [0, 0],
      [w, h],
    ],
    startArrowhead: options.double ? "arrow" : null,
    endArrowhead: "arrow",
  };
}

function polyline(
  points: number[][],
  options: { color?: string; dashed?: boolean; fill?: string; width?: number } = {},
): BoardSkeleton {
  const xs = points.map((point) => point[0] ?? 0);
  const ys = points.map((point) => point[1] ?? 0);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    type: "line",
    x: minX,
    y: minY,
    width: Math.max(1, Math.max(...xs) - minX),
    height: Math.max(1, Math.max(...ys) - minY),
    points: points.map(([x = 0, y = 0]) => [x - minX, y - minY]),
    strokeColor: options.color ?? LINE,
    backgroundColor: options.fill ?? "transparent",
    fillStyle: "solid",
    strokeWidth: options.width ?? 1.5,
    strokeStyle: options.dashed ? "dashed" : "solid",
    roughness: 0,
  };
}

function person(x: number, y: number, scale = 1): BoardSkeleton[] {
  return [
    ellipse(x + 14 * scale, y, 22 * scale, 22 * scale, { fill: BLUE_FILL, stroke: BLUE }),
    polyline(
      [
        [x + 26 * scale, y + 24 * scale],
        [x + 8 * scale, y + 56 * scale],
        [x + 44 * scale, y + 56 * scale],
        [x + 26 * scale, y + 24 * scale],
      ],
      { color: BLUE },
    ),
  ];
}

function database(x: number, y: number, label = "数据库"): BoardSkeleton[] {
  return [
    ellipse(x, y, 92, 20, { fill: GREEN_FILL, stroke: GREEN }),
    polyline(
      [
        [x, y + 10],
        [x, y + 54],
      ],
      { color: GREEN },
    ),
    polyline(
      [
        [x + 92, y + 10],
        [x + 92, y + 54],
      ],
      { color: GREEN },
    ),
    ellipse(x, y + 44, 92, 20, { fill: GREEN_FILL, stroke: GREEN }),
    text(x + 16, y + 26, label, { size: 12, color: "#285247" }),
  ];
}

function cloudShape(x: number, y: number): BoardSkeleton[] {
  return [
    ellipse(x + 12, y + 16, 46, 36, { fill: PAPER, stroke: BLUE }),
    ellipse(x + 34, y + 4, 54, 44, { fill: PAPER, stroke: BLUE }),
    ellipse(x + 62, y + 18, 44, 34, { fill: PAPER, stroke: BLUE }),
    box(x + 18, y + 30, 74, 22, { fill: PAPER, stroke: "transparent" }),
    text(x + 38, y + 32, "云", { size: 12, color: "#4E5385" }),
  ];
}

export const BUILTIN_COMPONENTS: CatalogComponent[] = [
  // 基础
  {
    key: "basic.starris-note",
    name: "星屿便签",
    category: "basic",
    section: "星屿组件",
    skeletons: [
      box(0, 0, 180, 96, { fill: GREEN_FILL, stroke: GREEN, round: true }),
      text(16, 16, "星屿便签", { size: 15, color: "#285247" }),
      text(16, 46, "双击编辑内容", { size: 11, color: MUTED }),
    ],
  },
  {
    key: "basic.task-card",
    name: "待办条目",
    category: "basic",
    section: "星屿组件",
    skeletons: [
      box(0, 0, 180, 70, { fill: AMBER_FILL, stroke: AMBER, round: true }),
      text(16, 14, "待办事项", { size: 14, color: "#74542C" }),
      text(16, 42, "□ 待处理   □ 进行中", { size: 10, color: MUTED }),
    ],
  },
  {
    key: "basic.label",
    name: "星屿标签",
    category: "basic",
    section: "星屿组件",
    skeletons: [
      box(0, 0, 136, 38, { fill: BLUE_FILL, stroke: BLUE, round: true }),
      text(14, 10, "星屿标签", { size: 12, color: "#4E5385" }),
    ],
  },
  {
    key: "basic.rect",
    name: "矩形",
    category: "basic",
    section: "基础形状",
    skeletons: [box(6, 14, 148, 76, { fill: WHITE, stroke: LINE })],
  },
  {
    key: "basic.rounded",
    name: "圆角卡片",
    category: "basic",
    section: "基础形状",
    skeletons: [box(6, 14, 148, 76, { fill: WHITE, stroke: LINE, round: true })],
  },
  {
    key: "basic.ellipse",
    name: "椭圆",
    category: "basic",
    section: "基础形状",
    skeletons: [ellipse(12, 16, 136, 72, { fill: WHITE, stroke: LINE })],
  },
  {
    key: "basic.diamond",
    name: "菱形",
    category: "basic",
    section: "基础形状",
    skeletons: [diamond(18, 12, 124, 80, { fill: WHITE, stroke: LINE })],
  },
  {
    key: "basic.arrow",
    name: "箭头",
    category: "basic",
    section: "连接与分组",
    skeletons: [arrow(8, 62, 144, 0)],
  },
  {
    key: "basic.double-arrow",
    name: "双向箭头",
    category: "basic",
    section: "连接与分组",
    skeletons: [arrow(8, 62, 144, 0, { double: true })],
  },
  {
    key: "basic.group",
    name: "分组虚框",
    category: "basic",
    section: "连接与分组",
    skeletons: [box(6, 10, 148, 84, { dashed: true, round: true })],
  },
  {
    key: "basic.heading",
    name: "标题文本",
    category: "basic",
    section: "文本与便签",
    skeletons: [text(6, 26, "标题文本", { size: 24 })],
  },
  {
    key: "basic.paragraph",
    name: "正文文本",
    category: "basic",
    section: "文本与便签",
    skeletons: [text(6, 22, "到这里写正文内容", { size: 13, color: MUTED })],
  },
  {
    key: "basic.sticky",
    name: "便利贴",
    category: "basic",
    section: "文本与便签",
    skeletons: [
      box(10, 8, 140, 84, { fill: AMBER_FILL, stroke: AMBER }),
      text(22, 20, "记一条想法", { size: 12, color: "#74542C" }),
    ],
  },

  // 架构
  {
    key: "architecture.service",
    name: "服务",
    category: "architecture",
    section: "计算",
    skeletons: [box(18, 20, 124, 64, { fill: GREEN_FILL, stroke: GREEN, round: true, label: "服务" })],
  },
  {
    key: "architecture.microservice",
    name: "微服务",
    category: "architecture",
    section: "计算",
    skeletons: [
      box(2, 10, 66, 38, { fill: GREEN_FILL, stroke: GREEN, round: true, label: "服务", fontSize: 11 }),
      box(92, 10, 66, 38, { fill: GREEN_FILL, stroke: GREEN, round: true, label: "服务", fontSize: 11 }),
      box(47, 66, 66, 38, { fill: GREEN_FILL, stroke: GREEN, round: true, label: "服务", fontSize: 11 }),
      arrow(35, 50, 40, 14),
      arrow(115, 50, -40, 14),
    ],
  },
  {
    key: "architecture.container",
    name: "容器",
    category: "architecture",
    section: "计算",
    skeletons: [
      box(8, 12, 144, 80, { fill: BLUE_FILL, stroke: BLUE, round: true }),
      box(24, 28, 40, 40, { fill: WHITE, stroke: BLUE, round: true }),
      text(74, 38, "容器", { size: 13, color: "#4E5385" }),
    ],
  },
  {
    key: "architecture.function",
    name: "函数",
    category: "architecture",
    section: "计算",
    skeletons: [
      box(18, 20, 124, 64, { fill: AMBER_FILL, stroke: AMBER, round: true }),
      text(42, 36, "ƒ 函数", { size: 16, color: "#74542C" }),
    ],
  },
  {
    key: "architecture.database",
    name: "数据库",
    category: "architecture",
    section: "数据",
    skeletons: database(28, 14),
  },
  {
    key: "architecture.cache",
    name: "缓存",
    category: "architecture",
    section: "数据",
    skeletons: [
      box(18, 20, 124, 64, { fill: RED_FILL, stroke: RED, round: true }),
      text(48, 38, "缓存", { size: 14, color: "#7A2D28" }),
    ],
  },
  {
    key: "architecture.object-storage",
    name: "对象存储",
    category: "architecture",
    section: "数据",
    skeletons: [
      box(18, 20, 124, 64, { fill: BLUE_FILL, stroke: BLUE, round: true }),
      text(38, 36, "对象存储", { size: 13, color: "#4E5385" }),
    ],
  },
  {
    key: "architecture.queue",
    name: "消息队列",
    category: "architecture",
    section: "数据",
    skeletons: [
      box(4, 34, 32, 26, { fill: WHITE, stroke: LINE, round: true }),
      box(60, 34, 32, 26, { fill: WHITE, stroke: LINE, round: true }),
      box(116, 34, 32, 26, { fill: WHITE, stroke: LINE, round: true }),
      arrow(36, 47, 20, 0),
      arrow(92, 47, 20, 0),
      text(28, 70, "消息队列", { size: 11, color: MUTED }),
    ],
  },
  {
    key: "architecture.user",
    name: "用户",
    category: "architecture",
    section: "网络",
    skeletons: [...person(55, 8), text(48, 72, "用户", { size: 12, color: "#4E5385" })],
  },
  {
    key: "architecture.gateway",
    name: "网关",
    category: "architecture",
    section: "网络",
    skeletons: [diamond(22, 18, 116, 68, { fill: BLUE_FILL, stroke: BLUE, label: "网关", fontSize: 13 })],
  },
  {
    key: "architecture.balancer",
    name: "负载均衡",
    category: "architecture",
    section: "网络",
    skeletons: [
      box(0, 34, 54, 32, { fill: GREEN_FILL, stroke: GREEN, round: true, label: "均衡", fontSize: 10 }),
      box(104, 4, 52, 28, { fill: WHITE, stroke: LINE, round: true, label: "节点", fontSize: 10 }),
      box(104, 40, 52, 28, { fill: WHITE, stroke: LINE, round: true, label: "节点", fontSize: 10 }),
      box(104, 76, 52, 28, { fill: WHITE, stroke: LINE, round: true, label: "节点", fontSize: 10 }),
      arrow(54, 50, 50, -30),
      arrow(54, 50, 50, 0),
      arrow(54, 50, 50, 30),
    ],
  },
  {
    key: "architecture.cloud",
    name: "云",
    category: "architecture",
    section: "网络",
    skeletons: cloudShape(16, 24),
  },
  {
    key: "architecture.firewall",
    name: "防火墙",
    category: "architecture",
    section: "安全",
    skeletons: [
      box(12, 14, 136, 76, { fill: RED_FILL, stroke: RED, dashed: true }),
      polyline(
        [
          [12, 40],
          [148, 40],
        ],
        { color: RED },
      ),
      polyline(
        [
          [58, 14],
          [58, 40],
        ],
        { color: RED },
      ),
      polyline(
        [
          [104, 40],
          [104, 90],
        ],
        { color: RED },
      ),
      text(46, 22, "防火墙", { size: 12, color: "#7A2D28" }),
    ],
  },

  // 流程建模
  {
    key: "flow.start",
    name: "开始",
    category: "flow",
    section: "流程图",
    skeletons: [box(34, 30, 92, 44, { fill: GREEN_FILL, stroke: GREEN, round: true, label: "开始" })],
  },
  {
    key: "flow.end",
    name: "结束",
    category: "flow",
    section: "流程图",
    skeletons: [box(34, 30, 92, 44, { fill: RED_FILL, stroke: RED, round: true, label: "结束" })],
  },
  {
    key: "flow.process",
    name: "处理",
    category: "flow",
    section: "流程图",
    skeletons: [box(26, 28, 108, 48, { fill: WHITE, stroke: LINE, label: "处理步骤", fontSize: 12 })],
  },
  {
    key: "flow.decision",
    name: "判断",
    category: "flow",
    section: "流程图",
    skeletons: [diamond(30, 16, 100, 72, { fill: AMBER_FILL, stroke: AMBER, label: "判断", fontSize: 12 })],
  },
  {
    key: "flow.subprocess",
    name: "子流程",
    category: "flow",
    section: "流程图",
    skeletons: [
      box(26, 28, 108, 48, { fill: WHITE, stroke: LINE, label: "子流程", fontSize: 12 }),
      polyline(
        [
          [40, 28],
          [40, 76],
        ],
        { color: LINE },
      ),
      polyline(
        [
          [120, 28],
          [120, 76],
        ],
        { color: LINE },
      ),
    ],
  },
  {
    key: "flow.document",
    name: "文档",
    category: "flow",
    section: "流程图",
    skeletons: [
      polyline(
        [
          [26, 30],
          [134, 30],
          [134, 66],
          [110, 74],
          [86, 66],
          [62, 74],
          [26, 66],
          [26, 30],
        ],
        { color: LINE },
      ),
      text(62, 40, "文档", { size: 12 }),
    ],
  },
  {
    key: "flow.data",
    name: "数据",
    category: "flow",
    section: "流程图",
    skeletons: [
      polyline(
        [
          [46, 30],
          [144, 30],
          [114, 74],
          [16, 74],
          [46, 30],
        ],
        { color: BLUE },
      ),
      text(60, 42, "数据", { size: 12, color: "#4E5385" }),
    ],
  },
  {
    key: "flow.swimlane",
    name: "泳道",
    category: "flow",
    section: "分组",
    skeletons: [
      box(4, 6, 152, 92, { fill: WHITE, stroke: LINE }),
      polyline(
        [
          [4, 30],
          [156, 30],
        ],
        { color: LINE },
      ),
      polyline(
        [
          [80, 6],
          [80, 98],
        ],
        { color: LINE, dashed: true },
      ),
      text(12, 12, "角色 A", { size: 11, color: MUTED }),
      text(88, 12, "角色 B", { size: 11, color: MUTED }),
    ],
  },
  {
    key: "flow.stage",
    name: "阶段",
    category: "flow",
    section: "分组",
    skeletons: [
      box(8, 30, 144, 44, { fill: GREEN_FILL, stroke: GREEN, round: true }),
      ellipse(20, 44, 16, 16, { fill: GREEN, stroke: GREEN }),
      text(48, 43, "阶段一", { size: 12, color: "#285247" }),
    ],
  },
  {
    key: "flow.link",
    name: "实线连接",
    category: "flow",
    section: "连线",
    skeletons: [arrow(10, 50, 140, 0)],
  },
  {
    key: "flow.dashed-link",
    name: "虚线连接",
    category: "flow",
    section: "连线",
    skeletons: [arrow(10, 50, 140, 0, { dashed: true })],
  },
  {
    key: "flow.branch",
    name: "分支",
    category: "flow",
    section: "连线",
    skeletons: [
      arrow(8, 50, 58, -34),
      arrow(8, 50, 58, 34),
      text(76, 6, "是", { size: 11, color: MUTED }),
      text(76, 80, "否", { size: 11, color: MUTED }),
    ],
  },

  // 产品原型
  {
    key: "prototype.button",
    name: "按钮",
    category: "prototype",
    section: "控件",
    skeletons: [box(34, 36, 92, 36, { fill: WHITE, stroke: BLUE, round: true, label: "按钮" })],
  },
  {
    key: "prototype.primary-button",
    name: "主按钮",
    category: "prototype",
    section: "控件",
    skeletons: [
      box(30, 34, 100, 38, { fill: BLUE, stroke: BLUE, round: true, label: "确定", labelColor: WHITE }),
    ],
  },
  {
    key: "prototype.input",
    name: "输入框",
    category: "prototype",
    section: "控件",
    skeletons: [
      box(20, 36, 120, 36, { fill: WHITE, stroke: LINE, round: true }),
      text(32, 45, "请输入内容", { size: 11, color: MUTED }),
    ],
  },
  {
    key: "prototype.select",
    name: "下拉框",
    category: "prototype",
    section: "控件",
    skeletons: [
      box(20, 36, 120, 36, { fill: WHITE, stroke: LINE, round: true }),
      text(32, 45, "请选择", { size: 11, color: MUTED }),
      polyline(
        [
          [118, 50],
          [124, 56],
          [130, 50],
        ],
        { color: MUTED },
      ),
    ],
  },
  {
    key: "prototype.toggle",
    name: "开关",
    category: "prototype",
    section: "控件",
    skeletons: [
      box(28, 42, 52, 26, { fill: GREEN_FILL, stroke: GREEN, round: true }),
      ellipse(58, 45, 20, 20, { fill: GREEN, stroke: GREEN }),
      text(90, 46, "已开启", { size: 11, color: MUTED }),
    ],
  },
  {
    key: "prototype.checkbox",
    name: "复选框",
    category: "prototype",
    section: "控件",
    skeletons: [
      box(28, 44, 20, 20, { fill: GREEN_FILL, stroke: GREEN, round: true }),
      polyline(
        [
          [32, 54],
          [37, 59],
          [46, 48],
        ],
        { color: GREEN },
      ),
      text(58, 46, "复选项", { size: 11, color: MUTED }),
    ],
  },
  {
    key: "prototype.radio",
    name: "单选框",
    category: "prototype",
    section: "控件",
    skeletons: [
      ellipse(28, 44, 20, 20, { fill: WHITE, stroke: GREEN }),
      ellipse(33, 49, 10, 10, { fill: GREEN, stroke: GREEN }),
      text(58, 46, "单选项", { size: 11, color: MUTED }),
    ],
  },
  {
    key: "prototype.progress",
    name: "进度条",
    category: "prototype",
    section: "控件",
    skeletons: [
      box(20, 50, 120, 12, { fill: GREEN_FILL, stroke: GREEN_FILL, round: true }),
      box(20, 50, 76, 12, { fill: GREEN, stroke: GREEN, round: true }),
      text(20, 24, "进度 64%", { size: 10, color: MUTED }),
    ],
  },
  {
    key: "prototype.card",
    name: "卡片",
    category: "prototype",
    section: "容器",
    skeletons: [
      box(12, 10, 136, 84, { fill: WHITE, stroke: LINE, round: true }),
      box(22, 20, 42, 42, { fill: GREEN_FILL, stroke: GREEN_FILL, round: true }),
      text(74, 24, "卡片标题", { size: 12 }),
      text(74, 46, "一段简短说明", { size: 10, color: MUTED }),
    ],
  },
  {
    key: "prototype.modal",
    name: "弹窗",
    category: "prototype",
    section: "容器",
    skeletons: [
      box(14, 8, 132, 88, { fill: WHITE, stroke: LINE, round: true }),
      text(26, 20, "弹窗标题", { size: 12 }),
      polyline(
        [
          [14, 40],
          [146, 40],
        ],
        { color: LINE },
      ),
      box(88, 68, 46, 20, {
        fill: BLUE,
        stroke: BLUE,
        round: true,
        label: "确定",
        fontSize: 9,
        labelColor: WHITE,
      }),
    ],
  },
  {
    key: "prototype.navbar",
    name: "导航栏",
    category: "prototype",
    section: "容器",
    skeletons: [
      box(6, 14, 148, 30, { fill: WHITE, stroke: LINE, round: true }),
      ellipse(16, 22, 14, 14, { fill: BLUE, stroke: BLUE }),
      text(38, 21, "星屿", { size: 11, color: "#4E5385" }),
      polyline(
        [
          [96, 29],
          [112, 29],
        ],
        { color: MUTED },
      ),
      polyline(
        [
          [128, 29],
          [144, 29],
        ],
        { color: MUTED },
      ),
    ],
  },
  {
    key: "prototype.table",
    name: "表格",
    category: "prototype",
    section: "容器",
    skeletons: [
      box(4, 10, 152, 84, { fill: WHITE, stroke: LINE }),
      box(4, 10, 152, 24, { fill: GREEN_FILL, stroke: GREEN_FILL }),
      polyline(
        [
          [4, 34],
          [156, 34],
        ],
        { color: LINE },
      ),
      polyline(
        [
          [56, 10],
          [56, 94],
        ],
        { color: LINE },
      ),
      polyline(
        [
          [106, 10],
          [106, 94],
        ],
        { color: LINE },
      ),
      text(14, 16, "名称", { size: 10, color: "#285247" }),
      text(66, 16, "状态", { size: 10, color: "#285247" }),
      text(116, 16, "时间", { size: 10, color: "#285247" }),
    ],
  },
  {
    key: "prototype.avatar",
    name: "头像",
    category: "prototype",
    section: "内容",
    skeletons: [...person(55, 8), text(58, 72, "头像", { size: 10, color: MUTED })],
  },
  {
    key: "prototype.image",
    name: "图片占位",
    category: "prototype",
    section: "内容",
    skeletons: [
      box(18, 12, 124, 80, { fill: PAPER, stroke: LINE, round: true }),
      polyline(
        [
          [18, 74],
          [56, 40],
          [88, 62],
          [110, 48],
          [142, 78],
        ],
        { color: LINE },
      ),
      ellipse(102, 22, 14, 14, { fill: AMBER_FILL, stroke: AMBER }),
    ],
  },
  {
    key: "prototype.tag",
    name: "标签",
    category: "prototype",
    section: "内容",
    skeletons: [box(42, 38, 76, 28, { fill: GREEN_FILL, stroke: GREEN, round: true, label: "标签" })],
  },

  // 数据图表
  {
    key: "chart.bar",
    name: "柱状图",
    category: "chart",
    section: "统计图",
    skeletons: [
      polyline(
        [
          [16, 8],
          [16, 92],
          [152, 92],
        ],
        { color: LINE },
      ),
      box(34, 54, 20, 38, { fill: GREEN, stroke: GREEN }),
      box(64, 36, 20, 56, { fill: AMBER, stroke: AMBER }),
      box(94, 62, 20, 30, { fill: BLUE, stroke: BLUE }),
      box(124, 24, 20, 68, { fill: RED, stroke: RED }),
    ],
  },
  {
    key: "chart.line",
    name: "折线图",
    category: "chart",
    section: "统计图",
    skeletons: [
      polyline(
        [
          [16, 8],
          [16, 92],
          [152, 92],
        ],
        { color: LINE },
      ),
      polyline(
        [
          [24, 72],
          [52, 48],
          [82, 60],
          [112, 28],
          [146, 38],
        ],
        { color: GREEN, width: 2 },
      ),
      ellipse(48, 44, 8, 8, { fill: GREEN, stroke: GREEN }),
      ellipse(78, 56, 8, 8, { fill: GREEN, stroke: GREEN }),
      ellipse(108, 24, 8, 8, { fill: GREEN, stroke: GREEN }),
    ],
  },
  {
    key: "chart.pie",
    name: "饼图",
    category: "chart",
    section: "统计图",
    skeletons: [
      ellipse(30, 14, 88, 88, { fill: GREEN_FILL, stroke: GREEN }),
      polyline(
        [
          [74, 58],
          [74, 14],
        ],
        { color: GREEN },
      ),
      polyline(
        [
          [74, 58],
          [120, 92],
        ],
        { color: GREEN },
      ),
      polyline(
        [
          [74, 58],
          [30, 58],
        ],
        { color: GREEN, dashed: true },
      ),
    ],
  },
  {
    key: "chart.donut",
    name: "环形图",
    category: "chart",
    section: "统计图",
    skeletons: [
      ellipse(28, 12, 92, 92, { fill: GREEN_FILL, stroke: GREEN }),
      ellipse(54, 38, 40, 40, { fill: WHITE, stroke: WHITE }),
      polyline(
        [
          [74, 58],
          [74, 12],
        ],
        { color: GREEN },
      ),
      polyline(
        [
          [74, 58],
          [110, 88],
        ],
        { color: GREEN },
      ),
    ],
  },
  {
    key: "chart.scatter",
    name: "散点图",
    category: "chart",
    section: "统计图",
    skeletons: [
      polyline(
        [
          [16, 8],
          [16, 92],
          [152, 92],
        ],
        { color: LINE },
      ),
      ellipse(38, 62, 9, 9, { fill: BLUE, stroke: BLUE }),
      ellipse(58, 44, 9, 9, { fill: BLUE, stroke: BLUE }),
      ellipse(76, 68, 9, 9, { fill: BLUE, stroke: BLUE }),
      ellipse(96, 32, 9, 9, { fill: BLUE, stroke: BLUE }),
      ellipse(118, 52, 9, 9, { fill: BLUE, stroke: BLUE }),
      ellipse(134, 24, 9, 9, { fill: BLUE, stroke: BLUE }),
    ],
  },
  {
    key: "chart.kpi",
    name: "KPI 卡片",
    category: "chart",
    section: "数据卡片",
    skeletons: [
      box(10, 10, 140, 84, { fill: WHITE, stroke: LINE, round: true }),
      text(24, 22, "本月新增", { size: 11, color: MUTED }),
      text(24, 42, "1,284", { size: 24 }),
      arrow(24, 76, 34, 0, { color: GREEN }),
      text(66, 68, "12%", { size: 11, color: "#285247" }),
    ],
  },
  {
    key: "chart.data-table",
    name: "数据表",
    category: "chart",
    section: "数据卡片",
    skeletons: [
      box(4, 12, 152, 80, { fill: WHITE, stroke: LINE, round: true }),
      box(4, 12, 152, 22, { fill: GREEN_FILL, stroke: GREEN_FILL }),
      text(14, 18, "项目", { size: 10, color: "#285247" }),
      text(94, 18, "数值", { size: 10, color: "#285247" }),
      polyline(
        [
          [4, 34],
          [156, 34],
        ],
        { color: LINE },
      ),
      polyline(
        [
          [4, 56],
          [156, 56],
        ],
        { color: LINE },
      ),
      polyline(
        [
          [86, 12],
          [86, 92],
        ],
        { color: LINE },
      ),
    ],
  },
  {
    key: "chart.gauge",
    name: "仪表盘",
    category: "chart",
    section: "数据卡片",
    skeletons: [
      ellipse(28, 22, 92, 92, { fill: PAPER, stroke: GREEN }),
      ellipse(48, 42, 52, 52, { fill: WHITE, stroke: WHITE }),
      polyline(
        [
          [74, 58],
          [104, 34],
        ],
        { color: RED, width: 2 },
      ),
      text(64, 70, "72%", { size: 12, color: MUTED }),
    ],
  },
];

/** 无名字的导入组件：优先取文案，其次按图形类型给一个可读名字。 */
export function describeLibraryItem(elements: unknown[]): string {
  for (const element of elements) {
    if (typeof element !== "object" || element === null) continue;
    const view = element as { type?: string; text?: string };
    if (view.type === "text" && typeof view.text === "string" && view.text.trim()) {
      return view.text.trim().slice(0, 12);
    }
  }
  const types = new Set(
    elements
      .map((element) =>
        typeof element === "object" && element !== null ? (element as { type?: string }).type : undefined,
      )
      .filter((type): type is string => Boolean(type)),
  );
  if (types.has("diamond")) return "判断";
  if (types.has("arrow") && types.size === 1) return "箭头";
  if (types.has("image")) return "图片";
  if (types.has("frame")) return "分组虚框";
  if (types.has("rectangle")) return types.size === 1 ? "矩形" : "组合图形";
  if (types.has("ellipse")) return types.size === 1 ? "椭圆" : "组合图形";
  if (types.has("line")) return types.size === 1 ? "线条" : "连接线";
  if (types.has("text")) return "文本";
  return "组合组件";
}
