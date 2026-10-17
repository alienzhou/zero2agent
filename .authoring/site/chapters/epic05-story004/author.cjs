// Editable E05-S004 figures. Each page cites the implementation/standard in sources.md.
const fs = require('node:fs');
const path = require('node:path');
const C = {ink:'#202622',paper:'#F4F1EA',muted:'#596057',line:'#C9CDC2',white:'#FFFEF9',soft:'#E7EADF',green:'#28614D',greenBg:'#E0EBDF',red:'#B53830',redBg:'#F2DED7',amber:'#896016',amberBg:'#F0E5C9'};
const esc = s => String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const t = (x,y,s,size=32,color=C.ink,weight=400,anchor='start',mono=false) => `<text x="${x}" y="${y}" fill="${color}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" ${mono?'class="mono"':''}>${esc(s)}</text>`;
const ls = (x,y,ss,size=30,color=C.ink,gap=48) => ss.map((s,i)=>t(x,y+i*gap,s,size,color)).join('');
const rect = (x,y,w,h,fill=C.white,stroke='none',radius=0) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
const line = (d,tone='ink',arrow=false,dash=false) => `<path d="${d}" fill="none" stroke="${C[tone]}" stroke-width="3" stroke-linecap="round" ${arrow?`marker-end="url(#${tone})"`:''} ${dash?'stroke-dasharray="9 8"':''}/>`;
const dot = (x,y,r=7,tone='ink') => `<circle cx="${x}" cy="${y}" r="${r}" fill="${C[tone]}"/>`;
const rule = (y,x=0,w=952) => line(`M${x} ${y}h${w}`,'line');
const tag = (x,y,w,s,tone='ink') => rect(x,y,w,48,C[tone+'Bg']||C.soft)+t(x+15,y+33,s,26,C[tone],650);
const terminal = (x,y,w,h,title,rows,size=29) => {
  h=Math.max(h,108+(rows.length-1)*49+24);
  return `<g data-terminal="${x} ${y} ${w} ${h}">`+rect(x,y,w,h,C.ink,'none',10)+t(x+24,y+43,title,25,'#B8C8B9',500)+line(`M${x+24} ${y+62}h${w-48}`,'muted')+rows.map((s,i)=>t(x+24,y+108+i*49,s,size,C.paper,400,'start',true)).join('')+'</g>';
};
const file = (x,y,w,h,title,rows,tone='green') => `<path d="M${x} ${y}h${w-40}l40 40v${h-40}h-${w}Z" fill="${C.white}" stroke="${C[tone]}" stroke-width="3"/><path d="M${x+w-40} ${y}v40h40" fill="none" stroke="${C[tone]}" stroke-width="2"/>`+t(x+22,y+75,title,31,C[tone],700)+ls(x+22,y+132,rows,28,C.ink,44);
const svg = (label,body,h=680) => `<svg class="diagram" viewBox="0 0 952 ${h}" width="952" height="${h}" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title><defs>${['ink','green','red','amber'].map(k=>`<marker id="${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="${C[k]}"/></marker>`).join('')}</defs>${body}</svg>`;
const pages=[];
const page=(slug,section,title,deck,body,note,sources)=>pages.push({file:`${String(pages.length+1).padStart(2,'0')}-${slug}.html`,section,title,deck,body,note,sources});



page('cover','Hooks 与扩展验收','检查进入执行链，\n事实和结论分别保存','E05-S004 · 从一次已写入但检查失败的操作开始。',svg('工具事实与Hook检查结论分别记录在同一Harness中',
rect(150,0,652,130,C.ink)+t(476,57,'Agent Harness',43,C.paper,700,'middle')+t(476,104,'权限 · 预算 · 结果 · 恢复',29,C.paper,400,'middle')+
line('M310 155V250H215','green',true)+line('M650 155V250H735','red',true)+
rect(0,290,430,185,C.greenBg)+t(215,353,'工具事实',38,C.green,700,'middle')+t(215,413,'文件已经写入',31,C.ink,500,'middle')+
rect(522,290,430,185,C.redBg)+t(737,353,'检查结论',38,C.red,700,'middle')+t(737,413,'后置检查未通过',31,C.ink,500,'middle')+
line('M215 500V560H735V500','ink')+t(476,637,'保留效果，任务仍未完成',35,C.ink,700,'middle')),
'工具回执说明发生了什么；Hook 说明必要检查是否通过。两种事实不能互相覆盖，恢复也不能靠重放旧操作补齐。',['S01','S03','T02']);

