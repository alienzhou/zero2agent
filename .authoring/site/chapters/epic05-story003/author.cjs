// Editable E05-S003 figures. Each page cites the implementation/standard in sources.md.
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


page('cover','MCP 工具接入','接入外部工具，\n仍由宿主控制执行','E05-S003 · 从本地工单服务开始。',svg('内置工具与本地MCP工具接入同一个Harness',
rect(190,0,572,130,C.ink)+t(476,57,'Agent Harness',43,C.paper,700,'middle')+t(476,104,'权限 · 预算 · 结果 · 恢复',29,C.paper,400,'middle')+
line('M350 151V250H235','green',true)+line('M605 151V250H716','amber',true)+
rect(0,290,430,185,C.greenBg)+t(215,351,'内置工具',38,C.green,700,'middle')+t(215,413,'文件读写 / terminal',29,C.ink,500,'middle')+
rect(522,290,430,185,C.amberBg)+t(737,351,'MCP 适配器',38,C.amber,700,'middle')+t(737,413,'发现 / 校验 / 调用',29,C.ink,500,'middle')+
line('M737 494V548','amber',true)+t(737,601,'本地 issue 服务',34,C.amber,700,'middle')+t(737,650,'stdio 子进程',27,C.muted,400,'middle')),
'MCP 约定外部工具怎样通信；宿主仍决定哪些进程能启动、哪些调用获准，以及断线后如何处理。',['O01','S01','S02']);

page('roles','01 · 放进已有体系','MCP 提供工具，\n工作方法仍来自前两课','四种扩展各自负责一个具体问题。',svg('项目规则技能MCP与Hooks的职责比较',
[['项目规则','这个目录遵循什么约定','AGENTS.md','ink'],['Skills','这类任务按什么步骤做','SKILL.md','green'],['MCP','还能调用哪些外部能力','本课实现','amber'],['Hooks','哪些步骤必须由程序检查','下一课','red']].map(([a,b,c,tone],i)=>rect(0,i*170,952,138,C[tone+'Bg']||C.soft)+t(25,53+i*170,a,35,C[tone],700)+t(260,53+i*170,b,31)+t(260,105+i*170,c,27,C.muted)).join('')),
'本课把固定工单与长日志交给外部服务。修复文件、执行测试仍用内置工具；四种扩展的完整组合验收留给 S004。',['D01','S01']);

page('stdio','02 · 跑通一次连接','先握手、再发现，\n工具调用结束后关闭','本节固定 2025-11-25，只实现本地 stdio 工具子集。',svg('MCP客户端与本地服务握手发现调用关闭的时序',
t(135,44,'Harness / Client',32,C.ink,700,'middle')+t(790,44,'本地 Server',32,C.amber,700,'middle')+line('M135 75V660','line')+line('M790 75V660','line')+
[['initialize：版本 + 能力',135,790,143,'ink'],['返回协商结果',790,135,231,'amber'],['notifications/initialized',135,790,319,'ink'],['tools/list：跟随分页游标',135,790,407,'green'],['tools/call：名称 + 参数',135,790,495,'green'],['结束：关闭管道，等待进程退出',135,790,610,'red']].map(([s,a,b,y,tone])=>t(463,y-18,s,28,C[tone],500,'middle')+line(`M${a} ${y}H${b}`,tone,true)).join('')),
'stdin/stdout 只承载逐行 JSON-RPC，stderr 不进入模型和终端。只接受冻结版本；不兼容或发现失败会显示状态，内置工具仍可使用。',['O01','O02','S02']);

page('trust','03 · 两次独立决定','允许启动服务，\n不等于批准它的工具','配置文件与服务声明都不能自行授予权限。',svg('配置启用门与每次工具授权门相互独立',
t(0,44,'① 用户显式启用本地代码',35,C.ink,700)+
file(0,91,395,190,'mcp.json',['command / args / env'],'ink')+line('M420 182H550','ink',true)+rect(589,107,363,130,C.greenBg)+t(770,160,'--mcp-enable issues',27,C.green,600,'middle',true)+t(770,211,'才启动进程',32,C.green,700,'middle')+
rule(333)+t(0,401,'② 每次工具调用重新授权',35,C.ink,700)+
rect(0,451,395,120,C.amberBg)+t(197,499,'readOnlyHint: true',29,C.amber,600,'middle',true)+t(197,545,'只是服务自报',28,C.muted,400,'middle')+
line('M420 512H550','red',true,true)+rect(589,451,363,120,C.redBg)+t(770,500,'当前宿主权限',32,C.red,700,'middle')+t(770,545,'不因此放行',29,C.red,500,'middle')+
t(0,649,'本地进程有宿主权限；stdio 不提供 OS 沙箱。',30,C.muted)),
'外部工具统一按 execute 授权，accept-edits 不自动放行，read-only 拒绝调用。没有审批处理器时明确拒绝；固定跟练只允许必要的工具。',['O03','S01','S03','T01']);

