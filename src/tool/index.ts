// 工具声明：笔记知识星图（自定义界面）。
import { Orbit } from 'lucide-react';
import { createElement } from 'react';
import type { CustomTool } from '../kit/types';
import { Main } from './Main';

const tool: CustomTool = {
  id: 'o28',
  name: '笔记知识星图',
  tagline: '选一个 md / txt 笔记文件夹，在本机解析出主题、知识点和它们的连接，画成能搜索、能筛选、能点开看出处的知识星空图，可导出 PNG。',
  icon: Orbit,
  category: '办公提效',
  type: 'data',
  mode: 'custom',
  mainLabel: '知识星图',
  needsLLM: true,
  params: [],
  Main: ({ ctx }) => createElement(Main, { ctx }),
};

export default tool;