page('purpose','01 · 为什么还需要 Hook','把要求写进文档，\n还要把检查接进程序','以只读配置 readonly.json 为例。',svg('项目规则技能与程序Hook各自负责的工作',
[['项目规则','这个目录的约定','配置文件不应被修改','ink'],['Skills','这类任务的步骤','先改代码，再运行测试','green'],['Hooks','执行时必须过的检查','实际写入前阻止受保护路径','red']].map(([a,b,c,tone],i)=>rect(0,i*220,952,181,C[tone+'Bg']||C.soft)+t(27,53+i*220,a,36,C[tone],700)+t(27,112+i*220,b,30)+t(345,112+i*220,c,30,C.muted)).join('')),
'自然语言约定由模型理解；Hook 在固定位置被宿主等待。Hook 只返回通过或阻止，不能批准宿主拒绝的操作。',['O01','S01','S03']);

page('stages','02 · 三处同步检查点','前置可以阻止，\n后置保留已经发生的事实','展示通知继续负责界面，等待式控制接口负责执行。',svg('从授权到工具结果再到最终完成的同步检查顺序',
line('M45 20V650','ink',true)+[
['当前权限批准','未获批准就不运行工具前置 Hook','ink'],['beforeTool → 文件 Checkpoint','检查通过，才进入受控写入','green'],['工具执行 → 保存真实回执','真实结果与后置待检查义务一起保存','ink'],['afterTool','失败就停后续调用，原回执不改写','red'],['beforeComplete → 原完成校验','检查与产物门槛共同决定完成','green']
].map(([a,b,tone],i)=>dot(45,40+i*128,8,tone)+t(87,45+i*128,a,33,C[tone],700)+t(87,91+i*128,b,28,C.muted)).join('')),
'前置失败配对为未执行；后置失败说明“工具已执行，检查失败”。Hook 自身不会递归触发另一轮 Hook。',['S03','S04','T02']);

page('trust','03 · 启用绑定具体版本','发现配置不会执行，\n信任要指向当前代码','先查看身份，再明确启用；模型不能替用户点头。',svg('配置与脚本版本生成身份再由用户显式启用',
file(0,0,430,200,'hooks.json',['command / argv / sources','watch / stage'],'ink')+line('M455 100H545','ink',true)+
rect(585,0,367,200,C.amberBg)+t(610,56,'当前版本身份',34,C.amber,700)+ls(610,114,['配置 + 可执行文件','脚本内容 + 物理身份'],26,C.ink,47)+
terminal(0,290,952,184,'CLI 的两个独立步骤',['--hooks-config /path/hooks.json --hooks','--hook-trust gate:<identity>'],27)+
t(0,574,'配置或脚本变化 → 旧信任失效',34,C.red,700)+t(0,634,'本轮不热切换到刚被修改的程序。',30,C.muted)),
'命令绝对路径，参数不拼 shell，环境只显式传入。可信脚本具有宿主权限；版本核对不等于 OS 沙箱或通用回滚。',['S01','S05','T01']);

page('before','04 · 写入前的门','检查通过也不能扩权，\n先批准再检查再写入','固定参数，不接收 Hook 返回的“改参数”或“自动批准”。',svg('权限门前置Hook与文件保护依次发生',
[['权限','当前规则与审批','ink'],['前置 Hook','pass / block','red'],['Checkpoint','受控文件范围','amber'],['实际工具','写入文件','green']].map(([a,b,tone],i)=>rect(i*242,0,226,155,C[tone+'Bg']||C.soft)+t(i*242+113,58,a,33,C[tone],700,'middle')+t(i*242+113,116,b,24,C.muted,400,'middle')+(i<3?line(`M${i*242+228} 77h12`,'ink',true):'')).join('')+
rule(254)+t(0,320,'宿主拒绝',36,C.red,700)+t(270,320,'Hook 和工具都不启动',31,C.red)+
rule(385)+t(0,452,'Hook 阻止',36,C.red,700)+t(270,452,'工具效果为 0，批次停止',31,C.red)+
rule(515)+t(0,582,'Hook 通过',36,C.green,700)+t(270,582,'仍核对边界，再运行工具',31,C.green)),
'模型文件文本、服务 annotations、技能声明都不能授予这道门的权限。原文件保护接口继续在受控写入前等待完成。',['S03','T02','T03']);

page('after','05 · 已写入但没通过','后置检查失败，\n文件和真实回执仍然存在','把一次写入与一次检查分开结算。',svg('真实工具成功和后置检查失败是两个独立事实',
rect(0,0,452,280,C.greenBg)+t(28,62,'工具账本',37,C.green,700)+ls(28,128,['write_file 已执行','文件内容已改变','原回执：成功'],30,C.ink,58)+
rect(500,0,452,280,C.redBg)+t(528,62,'检查账本',37,C.red,700)+ls(528,128,['afterTool 已运行','返回 block','必要检查未通过'],30,C.ink,58)+
line('M226 308V370H726V308','ink')+t(476,433,'当前任务未完成',40,C.red,700,'middle')+
terminal(0,495,952,145,'正确的后续处理',['保留文件 → 核对效果 → 明确运行新检查'],28)),
'不把成功回执改成“没执行”，不重写文件来补跑检查。后续工具调用配对为未开始，不能靠模型继续试探放行。',['S03','S04','T02','T03']);

