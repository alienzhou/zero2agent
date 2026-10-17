// Editable E05-S001 diagrams. Facts are traceable through sources.md.
// Every page chooses a visual form for its teaching task; no generic card stack.
const fs = require('node:fs');
const C = {ink:'#202622',paper:'#F4F1EA',muted:'#596057',line:'#C9CDC2',white:'#FFFEF9',soft:'#E7EADF',green:'#28614D',greenBg:'#E0EBDF',red:'#B53830',redBg:'#F2DED7',amber:'#896016',amberBg:'#F0E5C9'};
const esc = s => String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const t = (x,y,s,size=32,color=C.ink,weight=400,anchor='start',mono=false) => `<text x="${x}" y="${y}" fill="${color}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" ${mono?'class="mono"':''}>${esc(s)}</text>`;
const ls = (x,y,ss,size=30,color=C.ink,gap=48) => ss.map((s,i)=>t(x,y+i*gap,s,size,color)).join('');
const rect = (x,y,w,h,fill=C.white,stroke='none',radius=0) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
const path = (d,tone='ink',arrow=false,dash=false) => `<path d="${d}" fill="none" stroke="${C[tone]}" stroke-width="3" stroke-linecap="round" ${arrow?`marker-end="url(#${tone})"`:''} ${dash?'stroke-dasharray="9 8"':''}/>`;
const dot = (x,y,r=7,tone='ink') => `<circle cx="${x}" cy="${y}" r="${r}" fill="${C[tone]}"/>`;
const rule = (y,x=0,w=952) => path(`M${x} ${y}h${w}`,'line');
const tag = (x,y,w,s,tone='ink') => rect(x,y,w,48,C[tone+'Bg']||C.soft)+t(x+15,y+33,s,26,C[tone],650);
const consoleBox = (x,y,w,h,title,rows,size=29) => rect(x,y,w,h,C.ink,'none',10)+t(x+24,y+43,title,25,'#AEBFAF',500)+path(`M${x+24} ${y+62}h${w-48}`,'muted')+rows.map((s,i)=>t(x+24,y+108+i*49,s,size,C.paper,400,'start',true)).join('');
const file = (x,y,w,h,title,rows,tone='green') => `<path d="M${x} ${y}h${w-44}l44 44v${h-44}h-${w}Z" fill="${C.white}" stroke="${C[tone]}" stroke-width="3"/><path d="M${x+w-44} ${y}v44h44" fill="none" stroke="${C[tone]}" stroke-width="2"/>`+t(x+22,y+87,title,30,C[tone],700)+ls(x+22,y+149,rows,29,C.ink,45);
const svg = (label,body,h=680) => `<svg class="diagram" viewBox="0 0 952 ${h}" width="952" height="${h}" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title><defs>${['ink','green','red','amber'].map(k=>`<marker id="${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="${C[k]}"/></marker>`).join('')}</defs>${body}</svg>`;
const pages=[];
const page=(slug,section,title,deck,body,note,sources,layout='')=>pages.push({file:`${String(pages.length+1).padStart(2,'0')}-${slug}.html`,section,title,deck,body,note,sources,layout});