page('catalogue','04 · 工具表与路由','同名工具可以共存，\n旧调用不能换个服务执行','名称映射包含服务 ID，并核对原始工具名称。',svg('两个服务相同get_issue名称映射为不同的模型工具身份',
[['issues','get_issue','green'],['archive','get_issue','amber']].map(([id,name,tone],i)=>rect(i*500,0,452,155,C[tone+'Bg'])+t(i*500+26,55,id,36,C[tone],700)+t(i*500+26,116,name,31,C.ink,500,'start',true)+line(`M${i*500+226} 179V261`,tone,true)).join('')+
terminal(0,292,952,190,'稳定的模型工具名 · 摘要缩写示意',['mcp_issues_<原工具名哈希>','mcp_archive_<原工具名哈希>'],28)+
rule(552)+t(0,610,'本轮工具表固定；变更通知 → 停止后续调用。',31,C.red,650)+t(0,665,'下一次用户操作才重新连接与发现。',29,C.muted)),
'映射保持在模型名称长度限制内，冲突会报错。目录有页数和工具数上限；不会根据服务推送静默重路由已经提出的调用。',['O03','O04','S01','T01']);

page('results','05 · 先校验，再解释','参数不合法就不发送，\n返回内容也不能随意丢弃','本课支持文本与 structuredContent JSON 对象。',svg('输入Schema校验和工具结果三种不同结算',
rect(0,0,952,123,C.greenBg)+t(30,52,'输入 JSON Schema',34,C.green,700)+t(30,99,'通过校验 → tools/call；失败 → 明确未发送',29,C.ink)+
line('M476 146V217','green',true)+
[['正常结果','文本 / JSON 对象','校验输出 Schema','green'],['工具失败','isError: true','保留失败回执','red'],['无法完整解释','不支持的内容|或非法输出','记录为 unknown|停止本轮','amber']].map(([a,b,c,tone],i)=>rect(i*326,258,300,309,C[tone+'Bg'])+t(i*326+21,314,a,31,C[tone],700)+ls(i*326+21,382,b.split('|'),25,C.ink,41)+ls(i*326+21,487,c.split('|'),25,C.ink,41)).join('')+
t(0,650,'不支持的 Schema 在发现时失败，不静默放宽。',31,C.muted)),
'JSON Schema 使用有界的 2020-12 子集；外部引用、pattern、未知关键字等明确拒绝。图像、音频与资源内容暂未实现，不能丢掉后仍报告成功。',['O03','S01','S04','T01']);

page('recall','06 · 大结果继续按需读','保存下来的正文，\n仍然属于原外部来源','沿用 E04 的长结果引用，同时补上服务身份。',svg('长日志落盘后按当前外部来源权限回读尾页',
file(0,0,405,210,'get_logs 回包',['固定长日志','末尾：实际结论'],'amber')+line('M430 106H540','amber',true)+
rect(584,0,368,210,C.soft)+t(610,55,'结果引用',35,C.ink,700)+ls(610,111,['服务 + 工具身份','内容哈希 + 生命周期'],27,C.muted,53)+
line('M770 233V305H476','green',true)+terminal(0,340,952,140,'按需读取尾页',['read_tool_result({ reference, tail:true })'],28)+
line('M476 507V553','green',true)+t(476,601,'当前来源启用 + 当前权限批准',34,C.green,700,'middle')+t(476,657,'服务已停用 / 身份变化 → 正文回读拒绝',29,C.red,500,'middle')),
'读取每页最多 4096 字节。恢复只保留来源元信息；不会恢复进程、凭据或旧审批。历史中已可见的观察仍保留，重新读取正文要走当前许可。',['S01','S05','T02']);

page('unknown','07 · 断线后的关键判断','没有收到结果，\n不能推断操作没发生','调用发出后断线、取消或超时，都可能已有外部效果。',svg('先产生一次效果再断线后停止未知调用且不重放的时序',
line('M35 30V645','ink',true)+[
['record_action 发出','服务把本地计数从 0 改成 1','green'],
['连接在回包前断开','客户端没有完整结果','red'],
['记为 unknown，停止本轮','后续未执行项仍配对为 not-started','amber'],
['用户核对效果并明确继续','保留既有效果，重建当前连接与权限','green'],
['不会重放原调用','计数保持 1；不宣称已经回滚','green'],
].map(([a,b,tone],i)=>dot(35,40+i*130,8,tone)+t(79,42+i*130,a,34,C[tone],700)+t(79,87+i*130,b,28,C.muted)).join('')),
'沿用 E04 的 /recovery 与显式继续入口。接收到工具业务错误与传输失败分别处理；进程清理报错也不能把未知效果降成可继续的普通失败。',['O05','S02','S06','T01','T02']);

