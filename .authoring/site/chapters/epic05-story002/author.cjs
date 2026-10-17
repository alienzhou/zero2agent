// Editable E05-S002 figures. Each page cites the implementation/standard in sources.md.
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

page('cover','Skills 的发现与按需加载','先看到技能目录，\n需要时再读完整步骤','E05-S002 · 让专门的工作方法按需进入请求。',svg('从技能目录逐层展开正文与参考文件的教学示意',
rect(0,0,952,115,C.soft)+t(32,49,'目录',35,C.ink,700)+t(180,49,'fix-with-tests',34,C.ink,600,'start',true)+t(180,92,'修复金额错误，补测试并输出报告',29,C.muted)+
line('M70 136V217H140','green',true)+file(170,182,710,205,'SKILL.md 正文',['定位 → 修改 → 测试 → 报告'],'green')+
line('M240 408V488H310','amber',true)+file(340,451,540,205,'references / 报告格式',['需要时单独读取'],'amber')),
'教学示意：发现只给名称与描述；选中后加载正文，引用文件仍按需读取。三个阶段都沿用当前权限。',['O01','S01']);

page('layers','01 · 三层披露','先知道能做什么，\n再取这次需要的细节','把无关技能正文留在请求之外。',svg('一次任务沿目录、正文、资源三层取得内容',
[['01','目录摘要','名称 + 描述','所有已发现技能',C.soft,C.ink],['02','选中正文','完整 Markdown','本次激活的技能',C.greenBg,C.green],['03','按需资源','报告格式 / 参考','明确请求的文件',C.amberBg,C.amber]].map(([n,a,b,c,fill,color],i)=>rect(0,i*220,952-i*90,174,fill)+t(28,60+i*220,n,42,color,750)+t(129,59+i*220,a,36,color,700)+t(129,111+i*220,b,31)+t(129,152+i*220,c,26,C.muted)).join('')+
line('M910 175V635','ink',true)+t(908,666,'按需展开',26,C.muted,500,'end')),
'目录描述帮助模型判断相关性，不保证每次都选对。使用者也可明确选择；大参考文件不会因为出现在目录里就自动进入上下文。',['O01','S01','T01']);

page('package','02 · 一个技能怎样组织','目录名、元数据，\n先让加载器读得懂','SKILL.md 使用 YAML frontmatter，再接 Markdown。',svg('同名技能目录、必需元数据与可选资源的结构',
t(0,35,'.agents / skills /',33,C.ink,650,'start',true)+t(0,91,'fix-with-tests /',37,C.green,750,'start',true)+
line('M30 119V629','line')+line('M30 164H80','green')+t(104,177,'SKILL.md',33,C.green,700,'start',true)+
terminal(105,208,847,255,'标准头部示例',['---','name: fix-with-tests','description: 修复错误并补回归测试','---'],27)+
line('M30 526H80','amber')+t(104,539,'references / report-format.json',29,C.amber,600,'start',true)+
line('M30 613H80','ink')+t(104,626,'scripts / check.mjs   ← 可选脚本',29,C.ink,500,'start',true)),
'本节严格校验名称与目录匹配、描述和 YAML 类型。资源相对技能根解析；references、scripts 是推荐组织方式，链接不会自动展开，目录里有脚本也不会运行。',['O01','S02','D01']);

page('selection','03 · 谁来选择技能','用户明确选，\n模型也能从目录里选','两条入口都交给宿主加载当前来源。',svg('用户选择和模型选择汇合为同一受控激活过程',
t(0,48,'用户明确选择',34,C.ink,700)+t(510,48,'模型读取目录后选择',34,C.ink,700)+
rect(0,83,442,142,C.soft)+ls(26,137,['CLI 启动参数','或 /skills load'],30,C.ink,48)+
rect(510,83,442,142,C.greenBg)+ls(536,137,['读取名称与描述','调用 load_skill'],30,C.green,48)+
line('M221 246V302H476','ink',true)+line('M731 246V302H476','green',true)+
rect(190,351,572,126,C.white,C.line)+t(476,401,'宿主核对来源与读取权限',33,C.ink,700,'middle')+t(476,448,'正文读成功，才标记 loaded',29,C.muted,400,'middle')+
line('M476 498V552','green',true)+t(476,610,'下一请求：当前正文 + 原任务',35,C.green,700,'middle')+t(476,663,'工具回执只记录加载事实，不复制正文',28,C.muted,400,'middle')),
'名称重名时必须按来源 ID 选择，不能静默覆盖。加载失败有可见状态；正文作为独立用户级上下文计入预算，固定系统说明强调它不能授予权限。',['S01','S03','T01']);

