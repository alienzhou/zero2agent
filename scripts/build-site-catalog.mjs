import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const site = fileURLToPath(new URL('../site/', import.meta.url));
const epics = [
  {id: 'epic01', number: 1, title: '能看，也能查', description: '跑通最小循环，再让 Agent 找到需要的代码。'},
  {id: 'epic02', number: 2, title: '能改，也能执行', description: '从只读走向行动：修改文件、执行命令、交接终端。'},
  {id: 'epic03', number: 3, title: '从循环到产品', description: '接上多轮对话、上下文压缩和执行权限。'},
];
const definitions = [
  ['epic01-story001', '最小 Agent 循环', '先跑通观察、思考与工具调用，理解 Agent Harness 的最小闭环。', 'E01-read-and-search/S001-react-basic'],
  ['epic01-story002', '内容搜索与上下文预算', '把 grep_search 接进循环，理解搜索结果、上下文预算与工程选型。', 'E01-read-and-search/S002-content-search'],
  ['epic01-story003', '文件查找与工程验证', '实现 find_files，通过 Benchmark 和分层 Debug 做出工程判断。', 'E01-read-and-search/S003-file-search'],
  ['epic01-story004', '组织 Prompt 与上下文', '把 System Prompt、用户输入和工具反馈放到各自合适的位置。', 'E01-read-and-search/S004-prompt-structure'],
  ['epic02-story001', '写文件与工具接口', '实现写入和删除，理解工具接口怎样影响模型的行动与观测。', 'E02-act-and-execute/S001-write-file'],
  ['epic02-story002', '精确修改文件', '用唯一匹配、明确回执和边界检查，让修改只落在该改的地方。', 'E02-act-and-execute/S002-replace-in-file'],
  ['epic02-story003', '执行命令与进程管理', '为终端执行设计返回值、超时、长输出和后台进程生命周期。', 'E02-act-and-execute/S003-terminal'],
  ['epic02-story004', '把终端交给人', '通过 PTY 接通人工操作，再把输入和执行状态交回 Agent。', 'E02-act-and-execute/S004-interactive-commands'],
  ['epic03-story001', '多轮会话与上下文压缩', '让 Agent 接着聊，并用请求预算、自动压缩与 /compact 控制上下文。', 'E03-product-foundations/S001-multi-turn'],
  ['epic03-story002', '执行权限与 Approval', '在执行之前接入三态权限判断，明确一次授权的对象、范围与有效期。', 'E03-product-foundations/S002-permissions'],
];
// Early graphic pages have no semantic heading. These titles also distinguish
// pages whose original mastheads repeat across several related diagrams.
const earlyTitles = {
  'epic01-story001': ['从零实现 Coding Agent', '这门课有什么不一样', '完整学习路线', '让 Agent 跑起核心循环', '先做一个只读闭环', '理解 ReAct 与 Tool Use', '选择你的学习深度', '源码与下一步'],
  'epic01-story002': ['给 Agent 接上内容搜索', '为什么只有 read_file 不够', '怎样设计 Agent 工具', '搜索里的上下文预算', 'Grep 的技术选型', '从搜索工具看产品设计', '主流 Coding Agent 的搜索方案', 'Grep 与 Codebase RAG', 'Cursor Grep：Trigram 的限制', 'Cursor Grep：Sparse N-grams', 'Cursor Grep：绝对本地化', '用架构隔离搜索污染', 'SWE-Grep 与专职搜索模型', '用 AST 检索代码', 'AST Grep 的使用示例', '三个开放的工程问题', '源码与下一步'],
  'epic01-story003': ['让 Agent 找到文件', '能搜内容，还要找到文件', '实现 find_files', '用证据做技术选型', '怎样设计 Benchmark', '理解 Benchmark 数据', '从数据得出选型结论', '建立分层 Debug 视角', '定位一次 Agent 故障', '组织调试架构', '把 Debug 方法用起来', '源码与下一步'],
  'epic01-story004': ['把 Prompt 组织起来', '框架与上下文，两条线一起看', '2023–2024：从一段到分层', '2025–2026：上下文的演进', 'System 与 User 的职责', 'Message List 的完整结构', 'System Prompt 的五个部分', 'User Prompt 的两层包装', '各种上下文放在哪里', '工具反馈怎样进入对话', '缓存与每轮刷新', '对应 Zero2Agent 的实现', '源码与下一步'],
  'epic02-story001': ['让 Agent 能写也能删', '跨过只读边界', '写入与删除两个工具', '接口就是行动语言', '工具粒度怎样影响模型', '写入格式与成功率', '回执是模型的观测窗口', '源码与跟练'],
  'epic02-story003': ['让 Agent 执行命令', '回顾已有工具', '为什么还需要 terminal', '怎样面对外部程序的不确定性', '执行工具的五个问题', '用文字回执描述执行结果', '五种可能的执行状态', '长输出怎样处理', '超时、终止与转后台', '保持一致的 Shell 环境', '管理后台进程的生命周期', '回顾终端工具的设计', '源码与下一步'],
};
function decodeEntities(text) {
  return text.replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#([0-9]+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, name) => ({amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '}[name]));
}
function paragraphsFromHTML(html) {
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || html;
  const text = body.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(style|script|defs)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\b[^>]*>/gi, '\n')
    .replace(/<\/(?:div|p|h[1-6]|li|pre|section|article|text|header|footer|tr|figcaption)>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(text).split('\n').map(line => line.replace(/[ \t]+/g, ' ').trim()).filter(Boolean);
}
const chapters = [];
for (const [index, [id, title, description, sourcePath]] of definitions.entries()) {
  const directory = path.join(site, 'chapters', id);
  const manifest = await readFile(path.join(directory, 'pages.json'), 'utf8').then(JSON.parse).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  const files = manifest ? manifest.pages.map(page => page.file) : (await readdir(directory)).filter(file => /^\d{2}-.*\.html$/.test(file)).sort();
  const pages = [];
  for (const [pageIndex, file] of files.entries()) {
    if (!/^\d{2}-[\w-]+\.html$/.test(file)) throw new Error('Invalid page filename: ' + file);
    const html = await readFile(path.join(directory, file), 'utf8');
    const paragraphs = paragraphsFromHTML(html);
    const heading = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
    const pageTitle = manifest?.pages[pageIndex].title || earlyTitles[id]?.[pageIndex] || (heading ? decodeEntities(heading.replace(/<[^>]*>/g, '')) : paragraphs[2]);
    if (!pageTitle || !paragraphs.length) throw new Error('Missing readable content: ' + id + '/' + file);
    pages.push({id: file.slice(0, -5), file, number: pageIndex + 1, title: pageTitle, paragraphs});
  }
  const [, epicNumber, storyNumber] = id.match(/^epic(\d+)-story(\d+)$/);
  chapters.push({
    id, number: index + 1, epic: 'epic' + epicNumber, title, description,
    code: 'E' + epicNumber + '-S' + storyNumber,
    sourceURL: 'https://github.com/alienzhou/zero2agent/tree/' + (id === 'epic03-story002' ? 'codex/e03-s002-permissions' : 'main') + '/specs/' + sourcePath,
    pages,
  });
}
const data = {title: 'Zero2Agent', epics, chapters, totalPages: chapters.reduce((sum, chapter) => sum + chapter.pages.length, 0)};
await writeFile(path.join(site, 'course.json'), JSON.stringify(data, null, 2) + '\n');
console.log('Course catalog: ' + chapters.length + ' chapters, ' + data.totalPages + ' diagrams.');