page('completion','06 · 最后一道完成判断','Hook 通过，\n原来的完成门槛仍然有效','Hook 失败会停止；首版不自动发起新的模型修复循环。',svg('未解决读取待检查文件审计与产物契约共同决定完成',
[['未解决读取','必要证据读到了吗','ink'],['待检查义务','旧检查已明确处理吗','amber'],['beforeComplete','检查程序是否通过','green'],['文件审计','声明范围是否被检查改动','red'],['原产物契约','报告 JSON 是否符合结构','green']].map(([a,b,tone],i)=>rect(0,i*132,952,102,C[tone+'Bg']||C.soft)+t(25,64+i*132,a,33,C[tone],700)+t(370,64+i*132,b,30,C.ink)).join('')),
'完成前检查约定只验证；受控写入、watch 与契约路径出现改动就失败。未声明的外部效果不在文件审计保证内，原契约仍负责最终结构校验。',['S01','S03','T01','T02']);

page('protocol','07 · 小而明确的进程契约','控制 JSON 和诊断分开，\n正文与凭据不默认传入','本节 JSON v1 是产品约定，不冒充跨产品通用标准。',svg('Hook输入元信息stdout控制JSON和stderr隔离',
terminal(0,0,952,185,'stdin · 最小元信息',['stage / cwd / checkId','tool 身份与路径 / 回执状态与摘要'],28)+
terminal(0,242,952,185,'stdout · 严格控制响应',['{"version":1,"decision":"pass"}','或 decision:"block"；多余控制字段拒绝'],27)+
rect(0,490,952,149,C.redBg)+t(25,545,'stderr：排空并限额，不注入模型或日志',31,C.red,650)+t(25,600,'无效 JSON、非零退出、超量和超时均停止。',29,C.muted)),
'不默认传整段对话、工具正文、模型密钥或人工终端字节。检查次数、输入输出字节与时限独立有界，耗时仍受整轮预算约束。',['S01','S02','T01']);

page('guardian','08 · 宿主被强杀之后','不能只恢复账本，\n还要终止留下的检查进程','真实 SIGKILL 不会执行宿主自己的 finally。',svg('管道守护进程在宿主死亡后终止真实Hook命令',
[['Agent 宿主','等待检查','ink'],['管道守护','监测父管道 EOF','amber'],['真实 Hook','运行固定程序','green']].map(([a,b,tone],i)=>rect(i*326,0,300,200,C[tone+'Bg']||C.soft)+t(i*326+150,67,a,34,C[tone],700,'middle')+t(i*326+150,132,b,27,C.ink,400,'middle')+(i<2?line(`M${i*326+303} 100h20`,'ink',true):'')).join('')+
t(0,298,'① 宿主 SIGKILL，父管道关闭',34,C.red,700)+line('M35 326V380','red',true)+t(0,439,'② 守护进程终止检查进程组',34,C.amber,700)+line('M35 467V521','amber',true)+t(0,580,'③ 恢复显示未知，不自动补跑',34,C.green,700)),
'正常结束、超时与取消也等待清理。实测按普通 POSIX 进程组检查 PID；主动逃离进程组和 Windows 后代清理不宣称已被覆盖。',['S02','T03']);

page('recovery','09 · 恢复必要检查','恢复事实，\n不恢复进程或旧信任','工具结算与检查开始、结算分别等待保存。',svg('工具事实检查义务和用户显式新检查的恢复时间线',
line('M35 15V650','ink',true)+[
['保存工具回执','同时记下 afterTool 尚未开始','green'],['保存 Hook 启动意图','再启动进程；中断后视为未知','amber'],['恢复会话，展示两本账','旧工具和旧 Hook 都不自动重放','ink'],['用户核对并授权新检查','旧失败保留，新检查有独立 ID','green']].map(([a,b,tone],i)=>dot(35,45+i*165,8,tone)+t(80,49+i*165,a,34,C[tone],700)+t(80,98+i*165,b,29,C.muted)).join('')),
'使用 /recovery check <核对说明>，再明确 continue。脚本改动需重新查看并信任当前版本；显式新检查关联旧记录，不能悄悄删除必要检查。',['S01','S04','S05','T03']);

