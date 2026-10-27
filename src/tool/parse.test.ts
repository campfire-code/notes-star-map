import { describe, expect, it } from 'vitest';
import { cleanLine, extractKeywords, fallbackTokenizer, normName, parseNote, terms } from './parse';

describe('parseNote', () => {
  const md = `---
title: 前言标题
tags: [甲, 乙]
---
# 总标题
开头一句 #行内标签 和 [[别的笔记|别名]]。

## 一级
正文 A [[笔记二#小节]]

\`\`\`
# 代码里的井号 #不是标签 [[不是链接]]
\`\`\`

### 二级
正文 B #深层
## 第二个一级
`;
  const n = parseNote('文件夹/笔记一.md', md);
  it('标题、文件夹与名字', () => {
    expect(n.title).toBe('总标题');
    expect(n.folder).toBe('文件夹');
    expect(n.name).toBe('笔记一');
  });
  it('标题层级：parent 指向上级，一级的 parent 为 -1', () => {
    expect(n.sections.map((s) => [s.heading, s.level, s.parent])).toEqual([['一级', 2, -1], ['二级', 3, 0], ['第二个一级', 2, -1]]);
    expect(n.sections[1].line).toBe(15);
  });
  it('标签：front matter + 开头 + 段落，代码块里的不算', () => {
    expect(n.tags).toEqual(['甲', '乙', '行内标签']);
    expect(n.sections[1].tags).toEqual(['深层']);
  });
  it('双链：别名、#标题；代码块里的不算', () => {
    expect(n.introLinks).toEqual([{ target: '别的笔记', heading: '', line: 6 }]);
    expect(n.sections[0].links).toEqual([{ target: '笔记二', heading: '小节', line: 9 }]);
  });
  it('正文清理格式符号、不含标签与代码', () => {
    expect(n.sections[0].text).toBe('正文 A 笔记二');
    expect(n.intro).toContain('开头一句');
    expect(n.intro).not.toContain('#行内标签');
  });
  it('没有一级标题时用 front matter 标题，再没有用文件名；txt 不拆标题', () => {
    expect(parseNote('a.md', '---\ntitle: T\n---\n## x\ny').title).toBe('T');
    expect(parseNote('b.md', '## x\ny').title).toBe('b');
    const t = parseNote('c.txt', '# 不是标题\n正文');
    expect(t.sections).toHaveLength(0);
    expect(t.intro).toContain('# 不是标题'.replace('# ', '').slice(0, 2));
  });
  it('front matter 的块列表标签；CRLF；BOM', () => {
    const r = parseNote('d.md', '﻿---\r\ntags:\r\n  - 一\r\n  - 二\r\n---\r\n# T\r\n正文');
    expect(r.tags).toEqual(['一', '二']);
    expect(r.title).toBe('T');
  });
  it('纯数字不算标签，URL 里的 # 不算', () => {
    const r = parseNote('e.md', '第 #1 名 https://x.com/a#frag #真标签');
    expect(r.tags).toEqual(['真标签']);
  });
  it('空文件不报错', () => {
    expect(parseNote('f.md', '').sections).toEqual([]);
  });
});

describe('小工具', () => {
  it('normName 去路径、扩展名、大小写', () => {
    expect(normName(' 文件夹/Note.MD ')).toBe('note');
  });
  it('cleanLine 去掉链接与强调符号', () => {
    expect(cleanLine('- **粗** [链接](http://a.b) [[笔记|别名]] `code`')).toBe('粗 链接 别名');
  });
});

describe('关键词', () => {
  it('回退分词：中文二字组 + 英文单词', () => {
    expect(fallbackTokenizer('咖啡豆 latte')).toEqual(['咖啡', '啡豆', 'latte']);
  });
  it('terms 过滤停用词、短词、纯数字', () => {
    expect(terms('我们 的 咖啡 a 123 latte', fallbackTokenizer)).toEqual(['咖啡', 'latte']);
  });
  it('只在个别文档出现的词排前，太泛的词丢掉', () => {
    const docs = Array.from({ length: 8 }, (_, i) => ({ id: `d${i}`, heading: '', body: `咖啡 通用 ${i < 2 ? '烘焙 烘焙' : ''}${i === 0 ? ' 孤词' : ''}` }));
    const { keywords } = extractKeywords(docs, 3, (t) => t.split(/\s+/));
    expect(keywords.get('d0')).toEqual(['烘焙']);
    expect(keywords.get('d2')).toEqual([]);
  });
  it('标题里的词权重更高', () => {
    const { keywords } = extractKeywords([{ id: 'a', heading: '定价', body: '采购 采购' }, { id: 'b', heading: '', body: 'xyz' }], 1, (t) => t.split(/\s+/));
    expect(keywords.get('a')).toEqual(['定价']);
  });
});
