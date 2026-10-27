// 星图的数据结构：笔记解析结果、节点、连接。

export interface ParsedLink {
  /** 双链指向的笔记名（已去掉路径、.md、别名） */
  target: string;
  /** 双链里 # 后面的标题（没有则为空） */
  heading: string;
  line: number;
}

export interface Section {
  /** 在笔记里的序号，0 起；不含「开头部分」 */
  index: number;
  level: number;
  heading: string;
  /** 上级标题序号，-1 表示直接挂在笔记下 */
  parent: number;
  line: number;
  /** 正文（已去掉代码块与格式符号） */
  text: string;
  tags: string[];
  links: ParsedLink[];
}

export interface ParsedNote {
  /** 相对所选文件夹的路径，用 / 分隔 */
  path: string;
  /** 文件名（不含扩展名） */
  name: string;
  /** 第一级文件夹名，没有则为空 */
  folder: string;
  title: string;
  /** 笔记级标签：front matter 与开头部分里的标签 */
  tags: string[];
  /** 开头部分（第一个标题之前，加上第一个一级标题之后到下个标题之前）的正文 */
  intro: string;
  introLinks: ParsedLink[];
  sections: Section[];
  chars: number;
}

export type NodeKind = 'theme' | 'point' | 'tag';
export type LinkType = 'hierarchy' | 'wikilink' | 'tag' | 'keyword' | 'topic';

export interface Source {
  /** 相对路径 */
  file: string;
  line: number;
  snippet: string;
  /** 本机完整路径，示例数据没有 */
  abs?: string;
}

export interface GNode {
  id: string;
  kind: NodeKind;
  label: string;
  /** 颜色分组：第一级文件夹名；标签用「标签」 */
  group: string;
  weight: number;
  summary: string;
  keywords: string[];
  sources: Source[];
  /** 由大模型提炼出来的主题 */
  ai?: boolean;
  /** 搜索用的小写文本 */
  search: string;
}

export interface GLink {
  source: string;
  target: string;
  type: LinkType;
  weight: number;
  /** 连接原因，例如共同关键词 */
  reason?: string;
}

export interface GraphStats {
  files: number;
  chars: number;
  nodes: number;
  links: number;
  unresolved: number;
  byType: Record<LinkType, number>;
}

export interface Graph {
  nodes: GNode[];
  links: GLink[];
  stats: GraphStats;
}

export const KIND_NAME: Record<NodeKind, string> = { theme: '主题', point: '知识点', tag: '标签' };
export const LINK_NAME: Record<LinkType, string> = { hierarchy: '标题层级', wikilink: '双链', tag: '标签', keyword: '共同关键词', topic: 'AI 主题' };