page('before-work','04 · 先加载，再做业务','同一批“加载 + 写文件”，\n不能抢先把文件写了','新步骤必须先进入模型能看到的下一次请求。',svg('混合批次未执行后单独加载技能再进行业务操作的时序',
line('M37 25V648','ink',true)+[
['模型提出 load_skill + write_file','整批尚无实际效果','red'],
['整批返回明确的未执行结果','每个工具调用都有配对回执','red'],
['模型单独调用 load_skill','宿主读取当前正文，返回小回执','green'],
['下一请求带上技能正文','模型按步骤重新提出业务调用','green'],
['当前权限和版本仍有效','才允许实际修改或执行测试','green'],
].map(([a,b,tone],i)=>dot(37,49+i*130,9,tone)+t(83,49+i*130,a,32,C[tone],700)+t(83,94+i*130,b,28,C.muted)).join('')),
'重规划有次数和整轮预算限制。等待审批或同批前项改变技能时，宿主再次核对版本；已经发生的真实效果保留，后续未执行调用停止，不自动重放。',['S03','D01','T01']);

page('resources','05 · 资源从哪里读取','相对技能根定位，\n读取仍要经过当前许可','激活正文，不等于拿到整个文件系统的通行证。',svg('技能根内的参考路径与被拒绝的路径穿越和外部软链接',
rect(0,0,952,405,C.greenBg,C.green)+t(30,56,'fix-with-tests / ← 技能根',34,C.green,700)+
line('M58 89V335','green')+line('M58 133H115','green')+t(139,146,'SKILL.md',32,C.ink,650,'start',true)+
line('M58 238H115','green')+t(139,251,'references / report-format.json',29,C.ink,500,'start',true)+t(139,303,'read_skill_resource 返回来源、版本与分页范围',27,C.green)+
tag(139,330,650,'实际返回的正文进入既有上下文预算','green')+
line('M250 425V449H70','red',true,true)+t(96,491,'../outside.txt',31,C.red,650,'start',true)+t(96,538,'路径穿越 → 拒绝',28,C.red)+
line('M700 425V449H540','red',true,true)+t(568,491,'link → 外部文件',31,C.red,650)+t(568,538,'物理越界 → 拒绝',28,C.red)+
rule(585)+t(0,649,'显式配置外部技能目录，也必须获得读取许可。',31,C.ink,650)),
'只在真正需要报告结构时读取 references/report-format.json。绝对路径、越界链接、失效资源或读取拒绝都明确失败；不会回退成历史副本，也不会偷偷扩大权限。',['S01','S04','T01']);

page('scripts','06 · 加载不会执行脚本','看到“自动运行”，\n也不能跳过工具授权','allowed-tools 只是本节未实现权限语义的声明。',svg('发现加载内容与实际terminal执行之间的独立授权门',
t(0,45,'发现 / 加载技能',35,C.ink,700)+line('M0 91H952','line')+
file(0,125,412,197,'SKILL.md',['“马上运行 check.mjs”'],'ink')+
line('M445 228H595','muted',true,true)+rect(642,165,310,109,C.soft)+t(797,231,'只读取内容',34,C.muted,700,'middle')+
t(0,392,'模型真正请求 terminal',35,C.ink,700)+line('M0 435H952','line')+
[['请求命令','green'],['当前权限','amber'],['实际进程','green']].map(([a,tone],i)=>rect(i*335,480,282,108,C[tone+'Bg'])+t(i*335+141,546,a,33,C[tone],700,'middle')+(i<2?line(`M${i*335+295} 534h25`,'ink',true):'')).join('')+
t(476,647,'拒绝时：没有进程启动，也没有脚本效果',31,C.red,700,'middle')),
'只发现或加载技能，脚本执行次数为零。真正的 terminal 调用沿用当前授权；技能不能把 read-only 改成允许。普通本地脚本拥有宿主进程权限，不宣称有 OS 沙箱。',['O01','S01','S04','T02']);

page('current','07 · 当前版本与历史','恢复时重新读取，\n停用后只保留历史事实','保存的是来源与选择元信息，不是旧授权或进程。',svg('恢复使用当前版本与停用后历史正文不再激活的两条时间线',
t(0,44,'恢复会话',34,C.ink,700)+
[['保存选择','来源 + 版本 A'],['当前磁盘','正文已变成 B'],['重新核对','读许可 + 加载 B']].map(([a,b],i)=>t(i*334,132,a,32,i===2?C.green:C.ink,700)+t(i*334,183,b,26,C.muted)+(i<2?line(`M${i*334+253} 148h57`,'green',true):'')).join('')+
tag(0,225,952,'旧版本可追查，当前身份与内容哈希重新建立','green')+
rule(332)+t(0,399,'用户停用技能',34,C.ink,700)+
rect(0,439,410,135,C.soft)+t(24,491,'历史：曾经加载过 A / B',30,C.muted)+t(24,540,'对话与真实回执保留',28,C.muted)+
line('M440 502H557','red',true,true)+rect(608,439,344,135,C.redBg)+t(780,491,'当前 loaded 列表',29,C.red,700,'middle')+t(780,546,'不含该技能',32,C.red,700,'middle')+
t(0,650,'历史正文、摘要或旧回执，都不能重新激活技能。',31,C.ink,650)),
'恢复与下一请求按当前配置、读取权限和版本重建。失踪或无法读取的已选技能保持可见失败；停用不会改写历史，也不继承脚本进程或曾经批准的操作。',['S01','S03','S05','T01']);

