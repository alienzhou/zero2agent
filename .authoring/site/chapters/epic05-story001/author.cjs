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
page('problem','01 · 为什么需要项目规则','每次修 Bug，\n都要重复同一段要求','共同约定写进文件，当前任务留在对话中。',svg('重复聊天指令与可复用项目文件的对照',
consoleBox(0,0,952,260,'每次重新解释',['“修复金额计算，还要加测试……”','“下次修改，也记得跑 API 测试……”','“web 的测试命令又不一样……”'],29)+
path('M476 290V356','green',true)+file(0,389,460,241,'项目约定',['AGENTS.md','稳定的开发习惯'],'green')+file(506,389,446,241,'本次任务',['修复 totalCents','用户这次要什么'],'ink')),
'项目规则与任务分别维护。用户明确改变本次要求时，项目文件不能反过来覆盖用户。',['O01','D01']);
page('standard','02 · 使用开放格式','AGENTS.md 是 Markdown，\n无需自创一套配置格式','没有必填字段，也没有必需的 frontmatter。',svg('普通Markdown文件的示例与开放格式说明',
consoleBox(0,0,952,325,'AGENTS.md · 普通文本示例',['# API 开发约定','','改动行为时补回归测试。','测试命令写在下方，标题可自行组织。'],29)+
rule(394)+t(0,463,'格式约定：文件名、正文、嵌套优先语义',33,C.green,700)+t(0,542,'产品选择：发现根、读取权限、容量和刷新',32)+t(0,621,'链接是参考，不会自动展开或执行。',31,C.muted)),
'依据 agents.md 官方说明及固定源码版本。Zero2Agent 的边界与容量在 Spec 单独列出，不冒充开放格式的必选字段。',['O01','D01']);
page('scope','03 · 看懂目录作用域','api 的规则，\n不能用到旁边的 web','每份正文都带来源路径与适用目录。',svg('根规则继承到两棵子树；兄弟目录互不覆盖',
t(0,42,'project /',36,C.ink,700)+path('M35 75V580','line')+
path('M35 130H91','ink')+t(115,143,'AGENTS.md',34)+tag(500,105,400,'全项目：修复要补测试','ink')+
path('M35 270H91','green')+t(115,283,'packages / api /',34,C.green,700)+
path('M150 315V407H205','green')+t(230,420,'AGENTS.md → API 测试命令',31,C.green)+
path('M35 510H91','amber')+t(115,523,'packages / web /',34,C.amber,700)+
path('M150 555V625H205','amber')+t(230,638,'AGENTS.md → 浏览器测试命令',31,C.amber)),
'靠近目标文件的规则，只覆盖本目录下冲突的项目约定。根目录的其他要求仍然保留；自然语言冲突由模型理解。',['O01','S01']);
page('discovery','04 · 只沿祖先链查找','先确定发现根，\n再沿目标路径逐层查找','默认根是启动 cwd；跨出它不会自动向上寻找。',svg('从项目根到启动目录、目标目录的两条祖先链',
rect(0,0,952,106,C.ink)+t(24,65,'显式发现根 project/',35,C.paper,700)+
path('M476 135V211H228V276','green',true)+path('M476 211H724V276','amber',true)+
file(0,310,452,245,'启动 cwd',['root → packages → api','启动时读取这条链'],'green')+file(500,310,452,245,'目标路径',['root → packages → web','调用前补读这条链'],'amber')+
t(0,648,'不会递归扫描整个仓库，也不自动读用户目录。',30,C.muted)),
'从子目录启动，可用 --instructions-root 指定包含 cwd 的根。它改变规则搜索范围，不扩大文件工具原有的写入边界。',['S01','S03']);
page('priority','05 · 谁可以覆盖谁','用户明确要求优先，\n项目文本不能授予权限','约定由模型理解，权限由宿主代码执行。',svg('用户要求与两层项目规则的优先顺序及独立权限检查',
rect(0,0,952,101,C.redBg)+t(24,63,'宿主硬边界与审批：任何项目文本都不能绕过',31,C.red,700)+
[['明确用户要求','例如：本次使用指定输出格式'],['目标目录的 AGENTS.md','仅覆盖本目录的冲突约定'],['祖先目录的 AGENTS.md','其余约定继续适用']].map(([a,b],i)=>rect(70+i*36,158+i*159,812-i*72,125,C.white,C.line)+t(95+i*36,207+i*159,a,33,C.ink,700)+t(95+i*36,252+i*159,b,27,C.muted)).join('')),
'不实现一个通用的自然语言冲突裁判。确定性验收检查实际请求的优先说明、来源和作用域；越界与拒绝通过真实工具效果验证。',['O01','S01','T01']);
page('request','06 · 请求与历史分开','规则进入当前请求，\n不反复追加进对话历史','项目原文放在用户级上下文；系统只放固定说明。',svg('当前请求的三个组成部分及与历史的分离',
rect(0,0,952,66,C.ink)+t(22,45,'发给模型的一次完整请求',32,C.paper,700)+
[['固定系统说明','项目规则不等于权限；明确用户要求优先'],['当前项目上下文','来源 / scope / SHA-256 / Markdown 原文'],['历史与当前任务','保留真实调用结果，沿用既有压缩机制']].map(([a,b],i)=>t(24,144+i*158,a,35,i===1?C.green:C.ink,700)+t(24,198+i*158,b,29,C.muted)+rule(234+i*158)).join('')+
t(0,653,'完整覆盖层计入 ContextBudget，超限明确失败。',30,C.red,650)),
'createCompactionRuntime 的 request 调用 overlay() 构建覆盖层。原文不写入历史；没有规则的新会话保持原有请求开销。',['S01','S02']);
page('replan','07 · 先补规则，再执行','模型第一次写 api，\n可能还没见过 api 的约定','整批先停下，配齐未执行结果，再重新规划。',svg('初次调用、规则发现、未执行回执、重规划、写入的纵向流程',
path('M40 38V622','ink',true)+[['模型提出一批工具','根目录上下文里还没有 api 规则'],['批次预检发现新规则','全部目标一起检查，尚无文件效果'],['整批返回“未执行”','每个调用都有匹配结果'],['下一请求带上 api 规则','模型重新提出适合当前规则的调用'],['当前权限与版本仍有效','此时才进入实际工具执行']].map(([a,b],i)=>dot(40,65+i*121,9,i===2?'red':'green')+t(89,65+i*121,a,33,C.ink,700)+t(89,109+i*121,b,28,C.muted)).join('')),
'runTurnLoop 先调用 prepareBatch() 和 requiresReplan()。规则重规划每轮最多 3 次，消耗原预算；卸载无关目录不计入变化。',['S02','T01']);
page('batch','08 · 一次看完整个批次','别让第一项先写了，\n第二项才发现新约定','跨目录调用先统一计算可确定的路径。',svg('三个批次目标先汇入预检，之后统一执行或不执行',
[['root.txt','根规则'],['api / amount.ts','根 + api'],['web / index.ts','根 + web']].map(([a,b],i)=>rect(i*326,0,300,160,C.white,C.line)+t(i*326+16,61,a,27,C.ink,700)+t(i*326+16,120,b,29,C.green)).join('')+
path('M150 187V265H476','ink')+path('M476 187V310','ink',true)+path('M802 187V265H476','ink')+
rect(0,345,952,122,C.soft)+t(25,421,'所有已声明目标 → 同一次规则预检',36,C.ink,700)+
t(0,543,'版本未变化 → 按当前权限逐项执行',33,C.green,700)+t(0,621,'出现新规则 → 整批未执行，重新规划',33,C.red,700)),
'路径来自受信任工具元数据。terminal 只按 workdir 查找；不从任意 shell 命令猜测全部读写路径，也不承诺它受文件规则强制隔离。',['S01','S02','T01']);
page('reading','09 · 读规则也要授权','发现了文件，\n不代表可以读取正文','复用 read_file 的当前权限，不另开读取后门。',svg('文件缺失、授权、读取失败的分支流程',
rect(262,0,428,92,C.white,C.line)+t(476,59,'AGENTS.md 存在吗？',33,C.ink,700,'middle')+
path('M262 46H111V202','amber',true)+t(10,261,'缺失：无规则',31,C.amber,700)+
path('M476 121V202','green',true)+rect(340,230,612,100,C.greenBg)+t(365,292,'当前读取权限 + 物理路径边界',30,C.green,700)+
path('M646 358V425','green',true)+rect(340,455,612,100,C.white,C.line)+t(365,518,'读取完整正文，计算内容哈希',30,C.ink,700)+
t(0,630,'拒绝、不可读、超限 → 明确失败，阻止受影响批次',29,C.red,700)),
'refresh() 先区分缺失，再由 PermissionController 授权。外部符号链接、非普通文件和非法 UTF-8 都报错，不截断正文继续。',['S01','T01']);
page('versions','10 · 当前文件不等于已发送版本','刷新了规则，\n模型要到下次请求才看见','界面分开展示“最近读取”与“上次请求使用”。',svg('两种版本记录随刷新与新请求推进',
[['时间','最近读取','上次请求'],['请求 A 后','hash A','hash A'],['文件改成 B','hash A','hash A'],['执行 refresh','hash B','hash A'],['发出请求 B','hash B','hash B']].map(([a,b,c],i)=>rect(0,i*116,952,96,i===0?C.ink:i===3?C.amberBg:C.white)+t(22,61+i*116,a,30,i===0?C.paper:C.ink,650)+t(379,61+i*116,b,30,i===0?C.paper:C.green,650)+t(692,61+i*116,c,30,i===0?C.paper:C.muted,650)).join('')+
t(0,665,'正文版本用 SHA-256 标识，不把修改时间当作内容。',29,C.muted)),
'view() 读取缓存，refresh() 重读磁盘；markRequested() 只在模型传输开始时更新。查看和刷新都不会改写历史或发送模型请求。',['S01','S03','T02']);
page('limits','11 · 容量是产品选择','完整加载，\n或者明确说明为什么停下','不以静默截断换取表面成功。',svg('单文件、总正文、深度、候选数四个容量门槛',
[['单份正文','32 KiB',0.25],['当前正文合计','128 KiB',1],['祖先目录链','32 层',0.5],['候选文件路径','64 个',1]].map(([a,b,f],i)=>t(0,44+i*158,a,31,C.ink,700)+t(952,44+i*158,b,34,C.red,700,'end')+rect(0,80+i*158,952,26,C.soft)+rect(0,80+i*158,952*f,26,C.green)).join('')),
'这些数值属于 Zero2Agent，不是 AGENTS.md 格式要求。刷新含审批最多 5 秒，规则重规划最多 3 次；阈值附近由独立测试验证。',['S01','D01','T01']);
page('changed','12 · 等待审批期间也可能变化','批准以后，\n还要再确认规则版本','批中改变规则时，已完成效果与未执行结果并存。',svg('写规则后停止后续工具，以及审批期间规则变化的场景',
consoleBox(0,0,952,232,'场景 A · 等待一次写入审批',['模型基于版本 A 提出写入','用户等待期间：规则变成 B','批准后重验：这次工具不执行'],29)+
rule(300)+t(0,371,'场景 B · 同批第一项修改 AGENTS.md',33,C.ink,700)+
file(0,412,450,205,'工具 1',['真实写入已经发生'],'green')+file(502,412,450,205,'工具 2',['版本变了，尚未执行'],'red')),
'保留真实回执，停止剩余调用，不重放第一项。检查降低应用层竞态风险，但不宣称提供 OS 沙箱或消除所有恶意并发替换。',['S02','T01','D01']);
page('restore','13 · 恢复后重建当前规则','摘要记得旧约定，\n并不让旧约定永久生效','项目正文不作为可恢复授权保存。',svg('旧历史与当前磁盘规则分离后进入下一次请求',
file(0,0,450,247,'旧会话 / 摘要',['过去的事实','可能提到版本 A'],'ink')+file(502,0,450,247,'当前磁盘',['重新授权读取','现在使用版本 B'],'green')+
path('M225 281V351H476','ink')+path('M727 281V351H476','green')+path('M476 351V417','green',true)+
rect(0,452,952,163,C.greenBg)+t(24,516,'恢复历史 + 当前项目上下文',36,C.green,700)+t(24,576,'旧工具不重放，旧审批不继承。',31)),
'删除文件或关闭加载时，当前上下文明确撤去旧规则。压缩和刷新都不改写原始调用事实；下一轮重新检查权限。',['S01','S02','T01']);
page('controls','14 · 在终端里核对来源','看规则、刷新、关闭，\n都不需要问模型','复用 CLI、plain 和 TUI 的输入所有权。',svg('指令查看与刷新控制入口',
consoleBox(0,0,952,245,'无需 API key 的单次查看',['node <cli-entry> --instructions','--instructions-root <project-dir>','--no-instructions'],29)+
consoleBox(0,293,952,281,'plain / TUI',['/instructions','/instructions refresh','/instructions off   /instructions on'],31)+
t(0,651,'展示来源、scope、完整 SHA-256 和加载错误。',30,C.muted)),
'查看不发模型请求。真实 PTY 测试验证取消读取审批后，下一条命令仍可输入，退出时终端模式恢复。',['S03','T02']);
page('practice','15 · 完成一个小修复','金额函数、回归测试，\n再加一份可校验报告','默认跟练只访问本机确定性服务。',svg('金额修复的三个实际产物与离线命令',
[['amount.ts','2.75 × 3 → 825 分'],['amount.test.ts','小数价格 + 零数量回归'],['change-report.json','通过结构校验的修复报告']].map(([a,b],i)=>t(0,64+i*139,a,33,C.ink,700)+t(0,114+i*139,b,29,C.green)+rule(133+i*139)).join('')+
consoleBox(0,459,952,187,'仓库根目录',['pnpm build','node researches/project-instructions/demo.mjs'],26)),
'观察第一次 api 调用如何被整批拦住，再检查实际文件、测试进程与请求正文。原始证据写入 tmp/e05-s001，不进入 Git 历史。',['T03','D01']);
page('verify','16 · 分层证明行为','模型说“遵守了”，\n不等于实现已经通过','每一层证据只回答它能直接观察的问题。',svg('逻辑、HTTP、终端和模型四层验收表',
[['逻辑与文件','作用域、版本、边界、配对和字节'],['真实 HTTP / SDK','请求先有规则，工具随后执行'],['真实 CLI / PTY','查看零请求、取消后输入与退出恢复'],['固定真实服务','正常任务 + 一次拒绝，保留失败']].map(([a,b],i)=>t(0,54+i*157,a,34,C.ink,700)+t(0,111+i*157,b,30,i===3?C.red:C.green)+rule(145+i*157)).join('')),
'真实服务每例最多 8 请求、12 工具、120 秒；不通过不能用其他场景的成功抵消。小样本不用于宣称自然语言遵从的泛化率。',['T01','T02','T03']);
page('finish','17 · 接入后续扩展','这一节建立了\n可查来源的项目上下文','后面三节继续复用权限、预算与恢复机制。',svg('E05四课路线和S001核心交付',
[['S001','AGENTS.md：目录约定'],['S002','Skills：按需加载任务指南'],['S003','MCP：接入外部工具'],['S004','Hooks：在关键步骤执行检查']].map(([a,b],i)=>rect(0,i*123,952,98,i===0?C.greenBg:C.white)+t(24,63+i*123,a,34,C.red,700)+t(190,63+i*123,b,33,C.ink,650)).join('')+
rule(542)+t(0,605,'本节验收：正确规则先于受控工具效果。',34,C.green,700)+t(0,665,'完整协议、限制和复现步骤见配套文档。',29,C.muted)),
'课程图解为实现机制的教学示意，真实交互单独验收。课程随 PR 提供人工 review，网站与图文尚未发布。',['D01','S01','S02']);
if(pages.length!==18) throw new Error('E05-S001 must contain exactly 18 pages including its cover');
for(const [i,p] of pages.entries()) {
 const number=String(i+1).padStart(2,'0');
 const header=`<header class="page-header"><span>Zero2Agent · ${esc(p.section)}</span><span class="page-number">${number}</span></header>`;
 const heading=`<div class="heading" data-block><h1>${esc(p.title).replaceAll('\n','<br>')}</h1><p class="deck" data-prose>${esc(p.deck)}</p></div>`;
 const content=`<div class="content">${p.body}<p class="explain" data-block data-prose>${esc(p.note)}</p></div>`;
 const cover=`<div class="cover-frame"><header class="page-header"><span>Zero2Agent · 扩展能力</span><span class="page-number">E05-S001</span></header><div class="series-masthead" data-block><h1 class="series-title">从零到一做 <span>Agent</span></h1><p class="series-description" data-prose>亲手实现 Coding Agent · 开源实战课程</p><h2 class="lesson-title">项目指令与 AGENTS.md</h2><p class="lesson-promise" data-prose>先读项目约定，再修改目标文件。</p></div><div class="series-body">${p.body}<p class="explain" data-block data-prose>${esc(p.note)}</p></div><div class="cover-tags"><span>目录作用域</span><span>执行前检查</span><span>开源课程</span></div></div>`;
 fs.writeFileSync(p.file,`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=1080"><title>${esc(p.title.replaceAll('\n',''))}</title><link rel="stylesheet" href="course.css"></head><body><main class="sheet ${i===0?'cover series-cover':''}" data-page="${number}">${i===0?cover:header+heading+content}</main></body></html>\n`);
}
fs.writeFileSync('pages.json',JSON.stringify({title:'Zero2Agent · E05-S001 项目指令与 AGENTS.md',date:'2026-10-17',draft:true,publicationStatus:'unpublished',width:1080,height:1440,maxImages:18,edition:'project-instructions-review',pages:pages.map((p,i)=>({file:p.file,title:p.title.replaceAll('\n',''),number:i+1,sources:p.sources}))},null,2)+'\n');