page('cover','项目指令与 AGENTS.md','先读项目约定，\n再修改目标文件','E05-S001 · 让目录规则进入真正的执行过程。',svg('根规则与两个子目录规则的树形关系',
file(251,0,450,200,'AGENTS.md',['修复必须补测试'],'ink')+
path('M476 224V302H226V360','green',true)+path('M476 302H726V360','amber',true)+
file(0,390,450,230,'api / AGENTS.md',['运行 API 测试','只作用于 api 子树'],'green')+file(502,390,450,230,'web / AGENTS.md',['运行浏览器测试','只作用于 web 子树'],'amber')),
'普通 Markdown，明确的目录范围。规则告诉模型如何工作；工具权限仍由宿主决定。',['O01','S01']);
page('standard','01 · 使用开放格式','稳定约定写进文件，\n本次任务留在对话里','AGENTS.md 是普通 Markdown，没有必填字段。',svg('普通Markdown文件的示例与开放格式说明',
consoleBox(0,0,952,325,'AGENTS.md · 普通文本示例',['# 开发约定','','修复行为时补回归测试。','提交前运行 pnpm test。'],29)+
rule(394)+t(0,463,'格式约定：文件名、正文、嵌套优先语义',33,C.green,700)+t(0,542,'产品选择：发现根、读取权限、容量和刷新',32)+t(0,621,'链接是参考，不会自动展开或执行。',31,C.muted)),
'不用为每次修复重发同一段要求。沿用 agents.md 开放格式；发现范围、权限和容量属于本产品实现，不是私有 Markdown 字段。',['O01','D01']);
page('scope','02 · 看懂目录作用域','api 的规则，\n不能用到旁边的 web','只沿目标祖先链查找，兄弟目录不串用。',svg('根规则继承到两棵子树；兄弟目录互不覆盖',
t(0,42,'project / ← 规则发现根',36,C.ink,700)+path('M35 75V580','line')+
path('M35 130H91','ink')+t(115,143,'AGENTS.md',34)+tag(500,105,400,'全项目：修复要补测试','ink')+
path('M35 270H91','green')+t(115,283,'packages / api /',34,C.green,700)+
path('M150 315V407H205','green')+t(230,420,'AGENTS.md → API 测试命令',31,C.green)+
path('M35 510H91','amber')+t(115,523,'packages / web /',34,C.amber,700)+
path('M150 555V625H205','amber')+t(230,638,'AGENTS.md → 浏览器测试命令',31,C.amber)),
'默认发现根是启动 cwd；从子目录启动可用 --instructions-root 指定根。更近的规则只覆盖相应目录的冲突约定，根规则的其余要求继续适用。',['O01','S01']);
page('priority','03 · 谁可以覆盖谁','用户明确要求优先，\n项目文本不能授予权限','约定由模型理解，权限由宿主代码执行。',svg('用户要求与两层项目规则的优先顺序及独立权限检查',
rect(0,0,952,101,C.redBg)+t(24,63,'宿主硬边界与审批：任何项目文本都不能绕过',31,C.red,700)+
[['明确用户要求','例如：本次使用指定输出格式'],['目标目录的 AGENTS.md','仅覆盖本目录的冲突约定'],['祖先目录的 AGENTS.md','其余约定继续适用']].map(([a,b],i)=>rect(70+i*36,158+i*159,812-i*72,125,C.white,C.line)+t(95+i*36,207+i*159,a,33,C.ink,700)+t(95+i*36,252+i*159,b,27,C.muted)).join('')),
'自动读取 AGENTS.md 也要经过当前 read_file 权限。文件要求“忽略审批”不构成授权；必要规则被拒绝或读不到时，受影响批次停止。',['O01','S01','T01']);
page('request','04 · 请求与历史分开','规则进入当前请求，\n不反复追加进对话历史','项目原文放在用户级上下文；系统只放固定说明。',svg('当前请求的三个组成部分及与历史的分离',
rect(0,0,952,66,C.ink)+t(22,45,'发给模型的一次完整请求',32,C.paper,700)+
[['固定系统说明','项目规则不等于权限；明确用户要求优先'],['当前项目上下文','来源 / scope / SHA-256 / Markdown 原文'],['历史与当前任务','保留真实调用结果，沿用既有压缩机制']].map(([a,b],i)=>t(24,144+i*158,a,35,i===1?C.green:C.ink,700)+t(24,198+i*158,b,29,C.muted)+rule(234+i*158)).join('')+
t(0,653,'完整覆盖层计入 ContextBudget，超限明确失败。',30,C.red,650)),
'规则原文不反复写入历史。恢复会话时重新读取当前文件，摘要里的旧规则不能覆盖新版本；旧审批也不继承。没有规则的新会话不增加额外开销。',['S01','S02']);
page('replan','05 · 先补规则，再执行','模型第一次写 api，\n可能还没见过 api 的约定','整批先停下，配齐未执行结果，再重新规划。',svg('初次调用、规则发现、未执行回执、重规划、写入的纵向流程',
path('M40 38V622','ink',true)+[['模型提出一批工具','根目录上下文里还没有 api 规则'],['批次预检发现新规则','全部目标一起检查，尚无文件效果'],['整批返回“未执行”','每个调用都有匹配结果'],['下一请求带上 api 规则','模型重新提出适合当前规则的调用'],['当前权限与版本仍有效','此时才进入实际工具执行']].map(([a,b],i)=>dot(40,65+i*121,9,i===2?'red':'green')+t(89,65+i*121,a,33,C.ink,700)+t(89,109+i*121,b,28,C.muted)).join('')),
'根、api、web 的目标先统一预检，出现新规则时整批均未执行。路径来自可信工具声明；terminal 按 workdir 查找，不猜测任意 shell 的全部影响。',['S02','T01']);
page('changed','06 · 等待审批期间也可能变化','批准以后，\n还要再确认规则版本','批中改变规则时，已完成效果与未执行结果并存。',svg('写规则后停止后续工具，以及审批期间规则变化的场景',
consoleBox(0,0,952,232,'场景 A · 等待一次写入审批',['模型基于版本 A 提出写入','用户等待期间：规则变成 B','批准后重验：这次工具不执行'],29)+
rule(300)+t(0,371,'场景 B · 同批第一项修改 AGENTS.md',33,C.ink,700)+
file(0,412,450,205,'工具 1',['真实写入已经发生'],'green')+file(502,412,450,205,'工具 2',['版本变了，尚未执行'],'red')),
'保留真实回执，停止剩余调用，不重放第一项。检查降低应用层竞态风险，但不宣称提供 OS 沙箱或消除所有恶意并发替换。',['S02','T01','D01']);
page('controls','07 · 在终端里核对来源','看规则、刷新、关闭，\n都不需要问模型','复用 CLI、plain 和 TUI 的输入所有权。',svg('指令查看与刷新控制入口',
consoleBox(0,0,952,245,'无需 API key 的单次查看',['node <cli-entry> --instructions','--instructions-root <project-dir>','--no-instructions'],29)+
consoleBox(0,293,952,281,'plain / TUI',['/instructions','/instructions refresh','/instructions off   /instructions on'],31)+
t(0,651,'展示来源、scope、完整 SHA-256 和加载错误。',30,C.muted)),
'界面分别显示“最近读取”和“上次请求使用”的哈希。refresh 只重读磁盘，模型到下次请求才看到变化；具体调用和目录示例见跟练。',['S03','T02']);
page('practice','08 · 完成一个小修复','金额函数、回归测试，\n再加一份可校验报告','默认跟练只访问本机确定性服务。',svg('金额修复的三个实际产物与离线命令',
[['amount.ts','2.75 × 3 → 825 分'],['amount.test.ts','小数价格 + 零数量回归'],['change-report.json','通过结构校验的修复报告']].map(([a,b],i)=>t(0,64+i*139,a,33,C.ink,700)+t(0,114+i*139,b,29,C.green)+rule(133+i*139)).join('')+
consoleBox(0,459,952,187,'仓库根目录',['pnpm build','node researches/project-instructions/demo.mjs'],26)),
'观察第一次 api 调用如何被整批拦住，再检查实际文件、测试进程与请求正文。原始证据写入 tmp/e05-s001，不进入 Git 历史。',['T03','D01']);
page('verify','09 · 分层证明行为','检查真实请求和文件，\n确认规则先于修改','跟练的完成标准：范围正确，时机正确，拒绝有效。',svg('跟练后核对范围、执行顺序、修复效果和拒绝结果',
[['规则范围','重规划后有 root + api，始终无 web 规则'],['执行顺序','新规则先进入请求，原批次明确未执行'],['修复结果','检查文件与真实测试，不只相信 JSON 报告'],['拒绝结果','越界写入被拒绝，目标文件确实不存在']].map(([a,b],i)=>t(0,54+i*157,a,34,C.ink,700)+t(0,111+i*157,b,30,i===3?C.red:C.green)+rule(145+i*157)).join('')),
'容量边界、完整故障矩阵与证据下载见验收清单。完成跟练后再学 S002 的 Skills 按需加载；小样本通过不代表模型能遵守任意自然语言约定。',['T01','T02','T03']);
// The platform limit is a ceiling, never an editorial page-count target.
if(pages.length<2 || pages.length>18) throw new Error('Course needs a cover and content, at most 18 pages');
// Remove only generated pages from this chapter's previous manifest.
if(fs.existsSync('pages.json')) {
 const previous=JSON.parse(fs.readFileSync('pages.json','utf8'));
 const current=new Set(pages.map(p=>p.file));
 for(const entry of previous.pages ?? []) {
  if(/^\d{2}-[a-z0-9-]+\.html$/.test(entry.file) && !current.has(entry.file)) fs.rmSync(entry.file,{force:true});
 }
}
for(const [i,p] of pages.entries()) {
 const number=String(i+1).padStart(2,'0');
 const header=`<header class="page-header"><span>Zero2Agent · ${esc(p.section)}</span><span class="page-number">${number}</span></header>`;
 const heading=`<div class="heading" data-block><h1>${esc(p.title).replaceAll('\n','<br>')}</h1><p class="deck" data-prose>${esc(p.deck)}</p></div>`;
 const content=`<div class="content">${p.body}<p class="explain" data-block data-prose>${esc(p.note)}</p></div>`;
 const cover=`<div class="cover-frame"><header class="page-header"><span>Zero2Agent · 扩展能力</span><span class="page-number">E05-S001</span></header><div class="series-masthead" data-block><h1 class="series-title">从零到一做 <span>Agent</span></h1><p class="series-description" data-prose>亲手实现 Coding Agent · 开源实战课程</p><h2 class="lesson-title">项目指令与 AGENTS.md</h2><p class="lesson-promise" data-prose>先读项目约定，再修改目标文件。</p></div><div class="series-body">${p.body}<p class="explain" data-block data-prose>${esc(p.note)}</p></div><div class="cover-tags"><span>目录作用域</span><span>执行前检查</span><span>开源课程</span></div></div>`;
 fs.writeFileSync(p.file,`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=1080"><title>${esc(p.title.replaceAll('\n',''))}</title><link rel="stylesheet" href="course.css"></head><body><main class="sheet ${i===0?'cover series-cover':''}" data-page="${number}">${i===0?cover:header+heading+content}</main></body></html>\n`);
}
fs.writeFileSync('pages.json',JSON.stringify({title:'Zero2Agent · E05-S001 项目指令与 AGENTS.md',date:'2026-10-17',draft:true,publicationStatus:'unpublished',width:1080,height:1440,maxImages:18,edition:'project-instructions-concise-review',pages:pages.map((p,i)=>({file:p.file,title:p.title.replaceAll('\n',''),number:i+1,sources:p.sources}))},null,2)+'\n');