page('combined','10 · 四种扩展同一条链','从项目约定到完成校验，\n逐项核对实际证据','沿用固定金额缺陷和本地工单，不连接业务系统。',svg('AGENTS技能MCP内置工具Hook和报告组成完整案例',
[['AGENTS.md','根规则 + api 目录约定','ink'],['fix-with-tests','明确激活，按需读取报告资源','green'],['MCP issue / logs','服务身份 + 长日志尾页回读','amber'],['内置工具','实际修改、回归测试与报告','ink'],['Hooks + 原契约','前后检查、完成检查及 JSON 结构','red']].map(([a,b,tone],i)=>rect(0,i*132,952,104,C[tone+'Bg']||C.soft)+t(24,64+i*132,a,31,C[tone],700)+t(360,64+i*132,b,28,C.ink)).join('')),
'核对实际请求中的作用域和技能来源、服务调用、文件字节、测试退出码与检查记录；不能只看最终回答是否出现四个关键词。',['D01','T04']);

page('practice','11 · 固定正例与两个故障','正常完成要有证据，\n断线与崩溃也要能收束','同一预算：8 请求 / 12 工具 / 120 秒。',svg('组合正常与两个故障版本的固定验收判据',
[['正常组合','修复 → 实际测试 → Hook → 合法报告','规则、技能、MCP 与检查均有证据','green'],['MCP 效果后断线','效果计数 1，旧调用不重放','明确继续仍使用当前权限与配置','amber'],['已写入，Hook 尚未结算','保留真实回执，检查显示未知','用户核对，再明确授权新检查','red']].map(([a,b,c,tone],i)=>rect(0,i*205,952,169,C[tone+'Bg'])+t(24,51+i*205,a,35,C[tone],700)+t(24,104+i*205,b,29,C.ink)+t(24,149+i*205,c,27,C.muted)).join('')+
t(0,659,'跟练：node researches/hooks/demo.mjs',29,C.ink,650,'start',true)),
'默认离线使用确定性模型响应，实际启动进程、写文件与跑测试。真实模型、CLI/PTY、SIGKILL 和双端阅读分别验收；完整配置与故障表下沉到跟练。',['T03','T04','D01']);

if(pages.length<2 || pages.length>18) throw new Error('Course needs cover and content, at most 18 pages');
if(pages.some(p=>!p.sources.length)) throw new Error('Every page needs traceable sources');
if(fs.existsSync('pages.json')) {
  const previous=JSON.parse(fs.readFileSync('pages.json','utf8'));
  const current=new Set(pages.map(p=>p.file));
  for(const entry of previous.pages??[]) if(/^\d{2}-[a-z0-9-]+\.html$/.test(entry.file)&&!current.has(entry.file)) fs.rmSync(entry.file,{force:true});
}
fs.copyFileSync(path.join(__dirname,'style.css'),'course.css');
for(const [i,p] of pages.entries()) {
  const number=String(i+1).padStart(2,'0');
  const header=`<header class="page-header"><span>Zero2Agent · ${esc(p.section)}</span><span class="page-number">${number}</span></header>`;
  const heading=`<div class="heading" data-block><h1>${esc(p.title).replaceAll('\n','<br>')}</h1><p class="deck" data-prose>${esc(p.deck)}</p></div>`;
  const content=`<div class="content">${p.body}<p class="explain" data-block data-prose>${esc(p.note)}</p></div>`;
  const cover=`<div class="cover-frame"><header class="page-header"><span>Zero2Agent · 扩展能力</span><span class="page-number">E05-S004</span></header><div class="series-masthead" data-block><h1 class="series-title">从零到一做 <span>Agent</span></h1><p class="series-description" data-prose>亲手实现 Coding Agent · 开源实战课程</p><h2 class="lesson-title">Hooks 与扩展验收</h2><p class="lesson-promise" data-prose>让必要检查进入执行链，四种扩展一起验收。</p></div><div class="series-body">${p.body}<p class="explain" data-block data-prose>${esc(p.note)}</p></div><div class="cover-tags"><span>同步检查</span><span>恢复事实</span><span>开源课程</span></div></div>`;
  fs.writeFileSync(p.file,`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=1080"><title>${esc(p.title.replaceAll('\n',''))}</title><link rel="stylesheet" href="course.css"></head><body><main class="sheet ${i===0?'cover series-cover':''}" data-page="${number}">${i===0?cover:header+heading+content}</main></body></html>\n`);
}
fs.writeFileSync('pages.json',JSON.stringify({title:'Zero2Agent · E05-S004 Hooks 与扩展验收',date:'2026-10-17',draft:true,publicationStatus:'unpublished',width:1080,height:1440,maxImages:18,edition:'hooks-extension-acceptance',pages:pages.map((p,i)=>({file:p.file,title:p.title.replaceAll('\n',''),number:i+1,sources:p.sources}))},null,2)+'\n');