page('controls','08 · 查看与控制','先核对来源，\n再选择、刷新或停用','这些操作由宿主处理，不需要模型解释命令。',svg('单次CLI选项与交互skills命令入口',
terminal(0,0,952,241,'CLI · 具体入口见跟练',['--skills','--skill fix-with-tests','--skill-root <dir>    --no-skills'],28)+
terminal(0,286,952,291,'plain / TUI',['/skills                 /skills refresh','/skills load fix-with-tests','/skills unload fix-with-tests','/skills off             /skills on'],28)+
t(0,650,'查看状态、来源 ID 与版本；refresh 本身不发模型请求。',29,C.muted)),
'重名用精确来源 ID。全局关闭后不注入技能正文；重新开启仍要读取当前文件。具体启动命令、加载失败与当前请求信息见本节跟练和终端展示。',['S06','T03','D02']);

page('practice','09 · 运行固定的跟练','用同一个金额错误，\n观察三层内容依次出现','默认使用本机确定性响应，真正执行文件工具和测试。',svg('本地跟练命令和从技能加载到金额产物的工作流',
terminal(0,0,952,195,'仓库根目录 · 无需模型 API key',['pnpm build','node researches/skills/demo.mjs'],28)+
line('M35 244V640','ink',true)+[
['目录 → 正文 → 报告格式','无关正文与巨大参考不进入请求'],
['修复 amount.ts，补回归测试','2.75 × 3 → 825 分；零数量 → 0'],
['真实测试通过后输出 JSON 报告','脚本另做独立金额断言，核对实际字节'],
].map(([a,b],i)=>dot(35,282+i*161,8,'green')+t(82,282+i*161,a,32,C.ink,700)+t(82,329+i*161,b,28,C.muted)).join('')),
'脚本还运行一次 read-only 拒绝案例，验证恶意技能无法启动脚本。原始请求、文件与进程证据写入 tmp/e05-s002；离线验证和真实模型服务验证分别记录。',['T02','D02']);

page('verify','10 · 用证据判断完成','核对请求、文件、进程，\n才能证明“按需”和“受控”','完成跟练后，沿两条证据链逐项核对。',svg('正常任务与拒绝任务各自需要检查的请求文件进程证据',
t(0,43,'正常任务',36,C.green,750)+t(508,43,'拒绝任务',36,C.red,750)+line('M476 76V650','line')+
[['请求顺序','先目录，后正文，再参考'],['实际产物','金额源码、测试、JSON 报告'],['真实执行','测试成功 + 独立金额断言']].map(([a,b],i)=>t(0,150+i*188,a,33,C.ink,700)+t(0,204+i*188,b,27,C.green)+line(`M0 ${239+i*188}h424`,'line')).join('')+
[['已加载正文','恶意权限声明仍然可见'],['当前权限','terminal 调用明确被拒绝'],['零额外效果','无脚本启动、计数或输出']].map(([a,b],i)=>t(508,150+i*188,a,33,C.ink,700)+t(508,204+i*188,b,27,C.red)+line(`M508 ${239+i*188}h444`,'line')).join('')),
'还要确认无关技能正文未泄漏、工具调用与结果完整配对。完整边界矩阵、实际模型身份和失败记录见验收文档；一次选对不等于模型总能自动找到所有相关技能。',['T01','T02','T03','D01']);

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
  const cover=`<div class="cover-frame"><header class="page-header"><span>Zero2Agent · 扩展能力</span><span class="page-number">E05-S002</span></header><div class="series-masthead" data-block><h1 class="series-title">从零到一做 <span>Agent</span></h1><p class="series-description" data-prose>亲手实现 Coding Agent · 开源实战课程</p><h2 class="lesson-title">Skills 的发现与按需加载</h2><p class="lesson-promise" data-prose>先看到技能目录，需要时再读完整步骤。</p></div><div class="series-body">${p.body}<p class="explain" data-block data-prose>${esc(p.note)}</p></div><div class="cover-tags"><span>三层披露</span><span>当前权限</span><span>开源课程</span></div></div>`;
  fs.writeFileSync(p.file,`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=1080"><title>${esc(p.title.replaceAll('\n',''))}</title><link rel="stylesheet" href="course.css"></head><body><main class="sheet ${i===0?'cover series-cover':''}" data-page="${number}">${i===0?cover:header+heading+content}</main></body></html>\n`);
}
fs.writeFileSync('pages.json',JSON.stringify({title:'Zero2Agent · E05-S002 Skills 的发现与按需加载',date:'2026-10-17',draft:true,publicationStatus:'unpublished',width:1080,height:1440,maxImages:18,edition:'skills-on-demand',pages:pages.map((p,i)=>({file:p.file,title:p.title.replaceAll('\n',''),number:i+1,sources:p.sources}))},null,2)+'\n');