page('bounds','08 · 管好连接与容量','每一轮有边界，\n结束时等待真正清理','外部调用沿用原工具预算；连接也有独立上限。',svg('本轮连接发现调用关闭与三类容量边界',
[['连接','green'],['发现','green'],['本轮调用','amber'],['关闭并等待','red']].map(([a,tone],i)=>rect(i*242,0,226,95,C[tone+'Bg'])+t(i*242+113,59,a,30,C[tone],700,'middle')+(i<3?line(`M${i*242+228} 48h12`,'ink',true):'')).join('')+
[['目录','每服务最多 32 工具 / 8 页','循环游标与超量明确失败'],['传输','单条 1 MiB / 累计 16 MiB','JSON 解析前检查字节上限'],['时间','启动发现 10 秒 / 调用 30 秒','仍受整轮预算与用户取消约束']].map(([a,b,c],i)=>rule(165+i*165)+t(0,218+i*165,a,36,C.ink,700)+t(160,212+i*165,b,30,C.green,650)+t(160,262+i*165,c,27,C.muted)).join('')+
t(0,665,'关闭先 TERM，再 KILL；检查 PID 已退出。',30,C.red,650)),
'环境只传显式键值，命令与参数不经过 shell。清理针对普通子进程组；脱离该组的进程不在保证内。完整参数表与临界值测试放在跟练文档。',['S02','S04','T01']);

page('controls','09 · 亲手接入','先查看工具表，\n再带上明确授权做任务','没有模型凭据，也可以检查本地连接与目录。',svg('CLI MCP配置与离线跟练的实际入口',
terminal(0,0,952,250,'在仓库构建后 · 配置中的 node 路径需显式填写',['--mcp-config /path/to/mcp.json','--mcp-enable issues --mcp','→ 显示状态与映射后的工具名'],28)+
terminal(0,302,952,190,'固定离线跟练',['pnpm build','node researches/mcp/demo.mjs'],29)+
t(0,595,'SDK：Agent({ mcp: { servers: [...] } })',29,C.ink,600,'start',true)+t(0,651,'当前轮结束关闭；恢复历史不会自动启动旧进程。',30,C.muted)),
'CLI 配置不接受 enabled 字段，启用由启动参数决定；SDK 则由调用方显式设置 enabled:true。真实任务的每次调用与保存结果回读仍需当前权限。',['S03','D02','T03']);

page('practice','10 · 验收实际效果','工单读得到，\n拒绝和未知效果也管得住','用固定本地服务与金额缺陷，避免连接真实业务系统。',svg('正常拒绝未知三类验收与实际产物',
[['正常流程','issue + 长日志 → 尾页回读','修复金额 → 实际测试 → JSON 报告','green'],['明确拒绝','record_action 被宿主拒绝','无重试，效果计数为 0','red'],['效果后断线','操作已发生但结果未知','停止、配对、核对后继续，计数仍为 1','amber']].map(([a,b,c,tone],i)=>rect(0,i*205,952,167,C[tone+'Bg'])+t(24,51+i*205,a,35,C[tone],700)+t(24,103+i*205,b,30,C.ink)+t(24,145+i*205,c,27,C.muted)).join('')+
t(0,660,'分别核对源码、测试结果、文件内容与进程退出。',29,C.ink,600)),
'确定性响应、真实 stdio、CLI/PTY 与真实模型服务分别验收。两例模型观察只证明该输入与版本；原始记录在 Git 外归档，失败与重验原因均保留。',['T01','T02','T03','D02']);

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
  const cover=`<div class="cover-frame"><header class="page-header"><span>Zero2Agent · 扩展能力</span><span class="page-number">E05-S003</span></header><div class="series-masthead" data-block><h1 class="series-title">从零到一做 <span>Agent</span></h1><p class="series-description" data-prose>亲手实现 Coding Agent · 开源实战课程</p><h2 class="lesson-title">MCP 工具接入</h2><p class="lesson-promise" data-prose>接入外部工具，仍由宿主控制授权与恢复。</p></div><div class="series-body">${p.body}<p class="explain" data-block data-prose>${esc(p.note)}</p></div><div class="cover-tags"><span>本地 stdio</span><span>当前权限</span><span>开源课程</span></div></div>`;
  fs.writeFileSync(p.file,`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=1080"><title>${esc(p.title.replaceAll('\n',''))}</title><link rel="stylesheet" href="course.css"></head><body><main class="sheet ${i===0?'cover series-cover':''}" data-page="${number}">${i===0?cover:header+heading+content}</main></body></html>\n`);
}
fs.writeFileSync('pages.json',JSON.stringify({title:'Zero2Agent · E05-S003 MCP 工具接入',date:'2026-10-17',draft:true,publicationStatus:'unpublished',width:1080,height:1440,maxImages:18,edition:'mcp-stdio-tools',pages:pages.map((p,i)=>({file:p.file,title:p.title.replaceAll('\n',''),number:i+1,sources:p.sources}))},null,2)+'\n');
