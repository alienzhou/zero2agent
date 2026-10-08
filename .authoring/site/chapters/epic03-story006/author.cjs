// E03-S006 editable diagrams. Generated through pnpm site:build; no external assets.
const fs = require('node:fs');
const C = {ink:'#202622',paper:'#F4F1EA',muted:'#596057',line:'#C9CDC2',white:'#FFFEF9',soft:'#E7EADF',green:'#28614D',greenBg:'#E0EBDF',red:'#B53830',redBg:'#F2DED7',amber:'#896016',amberBg:'#F0E5C9'};
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const t=(x,y,s,size=34,color=C.ink,weight=400,anchor='start',mono=false)=>`<text x="${x}" y="${y}" fill="${color}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" ${mono?'class="mono"':''}>${esc(s)}</text>`;
const ls=(x,y,ss,size=34,color=C.ink,weight=400,anchor='start',gap=50,mono=false)=>ss.map((s,i)=>t(x,y+i*gap,s,size,color,weight,anchor,mono)).join('');
const box=(x,y,w,h,fill=C.white,stroke=C.line,r=12,dash='')=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="2" ${dash?`stroke-dasharray="${dash}"`:''}/>`;
const line=(d,color=C.ink,arrow=false,dash='')=>`<path d="${d}" class="edge" stroke="${color}" ${arrow?`marker-end="url(#${Object.keys(C).find(k=>C[k]===color)||'ink'})"`:''} ${dash?`stroke-dasharray="${dash}"`:''}/>`;
const dot=(x,y,r=10,color=C.red)=>`<circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/>`;
const ring=(x,y,r=34,fill=C.paper,stroke=C.ink)=>`<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="3"/>`;
const chip=(x,y,w,s,tone='green')=>box(x,y,w,50,C[tone+'Bg'],C[tone],25)+t(x+w/2,y+35,s,28,C[tone],650,'middle');
const num=(x,y,n)=>ring(x,y,24,C.ink,C.ink)+t(x,y+10,n,28,C.paper,700,'middle');
const smallTerminal=(x,y,w,h,content,status='')=>box(x,y,w,h,C.ink,C.ink,12)+dot(x+22,y+22,4,C.red)+dot(x+38,y+22,4,C.amber)+dot(x+54,y+22,4,C.green)+ls(x+24,y+68,content,29,C.paper,400,'start',47,true)+(status?t(x+24,y+h-25,status,26,'#BAC8B8'): '');
const doc=(x,y,w=90,h=118,tone='ink')=>`<path d="M${x} ${y}h${w-22}l22 22v${h-22}h-${w}Z M${x+w-22} ${y}v22h22" fill="${C.white}" stroke="${C[tone]}" stroke-width="3"/>`+line(`M${x+18} ${y+h*.40}h${w-36}M${x+18} ${y+h*.58}h${w-36}M${x+18} ${y+h*.76}h${w-48}`,C[tone]);
const svg=(label,body,h=790)=>`<svg class="diagram" viewBox="0 0 952 ${h}" width="952" height="${h}" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title><defs>${Object.entries(C).map(([k,v])=>`<marker id="${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="${v}"/></marker>`).join('')}</defs>${body}</svg>`;
const pages=[];
const page=(file,section,title,deck,body,note,sources,extra='')=>pages.push({file,section,title,deck,body,note,sources,extra});

page('01-cover.html','文件 Checkpoint 与回退','改错了，\n怎样安全退回？','E03-S006 · 让文件回退可控、存储有界',svg('一次文件编辑保存旧版本和新版本的去重内容块，用户预览检查后恢复旧文件',
smallTerminal(0,15,952,160,['Agent › theme=light → theme=dark','你 › 查看差异，再确认回退'])+
[[24,'旧文件','A · B · C'],[508,'新文件','A · D · C']].map(([x,a,b])=>box(x,263,420,184,C.white,C.line)+t(x+26,317,a,36,C.ink,700)+t(x+26,387,b,37,C.green,650)).join('')+
line('M236 469V533H476V583',C.green,true)+line('M718 469V533H476',C.green)+
box(123,606,706,140,C.greenBg,C.green)+t(476,664,'只保存 A、B、C、D 四个块',38,C.green,700,'middle')+t(476,718,'预览 → 检查冲突 → 回退',32,C.ink,550,'middle')),
'教学示意：实际块按内容分界。只捕获受控文件工具，任意 shell 与外部副作用不在范围内。',['S01','S02'],'cover');

page('02-boundary.html','先划清恢复范围','文件退回去了，\n其他状态怎样处理？','文件、会话与日志关联；进程和外部状态不随之回退。',svg('文件清单保存前后版本，会话保留工具调用回执并追加恢复事实，日志只记录元信息，命令进程与外部请求不被回退',
[[66,'文件 Checkpoint','保存 before / after，只恢复受控路径','green'],[230,'会话与工具回执','保留原史，追加恢复事实并重新读文件','ink'],[394,'运行日志','调用 ID 关联元信息，不写入文件正文','ink'],[558,'命令、人工终端与外部服务','不捕获任意 shell，也不撤销外部请求','red']].map(([y,a,b,c],i)=>num(27,y,i+1)+t(84,y+10,a,37,C[c],700)+t(84,y+75,b,30,C.muted)+line(`M84 ${y+118}H952`,C.line)).join('')+
t(0,756,'按一次文件工具调用记录，不是整轮时间旅行。',31,C.green,650)),
'三类记录通过 operationId / toolCallId 关联。独立 CLI 回退不改写其他会话；/new、取消与恢复会话也不会回退文件。',['D01','S01','S03','T03']);

page('03-options.html','比较存储方案','空间小、保存快、恢复稳，\n往往需要取舍','先看工作负载，再选存储结构。',svg('整仓副本、隐藏Git、文本补丁和分块内容寻址四种设计对比',
[[67,'整仓副本','无关文件也复制；空间随仓库增长。'],[236,'隐藏 Git 仓库','有成熟对象模型；仍需扫描与维护。'],[405,'仅存文本补丁','小改动紧凑；依赖基础版本与补丁链。'],[574,'按路径分块 CAS','只读涉及文件；块可复用，校验有成本。']].map(([y,a,b],i)=>num(28,y,i+1)+t(85,y+12,a,37,i===3?C.green:C.ink,700)+t(85,y+75,b,29,C.muted)+line(`M85 ${y+125}H952`,C.line)).join('')),
'CAS 是按内容哈希寻址。本课不调用 Git 保存或恢复；也不宣称总比 Git pack 更省，实测比较的是明确标注的存储基线。',['R01','R02','D01']);

page('04-boundary-hook.html','Core 与宿主的连接','通知可以丢，\n写入前的保护必须等待','把 Checkpoint 接成控制接口，而不是日志回调。',svg('模型调用先权限审批，再等待before存储，然后执行工具，最后记录实际after；失败分支阻止写入',
[[20,'1 权限允许','拒绝的工具没有文件效果'],[210,'2 保存 before','旧字节发布成功才继续'],[400,'3 执行真实工具','执行失败也可能已有部分效果'],[590,'4 保存实际 after','记录磁盘事实，不能相信回答文字']].map(([y,a,b],i)=>box(150,y,802,137,i===1?C.greenBg:C.white,i===1?C.green:C.line)+t(178,y+53,a,36,C.ink,700)+t(178,y+106,b,29,C.muted)+(i<3?line(`M80 ${y+65}V${y+215}`,C.green,true):'')+num(80,y+40,i+1)).join('')),
'FileMutationHandler 会被等待，异常会变成配对工具错误；展示 observer 继续保持不影响执行。取消在等待后再次检查。',['S01','T01']);

page('05-scope.html','只触碰相关路径','改一个文件，\n不用扫描整个仓库','可信工具元数据给出完整的受控路径集合。',svg('write_file replace_in_file delete输入声明路径映射同一存储入口，terminal没有自动路径映射',
[[91,'write_file','path'],[227,'replace_in_file','path'],[363,'delete','paths[]']].map(([y,a,b])=>t(0,y,a,33,C.ink,650,'start',true)+line(`M350 ${y-10}H480`,C.green,true)+chip(520,y-40,360,b)).join('')+
line('M0 457H952',C.line)+t(0,529,'terminal / 人工终端',38,C.amber,700)+ls(0,599,['命令可能写任意文件，也可能影响外部服务。','不解析命令字符串猜测文件列表。','要自动回退文件编辑，应使用专用工具。'],31,C.muted,400,'start',67)),
'只读工具和拒绝调用不会产生记录。第三方工具只有明确声明其全部写入路径，才可以接入这一契约。',['S01','R03']);

page('06-chunks.html','内容定义分块','前面插入一行，\n后面的块还能复用','固定偏移切块会让后续边界整体移动。',svg('原文件A B C D和插入后X A尾部 B C D的分块示意，内容边界重新对齐后B C D可复用',
t(0,62,'原文件',38,C.ink,700)+[[0,'A'],[244,'B'],[488,'C'],[732,'D']].map(([x,s])=>box(x,106,220,105,C.greenBg,C.green)+t(x+110,172,s,44,C.green,700,'middle')).join('')+
t(0,330,'前部插入后',38,C.ink,700)+box(0,375,220,105,C.redBg,C.red)+t(110,441,'A′',44,C.red,700,'middle')+[[244,'B'],[488,'C'],[732,'D']].map(([x,s])=>box(x,375,220,105,C.greenBg,C.green)+t(x+110,441,s,44,C.green,700,'middle')).join('')+
[[354],[598],[842]].map(([x])=>line(`M${x} 228V357`,C.green,true,'7 8')).join('')+
box(0,592,952,165,C.soft,C.line)+t(28,652,'新边界由附近字节决定，可能重新对齐。',34,C.ink,650)+t(28,715,'不是承诺每次修改都只新增一个块。',31,C.muted)),
'图是边界示意，不是指定文件的真实分块。重复字节、随机内容和插入位置会改变复用率，必须测实际工作负载。',['S02','T02']);

page('07-algorithm.html','分块算法','先限制块大小，\n再计算内容地址','本课用有上下界的 Gear 滚动哈希。',svg('数据字节经过滚动哈希，最小16KiB掩码命中或者最大256KiB时切块，随后SHA256压缩去重',
box(0,20,952,112,C.white,C.ink)+t(32,87,'rolling = (rolling << 1) + gear[byte]',30,C.ink,650,'start',true)+
line('M476 152V215',C.green,true)+box(0,236,952,167,C.greenBg,C.green)+t(30,299,'至少 16 KiB 后，低 16 位为零可切块',34,C.green,650)+t(30,363,'到 256 KiB 必须切块；末块可以更小',33,C.ink)+
line('M476 424V487',C.green,true)+[[0,'SHA-256'],[329,'deflate 3'],[658,'只存新块']].map(([x,s])=>box(x,512,294,95,C.white,C.line)+t(x+147,573,s,31,C.ink,650,'middle')).join('')+
ls(0,697,['哈希负责校验与寻址；滚动哈希只决定边界。','压缩后的块仍需限制解压后的最大长度。'],30,C.muted,400,'start',60)),
'64 KiB 是边界掩码对应的量级，不是每块都恰好 64 KiB，也不是含最小长度后的严格平均值。',['S02']);

page('08-manifest.html','恢复所需的数据','只保存内容块，\n还不够恢复一个文件','清单保存顺序、缺失状态、长度与权限。',svg('manifest记录id状态路径beforeafter，文件版本记录有序块完整sha长度mode，块池去重',
smallTerminal(0,10,952,304,['record: UUID / sequence / state','toolCallId / operationId / sessionId','path: src/config.ts','before: { hash, size, mode, chunks }','after:  { hash, size, mode, chunks }'])+
line('M476 334V397',C.green,true)+[[0,'A'],[329,'B'],[658,'C']].map(([x,s])=>doc(x+96,428,94,114,'green')+t(x+144,602,`块 ${s}`,34,C.green,700,'middle')).join('')+
box(0,672,952,104,C.amberBg,C.amber)+t(29,716,'null 表示当时文件不存在；空内容仍是文件。',31,C.amber,650)+t(29,757,'创建、覆盖、删除必须区别处理。',29,C.muted)),
'只记录普通文件的字节与 rwx 权限；不保存所有者、ACL、扩展属性或目录元信息。软链接与硬链接明确拒绝。',['S02','T02']);

page('09-bounds.html','容量与清理','有去重，也要有上限','不让历史无限增长，也不静默关闭保护。',svg('本课五种预算为单文件32MiB单操作64MiB最多128路径最多50条30天存储256MiB，对已完成记录回收不再引用的块',
[[68,'单文件','32 MiB'],[208,'单次调用','64 MiB / 128 路径'],[348,'完成记录','最近 50 条 / 30 天'],[488,'工作区存储','256 MiB / 16,384 块']].map(([y,a,b])=>t(0,y,a,36,C.ink,700)+t(430,y,b,33,C.green,650)+line(`M0 ${y+49}H952`,C.line)).join('')+
box(0,610,952,160,C.redBg,C.red)+t(29,669,'容量不足 → 拒绝新的受保护写入',35,C.red,700)+t(29,730,'未结算记录保留；清理不删除恢复证据。',31,C.ink)),
'每次捕获前按保留策略清理，/checkpoint-prune 可手动触发。数字是默认边界；字节预算预留 manifest，分配字节统计不含目录本身。',['S02','T02']);

page('10-gc.html','回收的正确顺序','删掉记录后，\n才能判断哪些块不用了','两个文件相同的内容，也能引用同一个块。',svg('两条记录共享块B，删除第一条后只能回收A，B仍被第二条使用，先同步引用删除再删除块',
box(0,50,395,110,C.redBg,C.red)+t(198,120,'记录 1：A · B',34,C.red,700,'middle')+box(557,50,395,110,C.greenBg,C.green)+t(754,120,'记录 2：B · C',34,C.green,700,'middle')+
line('M190 180V276H123V349',C.red,true)+line('M250 180V250H476V349',C.red,true)+line('M680 180V250H476',C.green)+line('M780 180V280H829V349',C.green,true)+
[[0,'A','可回收','red'],[353,'B','仍共享','green'],[706,'C','仍使用','green']].map(([x,a,b,c])=>box(x,371,246,175,C[c+'Bg'],C[c])+t(x+123,438,a,43,C[c],700,'middle')+t(x+123,502,b,31,C.ink,550,'middle')).join('')+
ls(0,663,['删除过期清单 → 同步目录 → 扫描剩余引用','只删除没有引用的对象；损坏清单使清理失败。'],31,C.muted,400,'start',66)),
'清理只扫描有界存储目录，不扫描工作区文件。未结算清单是保留根；它引用的 before 块不能按普通过期历史删除。',['S02']);

page('11-pending.html','写入中断','少了一份 after，\n不能推断文件没变','before 发布后才执行，异常结算仍需要读磁盘。',svg('持久化before后工具发生副作用，再保存after；崩溃可发生在任意两者之间，pending只能说明结果未知',
[[28,'before 已保存','pending'],[265,'工具修改了文件','真实副作用'],[502,'after 已保存','ready']].map(([y,a,b],i)=>box(0,y,952,149,i===1?C.amberBg:C.greenBg,i===1?C.amber:C.green)+t(29,y+62,a,39,C.ink,700)+t(29,y+117,b,30,i===1?C.amber:C.green,600,'start',true)+(i<2?line(`M476 ${y+167}V${y+214}`,C.ink,true):'')).join('')+
t(0,751,'/recover 预览当前文件，再明确选择恢复旧版本。',30,C.red,650)),
'未结算记录会阻止新的受保护写入。恢复不重放旧工具，且需确认原进程已退出；PID 无法确认时拒绝猜测。',['S02','T02']);

page('12-conflict.html','三方比较','用户后来又改了文件，\n回退必须先停下来','before 是目标；after 是允许替换的预期状态。',svg('before旧版本after工具结果live当前文件三个版本比较，live等于after则可回退，不等则冲突',
[[0,'before','theme=light'],[330,'after','theme=dark'],[660,'live','theme=human']].map(([x,a,b])=>box(x,30,292,167,x===2?C.redBg:C.white,x===2?C.red:C.line)+t(x+25,85,a,35,C.ink,700,'start',true)+t(x+25,151,b,25,C.ink,550,'start',true)).join('')+
line('M476 222V314H806V222',C.red)+t(646,374,'after ≠ live',38,C.red,700,'middle',true)+
box(0,459,952,154,C.redBg,C.red)+t(29,523,'拒绝覆盖后续修改',42,C.red,700)+t(29,579,'全部文件预检；确认时再次计算摘要。',31,C.ink)+
t(0,727,'预览令牌绑定清单与当前文件；过期就重新预览。',30,C.muted)),
'没有 force 覆盖入口。检查覆盖内容与 rwx 权限；相同内容但不同权限也会被判为变化。普通文件 API 不能隔离任意并发写入。',['S02','T02']);

page('13-restore.html','回退也会失败','先写恢复意图，\n再逐个替换文件','多文件回退不是一次原子事务。',svg('恢复意图记录from/to，文件A完成文件B未完成；重启后检查live若已为目标跳过若仍为from继续否则冲突',
box(0,10,952,127,C.greenBg,C.green)+t(29,65,'先持久化：每个文件的 from / to',35,C.green,700)+t(29,112,'回退自身拥有新的 UUID，可再 /undo。',29,C.ink)+
line('M476 157V218',C.green,true)+box(0,239,420,147)+t(25,299,'文件 A · 已替换',36,C.green,700)+t(25,353,'live = to',30,C.muted,500,'start',true)+box(532,239,420,147,C.amberBg,C.amber)+t(557,299,'文件 B · 中断',36,C.amber,700)+t(557,353,'live = from',30,C.muted,500,'start',true)+
[[495,'live = to','已达到目标，跳过'],[600,'live = from','重新校验后继续'],[705,'其他状态','冲突，停止写入']].map(([y,a,b],i)=>t(0,y,a,32,C.ink,650,'start',true)+line(`M365 ${y-10}H435`,i===2?C.red:C.green,true)+t(474,y,b,32,i===2?C.red:C.green,650)).join('')),
'普通文件使用同目录临时文件、同步与替换；新建用不覆盖的发布方式。恢复删除文件时可能留下空目录，不能承诺目录树完全回到过去。',['S02','T02']);

page('14-paths.html','边界与数据保护','可恢复数据本身，\n也需要保护','Checkpoint 有文件正文，隐私边界不同于运行日志。',svg('工作区普通文件可记录，软硬链接元数据依赖凭据路径排除，存储目录700文件600，哈希校验不等于加密',
[[79,'工作区边界','真实路径与每层祖先检查'],[250,'拒绝危险类型','软链接 / 硬链接 / 非普通文件'],[421,'排除常见敏感路径','.git / node_modules / .env* / *.key'],[592,'本地私有权限','目录 0700 · 文件 0600']].map(([y,a,b],i)=>num(28,y,i+1)+t(85,y+10,a,37,C.ink,700)+t(85,y+75,b,30,i===2?C.red:C.muted)+line(`M85 ${y+121}H952`,C.line)).join('')),
'正文未加密；常见路径排除不是秘密识别器。关闭开关是 --no-checkpoints。与会话、日志独立，不会自动改变权限策略。',['S02','D01']);

page('15-tui.html','完整的交互路径','看清差异，\n再决定是否回退','专用查看器承接文件列表，避免混入聊天输入。',svg('Checkpoint列表Enter到差异r到确认预览y执行nEnterEsc取消，草稿保持且粘贴不能确认',
smallTerminal(0,5,952,185,['/checkpoints','› write_file · settings.txt'],'Enter 查看差异 · Esc 返回')+
line('M476 195V235',C.green,true)+smallTerminal(0,256,952,173,['--- settings.txt  +++ settings.txt','-theme=light     +theme=dark'],'r 预览回退 · PgUp/PgDn 翻阅')+
line('M476 449V489',C.green,true)+smallTerminal(0,510,952,173,['确认文件回退 · 检查冲突和范围','y 确认回退 · n / Enter 取消'],'Esc / Ctrl-C 返回 · 草稿保留')+
t(0,760,'弹层粘贴不会确认，也不会成为模型输入。',31,C.green,650)),
'实际 PTY 验证列表、差异、预览、默认取消、粘贴隔离、确认和窄窗口。图为教学重排，真实终端输出另存验收附件。',['S03','T03']);

page('16-cli.html','无密钥也能恢复','把回退拆成\n预览和确认两次命令','同一套文件校验服务于 TUI、plain 和单次 CLI。',svg('CLI列表差异预览确认与统计五种调用路径不需要模型服务',
[[58,'--checkpoints','列出当前工作区的记录'],[200,'--checkpoint UUID','查看保存的 before / after 差异'],[342,'--undo UUID','打印回退计划与确认令牌'],[484,'--undo UUID --confirm HASH','重新校验令牌并执行'],[626,'--checkpoint-stats','逻辑量 / 存储量 / 分配占用']].map(([y,a,b])=>t(0,y,a,30,C.ink,700,'start',true)+t(0,y+60,b,30,C.muted)+line(`M0 ${y+102}H952`,C.line)).join('')),
'--recover UUID 处理未结算记录；--checkpoint-prune 清理过期历史。命令返回前完成文件操作，不会调用模型、旧工具或恢复旧进程。',['S03','T03']);

page('17-benchmark.html','用数据检验取舍','占用降下来，\n不代表每项指标都更快','4 MiB 高熵文件，连续 20 次前部插入。',svg('三个柱形条显示全量文件副本160MiB整文件压缩CAS84MiB分块CAS约5.7MiB，保存耗时不做同保证横比',
[[103,'整文件副本',790,'160.0 MiB'],[303,'整文件压缩 CAS',414,'84.0 MiB'],[503,'内容分块 CAS',29,'约 5.7 MiB']].map(([y,a,w,b],i)=>t(0,y,a,34,C.ink,700)+box(0,y+30,w,51,i===2?C.green:C.soft,i===2?C.green:C.line,0)+t(950,y+70,b,30,i===2?C.green:C.muted,650,'end')).join('')+
ls(0,695,['本机分块保护保存中位约 0.16 秒。','基线无同等校验与同步保证，不作吞吐胜负。'],29,C.muted,400,'start',55)),
'这是首轮固定语料实测，数值随环境变化；分配占用约 6.0 MiB。未测 Git pack、网络卷和断电，完整参数及重跑结果见基准 JSON。',['B01']);

page('18-practice.html','跟练与下一阶段','先真的改一个文件，\n再验证能退回和重做','无需密钥；真实文件闭环收束 Epic 3。',
'<div class="terminal" data-block><p class="mini">构建后运行 · 临时目录自动清理</p><pre>node scripts/e03-s006-checkpoint-demo.mjs\nnode scripts/e03-s006-checkpoint-demo.mjs --tui</pre></div>'+svg('练习步骤是执行修改观察差异回退再撤销回退最后用手工修改制造冲突',
[[65,'A 修改 settings.txt','light → dark，核对真实字节。'],[212,'B 预览与回退','确认令牌后恢复 light；再撤销回退。'],[359,'C 制造手工修改','改成 human，旧令牌必须失败。']].map(([y,a,b],i)=>num(28,y,i+1)+t(84,y+11,a,36,C.ink,700)+t(84,y+72,b,30,C.muted)).join('')+t(0,537,'固定 Tag：E03-S006-file-checkpoints-18p',30,C.green,650),578),
'核对文件字节与无新增请求；离线夹具不等于真实模型验收。Epic 3 已串起可见、可控、可续、可查、可退；下一阶段为 Epic 4 健壮性与上下文管理（规划）。',['D02','T03','D01','D03']);

if(pages.length > 18) throw new Error('Single image post allows at most 18 pages, including cover');
for(const [i,p] of pages.entries()){
 const number=String(i+1).padStart(2,'0');
 const header=`<header class="page-header"><span>Zero2Agent · ${p.section}</span><span class="page-number">${number}</span></header>`;
 const heading=`<div class="heading" data-block><h1>${esc(p.title).replaceAll('\n','<br>')}</h1><p class="deck" data-prose>${esc(p.deck)}</p></div>`;
 const content=`<div class="content">${p.body}${p.note?`<p class="explain" data-block data-prose>${esc(p.note)}</p>`:''}</div>`;
 const inner=i===0?`<div class="cover-frame"><header class="page-header"><span>Zero2Agent · 从循环到产品</span><span class="page-number">E03-S006</span></header><div class="series-masthead" data-block><h1 class="series-title">从零到一做 <span>Agent</span></h1><p class="series-description" data-prose>亲手实现 Coding Agent · 开源实战课程</p><h2 class="lesson-title">${esc(p.section)}</h2><p class="lesson-promise" data-prose>改错可退回，存储有上限</p></div><div class="series-body">${p.body}<p class="explain" data-block data-prose>${esc(p.note)}</p></div><div class="cover-tags"><span>工程实战</span><span>交互设计</span><span>开源课程</span></div></div>`:header+heading+content;
 fs.writeFileSync(p.file,`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=1080"><title>${esc(p.title.replaceAll('\n',''))}</title><link rel="stylesheet" href="course.css"></head><body><main class="sheet ${p.extra}${i===0?' series-cover':''}" data-page="${number}">${inner}</main></body></html>\n`);
}
fs.writeFileSync('pages.json',JSON.stringify({title:'Zero2Agent · E03-S006 文件 Checkpoint 与回退',date:'2026-10-08',draft:false,publicationStatus:'unpublished',width:1080,height:1440,maxImages:18,edition:'v2-18-pages',pages:pages.map((p,i)=>({file:p.file,title:p.title.replaceAll('\n',''),number:i+1,sources:p.sources}))},null,2)+'\n');
