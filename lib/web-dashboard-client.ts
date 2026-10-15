/** Browser code is embedded in the package; the dashboard has no CDN dependencies. */
export const DASHBOARD_CLIENT = String.raw`
(function () {
  'use strict';
  const config = window.__CMA;
  let lang = config.locale;
  try { lang = localStorage.getItem('cma.locale') || lang; } catch (_) {}
  lang = lang === 'zh' ? 'zh' : 'en';
  let data = null, eventSource = null, connected = false, busy = false, pollTimer = null, pollId = null;
  const $ = id => document.getElementById(id);
  const copy = {
    title: ['Account pool', '账号池管理'], subtitle: ['Live status and account management', '实时状态 · 配额观察 · 账号管理'],
    connecting: ['Connecting…', '连接中…'], connected: ['Live', '实时连接'], offline: ['Reconnecting…', '正在重连…'],
    refresh: ['Refresh view', '刷新视图'], check: ['Check & refresh quota', '检查并刷新配额'], add: ['Add account', '新增账号'],
    import: ['Import backup', '导入备份'], export: ['Download backup', '下载备份'], accounts: ['Subscription accounts', '订阅账号'],
    total: ['Total', '总账号'], ready: ['Ready', '可用'], login: ['Re-login needed', '需重新登录'], blocked: ['Unavailable', '暂不可用'],
    disabled: ['Disabled', '已禁用'], paused: ['Paused', '已暂停'], drained: ['Drained', '已排空'], recommend: ['Recommended', '推荐账号'],
    current: ['Current', '当前'], selected: ['Selected', '已选中'], 'in-use': ['In use', '使用中'], 'strict pin': ['Pinned', '已固定'],
    'rate-limited': ['Rate limited', '限流中'], 'quota-exhausted': ['Quota exhausted', '配额已用尽'],
    switch: ['Switch & pin', '切换并固定'], unpin: ['Return to automatic routing', '恢复自动轮换'],
    pause: ['Pause', '暂停'], unpause: ['Resume', '恢复'], drain: ['Drain', '排空'], undrain: ['Undo drain', '解除排空'],
    enable: ['Enable', '启用'], disable: ['Disable', '禁用'], delete: ['Remove account', '移除账号'], relogin: ['Re-login', '重新登录'],
    'auto-prime': ['Automatic priming', '自动预热'], priority: ['Priority (0–9; lower first)', '优先级（0–9，数值小的优先）'],
    weight: ['Weight (0–10)', '权重（0–10）'], note: ['Note', '备注'], tag: ['Add tag', '添加标签'], untag: ['Remove tag', '移除标签'],
    workspace: ['Select workspace', '选择工作区'], more: ['More settings', '更多管理'], save: ['Save', '保存'], cancel: ['Cancel', '取消'],
    close: ['Close', '关闭'], continue: ['Continue', '确认'], done: ['Saved successfully', '操作成功'], working: ['Working…', '正在处理…'],
    used: ['used', '已使用'], remaining: ['remaining', '剩余'], primary: ['Primary window', '主窗口'], secondary: ['Secondary window', '次窗口'],
    reset: ['Resets', '重置时间'], observed: ['Quota updated', '配额更新'], stale: ['Quota is over 30 minutes old; run a check.', '配额缓存已超过 30 分钟，请运行检查。'],
    unknown: ['Unknown', '未知'], never: ['Not recorded', '未记录'], empty: ['No accounts yet. Add an account or import a backup to begin.', '号池为空，请新增账号或导入备份。'],
    routing: ['Routing', '路由'], active: ['Saved selection', '保存的选中账号'], runtimeActive: ['Account serving now', '当前运行账号'],
    pin: ['Manual pin', '手动固定'], auto: ['Automatic', '自动轮换'], reason: ['Reason', '原因'], runtime: ['Runtime', '运行时'],
    requests: ['Requests', '请求数'], success: ['Successful', '成功'], failed: ['Failed', '失败'], last: ['Last inference', '最近推理'],
    risk: ['Risk', '风险'], low: ['Low', '低'], medium: ['Medium', '中'], high: ['High', '高'],
    search: ['Search accounts, tags or notes', '搜索账号、标签或备注'], filter: ['Filter', '筛选'], all: ['All accounts', '全部账号'],
    noMatch: ['No matching accounts', '没有匹配的账号'], priorityShort: ['Priority', '优先级'], weightShort: ['Weight', '权重'],
    on: ['Enabled', '已开启'], off: ['Disabled', '已关闭'],
    foot: ['Local state updates every few seconds. Quota reflects the latest check or inference response.', '页面每隔数秒读取本机状态；配额来自最近一次检查或推理响应。'],
    loginHelp: ['Open the official page, enter the code and authorize one account. Use a private browser window to choose another account.', '打开官方登录页，输入设备码并授权一个账号。添加其他账号时可使用无痕窗口。'],
    code: ['Device code', '设备码'], waiting: ['Waiting for browser authorization (up to 15 minutes)…', '等待浏览器授权（最长约 15 分钟）…'],
    loginDone: ['Account saved. The previous routing selection is preserved.', '账号已保存，原有路由选择保持不变。'],
    cancelled: ['Operation cancelled', '操作已取消'], cancelOperation: ['Cancel operation', '取消操作'], openLogin: ['Open sign-in page', '打开登录页'],
    checkDone: ['Account check completed; quota refreshed.', '账号检查已完成，配额已刷新。'],
    checkHelp: ['Checks credentials and requests current quota. This may take a few minutes.', '检查登录凭证并读取当前配额，可能需要几分钟。'],
    importHelp: ['Choose a codex-multi-auth JSON backup. Accounts are merged and deduplicated; the existing pool is preserved.', '选择 codex-multi-auth JSON 备份，合并并去重导入；已有账号会保留。'],
    file: ['JSON backup file (up to 4 MiB)', 'JSON 备份文件（最大 4 MiB）'],
    exportHelp: ['This backup includes login credentials. Save it only to a trusted device.', '备份包含登录凭证，请只保存到可信设备。'],
    deleteHelp: ['Remove this account from this local pool? Its subscription is unaffected.', '确认将此账号移出本机号池？此操作不会取消订阅。'],
    primeHelp: ['Priming may consume quota and start subscription reset windows.', '开启预热后可能消耗配额并启动订阅重置计时。'],
    pauseHelp: ['Paused accounts are excluded from new routing choices until resumed.', '暂停的账号会退出新请求的路由候选，恢复后重新参与。'],
    drainHelp: ['Drained accounts are excluded from routing until you undo drain.', '排空后账号会退出路由，解除排空后重新参与。'],
    switchHelp: ['Pin new requests to this account. Clear the pin to restore automatic routing.', '将后续请求固定到此账号；恢复自动轮换可取消固定。'],
    noteHelp: ['Up to 500 characters; leave empty to clear.', '最多 500 字，留空可清除备注。'],
    imported: ['Import complete', '导入完成'], apiAccounts: ['API/ZDR routes', 'API/ZDR 路由'],
    unauthorized: ['Access expired. Reopen the full URL printed by the web command.', '访问令牌无效，请重新打开 web 命令打印的完整链接。'],
    account_changed: ['The account pool changed. Refresh and retry.', '号池已变化，请刷新后重试。'], invalid_account: ['Select an account and retry.', '请选择账号后重试。'],
    invalid_value: ['Check the value and retry.', '参数无效，请检查后重试。'], invalid_backup: ['Invalid account backup; no accounts were imported.', '账号备份格式无效，未导入任何账号。'],
    invalid_json: ['Invalid JSON.', 'JSON 格式无效。'], body_too_large: ['The backup exceeds 4 MiB.', '备份文件超过 4 MiB。'],
    operation_busy: ['A check or login is already running. Finish or cancel it before this operation.', '已有检查或登录正在运行，请完成或取消后再执行此操作。'],
    login_failed: ['Login failed. Check the proxy and retry; use CLI login for detailed diagnostics.', '登录失败，请检查代理后重试；可用终端登录查看详细诊断。'],
    check_failed: ['Check failed. Check connectivity and retry.', '检查失败，请检查网络连接后重试。'],
    operation_timeout: ['Operation timed out. Check connectivity and retry.', '操作超时，请检查网络后重试。'],
    operation_missing: ['Operation no longer exists. Start again.', '操作已失效，请重新发起。'],
    process_failed: ['Unable to start the CLI process.', '无法启动 CLI 进程。'],
    status_unavailable: ['Unable to read local pool state.', '无法读取本机号池状态。'],
    operation_failed: ['Operation failed. Refresh and retry; CLI diagnostics may provide more detail.', '操作失败，请刷新后重试；终端诊断可提供更多详情。'],
    identity_missing: ['This account needs a valid identity; import it again or add it through device login.', '账号缺少身份信息，请重新导入或通过设备登录添加。'],
    confirmation_required: ['Confirm this operation first.', '请先确认此操作。'], no_accounts: ['No accounts configured.', '尚未配置账号。'],
    network_error: ['Connection failed. Check that the web service is running.', '连接失败，请检查网页服务是否仍在运行。']
  };
  const t = key => (copy[key] || copy.operation_failed)[lang === 'zh' ? 1 : 0];
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const api = path => path + '?token=' + encodeURIComponent(config.token);
  async function request(path, payload) {
    let response;
    try { response = await fetch(api(path), payload ? {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(payload)} : {cache:'no-store'}); }
    catch (_) { throw Error('network_error'); }
    const result = await response.json();
    if (!response.ok || result.ok === false) throw Error(response.status === 401 ? 'unauthorized' : result.error || 'operation_failed');
    return result;
  }
  const action = payload => request('/api/actions', payload);
  function notice(message, error) {
    $('notice').textContent = message;
    $('notice').className = error ? 'error' : 'notice';
    $('notice').hidden = false;
  }
  const failed = e => notice(t(e.message), true);
  function label(value) {
    const s = String(value == null ? '' : value);
    if (lang !== 'zh') return s;
    return s.replace(/^Account /, '账号 ').replace(/Token account/g,'令牌账号').replace(/Unknown plan/g,'未知套餐')
      .replace(/Stored binding \(workspace unknown\)/g,'已存绑定（工作区未知）').replace(/Unnamed workspace/g,'未命名工作区')
      .replace(/Invalid workspace selection/g,'工作区选择无效').replace(/Business/g,'商业版').replace(/Enterprise/g,'企业版').replace(/Edu/g,'教育版');
  }
  function reason(value) {
    const s = String(value || '—');
    if (lang !== 'zh' || s === '—') return s;
    const exact = {'token-invalid — re-login needed':'令牌无效，需要重新登录','account is disabled':'账号已禁用','runtime policy blocked account':'账号被运行时策略阻止','quota cache exhausted':'配额缓存显示已用尽','live probe returned 429':'实时探测返回限流','No recommendation available.':'暂无推荐账号。'};
    if (exact[s]) return exact[s];
    if (copy[s]) return t(s);
    if (/^primary quota (.+) used$/.test(s)) return s.replace(/^primary quota (.+) used$/, '主窗口配额已使用 $1');
    if (/^secondary quota (.+) used$/.test(s)) return s.replace(/^secondary quota (.+) used$/, '次窗口配额已使用 $1');
    const match = s.match(/^Lowest risk ready account \(([^,]+), score (\d+)\)\.$/);
    if (match) return '最低风险可用账号（' + t(match[1]) + '，分数 ' + match[2] + '）。';
    if (/^No account is immediately ready/.test(s)) return '当前没有立即可用账号，建议等待最短的账号。';
    if (/^All accounts are blocked|^No healthy accounts/.test(s)) return '当前所有账号均不可用。';
    if (/^hard auth failure/.test(s)) return '认证失败，需要重新登录。';
    if (/^refresh warning/.test(s)) return '凭证刷新异常，请检查登录状态。';
    if (/^runtime skip/.test(s)) return '运行时暂时跳过此账号。';
    if (/^cooldown|^rate limit|^quota resets/.test(s)) return '账号处于冷却或配额重置等待期。';
    return '账号暂不可用，请检查登录或运行终端诊断。';
  }
  function relative(at) {
    if (!at) return t('never');
    const delta = (at - Date.now()) / 1000;
    const scale = Math.abs(delta) < 60 ? ['second',1] : Math.abs(delta) < 3600 ? ['minute',60] : Math.abs(delta) < 86400 ? ['hour',3600] : ['day',86400];
    return new Intl.RelativeTimeFormat(lang === 'zh' ? 'zh-CN' : 'en', {numeric:'auto'}).format(Math.round(delta / scale[1]), scale[0]);
  }
  function state(a) {
    if (a.enabled === false) return 'disabled';
    if ((a.markers || []).some(m => /invalid|sign-in|re-login/.test(m))) return 'login';
    if (a.paused) return 'paused';
    if (a.drained) return 'drained';
    if ((a.subscription || {}).automaticBlock || (a.markers || []).some(m => /cooldown|rate-limited|quota-exhausted/.test(m))) return 'blocked';
    return 'ready';
  }
  function button(name, ref, title) { return '<button type="button" class="button small" data-action="'+name+'"'+(ref?' data-ref="'+esc(ref)+'"':'')+'>'+esc(title || t(name))+'</button>'; }
  function quota(window, name) {
    const known = window && Number.isFinite(window.usedPercent);
    const percent = known ? Math.max(0, Math.min(100,window.usedPercent)) : 0;
    const minutes = window && window.windowMinutes;
    const windowName = minutes > 0 ? (minutes % 1440 === 0 ? minutes/1440+(lang==='zh'?' 天':' days') : minutes % 60 === 0 ? minutes/60+(lang==='zh'?' 小时':' hours') : minutes+(lang==='zh'?' 分钟':' minutes')) : t(name);
    return '<div class="quota-row"><span>'+esc(windowName)+'</span><span>'+(known?percent.toFixed(0)+'% '+t('used')+' · '+(100-percent).toFixed(0)+'% '+t('remaining'):t('unknown'))+'</span></div>'+
      '<div class="bar" role="progressbar" aria-label="'+esc(windowName)+'" aria-valuemin="0" aria-valuemax="100"'+(known?' aria-valuenow="'+percent+'"':' aria-valuetext="'+t('unknown')+'"')+'><div class="fill'+(percent>=90?' danger':percent>=75?' warn':'')+'" style="width:'+percent+'%"></div></div>'+
      (window && window.resetAtMs?'<div class="label">'+t('reset')+'：'+esc(relative(window.resetAtMs))+'</div>':'');
  }
  function draw(next) {
    data = next;
    const all = data.accounts || [], counts = {total:all.length,ready:0,login:0,blocked:0};
    all.forEach(a => {const s=state(a);counts[s==='ready'?'ready':s==='login'?'login':'blocked']++;});
    const rec = data.recommendedIndex == null ? '—' : '#'+(data.recommendedIndex+1);
    $('summary').innerHTML = ['total','ready','login','blocked','recommend'].map(k=>'<div class="card"><div class="label">'+t(k)+'</div><div class="value '+({ready:'green',login:'red',recommend:'amber'}[k]||'blue')+'">'+(k==='recommend'?rec:counts[k])+'</div></div>').join('');
    const search = $('search').value.toLowerCase(), filter=$('filter').value;
    const shown = all.filter(a => (filter==='all'||state(a)===filter) && [a.label,a.note,(a.tags||[]).join(' ')].join(' ').toLowerCase().includes(search));
    $('accounts').innerHTML = shown.length ? shown.map(a=>{
      const s=state(a), sub=a.subscription||{}, q=a.quota||{}, ref=a.accountRef;
      const markers=(a.markers||[]).filter(m=>['current','selected','in-use','strict pin'].includes(m)).map(m=>'<span class="badge current">'+t(m)+'</span>').join(' ');
      const controls = button('switch',ref)+button(a.paused?'unpause':'pause',ref)+button(a.drained?'undrain':'drain',ref)+button('relogin',ref);
      const more = [a.enabled===false?'enable':'disable','auto-prime','priority','weight','note','tag','untag','workspace','delete'].map(k=>button(k,ref)).join('');
      return '<article class="account"><div class="account-head"><div><div class="account-name">'+esc(label(a.label||'#'+(a.index+1)))+'</div><div class="account-meta">'+esc(label(sub.planLabel||t('unknown')))+' · '+esc(label(sub.selectedWorkspace||''))+'</div></div><div class="badges">'+markers+' <span class="badge '+(s==='ready'?'ready':s==='login'?'login':'disabled')+'">'+t(s)+'</span></div></div>'+
        '<div class="account-stats"><div class="quota">'+quota(q.primary,'primary')+quota(q.secondary,'secondary')+'<div class="label">'+t('observed')+'：'+esc(relative(q.updatedAt))+'</div>'+(q.updatedAt&&Date.now()-q.updatedAt>1800000?'<div class="reason">'+t('stale')+'</div>':'')+'</div><div><div class="label">'+t('last')+'</div><div class="value" style="font-size:16px">'+esc(relative(a.lastInferenceRequestAt))+'</div><div class="reason">'+t('reason')+'：'+esc(reason(a.reason))+'</div></div><div class="risk"><div class="label">'+t('risk')+'</div><div class="risk-num risk-'+(['low','medium','high'].includes(a.forecastRiskLevel)?a.forecastRiskLevel:'medium')+'">'+(a.forecastRiskScore==null?'—':esc(a.forecastRiskScore)+'/100')+'</div></div></div>'+
        '<div class="account-meta">'+t('priorityShort')+' '+esc(a.priority)+' · '+t('weightShort')+' '+esc(a.weight)+' · '+t('auto-prime')+' '+t(a.autoPrime?'on':'off')+'</div>'+
        (a.note?'<div class="reason">'+t('note')+'：'+esc(a.note)+'</div>':'')+(a.tags||[]).map(tag=>'<span class="badge">'+esc(tag)+'</span>').join(' ')+
        '<div class="manage">'+controls+'</div><details><summary>'+t('more')+'</summary><div class="manage">'+more+'</div></details></article>';
    }).join('') : '<div class="empty">'+t(all.length?'noMatch':'empty')+'</div>';
    const kv=(name,value)=>'<div class="kv"><span>'+t(name)+'</span><b>'+esc(value)+'</b></div>';
    $('routing').innerHTML = kv('active',data.activeIndex==null?'—':'#'+(data.activeIndex+1))+kv('runtimeActive',data.runtimeInUseIndex==null?'—':'#'+(data.runtimeInUseIndex+1))+kv('pin',data.pinnedAccountIndex==null?t('auto'):'#'+(data.pinnedAccountIndex+1))+kv('recommend',rec)+'<div class="reason">'+esc(reason(data.recommendationReason))+'</div>'+button('unpin');
    const runtime=data.runtime||{};
    $('runtime').innerHTML=kv('requests',runtime.responsesRequests??'—')+kv('success',runtime.successfulRequests??'—')+kv('failed',runtime.failedRequests??'—');
    if ((data.apiAccounts||[]).length) $('runtime').innerHTML+=kv('apiAccounts',data.apiAccounts.length);
    $('updated').textContent=new Date().toLocaleTimeString(lang==='zh'?'zh-CN':'en');
  }
  async function load() { try {draw(await request('/api/status'));} catch(e) {failed(e);} }
  const dialog=$('manage-dialog');
  let submitAction=null;
  function modal(title, body, run, submitLabel) {
    $('modal-title').textContent=title;
    $('modal-body').innerHTML=body;
    $('modal-error').hidden=true;
    $('modal-submit').textContent=submitLabel||t('save');
    $('modal-submit').hidden=!run;
    $('modal-submit').disabled=false;
    submitAction=run;
    if (!dialog.open) dialog.showModal();
  }
  $('manage-form').addEventListener('submit',async e=>{
    e.preventDefault();
    if (!submitAction || busy) return;
    busy=true;$('modal-submit').disabled=true;
    try {await submitAction();dialog.close();notice(t('done'));await load();}
    catch(e) {$('modal-error').textContent=t(e.message);$('modal-error').hidden=false;}
    finally {busy=false;$('modal-submit').disabled=false;}
  });
  $('modal-close').onclick=()=>dialog.close();
  function field(type,value,attrs) {return '<input id="field" type="'+type+'" value="'+esc(value)+'" '+(attrs||'')+' autofocus>'}
  async function showOperation(id, kind) {
    clearTimeout(pollTimer);pollId=id;
    $('operation').hidden=false;
    $('operation-title').textContent=t(kind==='login'?'add':'check');
    $('operation-detail').textContent=t(kind==='login'?'waiting':'checkHelp');
    $('operation-cancel').hidden=false;
    const poll=async()=>{
      if(pollId!==id)return;
      try {
        const op=await request('/api/operations/'+encodeURIComponent(id));
        if(op.status==='awaiting-device') {
          $('operation-detail').innerHTML='<p>'+t('loginHelp')+'</p><div class="device-code">'+t('code')+' <strong>'+esc(op.code)+'</strong></div><a class="button" href="https://auth.openai.com/codex/device" target="_blank" rel="noopener noreferrer">'+t('openLogin')+'</a><p>'+t('waiting')+'</p>';
        }
        if(['completed','failed','cancelled'].includes(op.status)) {
          $('operation-detail').textContent=t(op.status==='completed'?(kind==='login'?'loginDone':'checkDone'):op.status==='cancelled'?'cancelled':op.error);
          $('operation-cancel').hidden=true;pollId=null;await load();return;
        }
        pollTimer=setTimeout(poll,1500);
      } catch(e) {$('operation-detail').textContent=t(e.message);pollTimer=setTimeout(poll,5000);}
    };
    void poll();
  }
  async function manage(name,ref) {
    const account=ref && data && (data.accounts||[]).find(a=>a.accountRef===ref);
    if(ref&&!account)throw Error('account_changed');
    const payload={action:name,accountRef:ref}, title=t(name)+(account?' · #'+(account.index+1):'');
    const saveValue=()=>action({action:'account',accountRef:ref,subcommand:name,value:$('field').value});
    if(name==='add'||name==='relogin') {
      modal(title,'<p>'+t('loginHelp')+'</p>',async()=>{const op=await action({action:'login',accountRef:ref||null});void showOperation(op.operationId,'login');},t('continue'));return;
    }
    if(name==='check') {const op=await action({action:'check'});void showOperation(op.operationId,'check');return;}
    if(name==='import') {
      modal(title,'<p>'+t('importHelp')+'</p><label for="field">'+t('file')+'</label><input id="field" type="file" accept="application/json,.json" required>',async()=>{
        const file=$('field').files[0];if(!file)throw Error('invalid_backup');if(file.size>4*1024*1024)throw Error('body_too_large');
        let backup;try {backup=JSON.parse(await file.text());}catch(_){throw Error('invalid_json');}await action({action:'import',backup:backup});
      },t('import'));return;
    }
    if(name==='export') {
      modal(title,'<p>'+t('exportHelp')+'</p>',async()=>{const result=await action({action:'export',confirm:true});const url=URL.createObjectURL(new Blob([JSON.stringify(result.backup,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='codex-multi-auth-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},t('export'));return;
    }
    if(name==='priority'||name==='weight') {modal(title,field('number',account[name]??1,'min="0" max="'+(name==='priority'?9:10)+'" step="'+(name==='priority'?1:0.1)+'" required'),saveValue);return;}
    if(name==='note') {modal(title,'<p>'+t('noteHelp')+'</p><textarea id="field" maxlength="500" rows="5">'+esc(account.note||'')+'</textarea>',saveValue);return;}
    if(name==='tag'||name==='untag') {
      const tags=account.tags||[];
      modal(title,name==='untag'?'<select id="field" required><option value="">—</option>'+tags.map(tag=>'<option>'+esc(tag)+'</option>').join('')+'</select>':field('text','','maxlength="64" required'),saveValue);return;
    }
    if(name==='workspace') {
      modal(title,'<select id="field" required>'+(account.workspaces||[]).map(w=>'<option value="'+w.index+'"'+(w.enabled?'':' disabled')+(w.index===account.currentWorkspaceIndex?' selected':'')+'>'+w.index+'. '+esc(label(w.name||t('unknown')))+'</option>').join('')+'</select>',()=>action({...payload,value:$('field').value}));return;
    }
    if(name==='auto-prime') {modal(title,'<p>'+t('primeHelp')+'</p><select id="field"><option value="on"'+(account.autoPrime?' selected':'')+'>'+t('on')+'</option><option value="off"'+(!account.autoPrime?' selected':'')+'>'+t('off')+'</option></select>',saveValue);return;}
    const help={delete:'deleteHelp',switch:'switchHelp',pause:'pauseHelp',drain:'drainHelp'}[name];
    modal(title,help?'<p>'+t(help)+'</p>':'<p>'+esc(title)+'</p>',()=>action(['switch','unpin','delete','enable','disable'].includes(name)?{...payload,confirm:true}:{action:'account',accountRef:ref,subcommand:name}),t('continue'));
  }
  document.addEventListener('click',e=>{const b=e.target.closest('button[data-action]');if(!b||b.disabled)return;manage(b.dataset.action,b.dataset.ref).catch(failed);});
  $('operation-cancel').onclick=()=>{if(pollId)action({action:'cancel',operationId:pollId}).catch(failed);};
  $('search').addEventListener('input',()=>{if(data)draw(data)});
  $('filter').addEventListener('change',()=>{if(data)draw(data)});
  $('refresh').onclick=load;
  function setLang() {
    document.documentElement.lang=lang==='zh'?'zh-CN':'en';
    document.title='Codex Multi-Auth · '+t('title');
    document.querySelectorAll('[data-i18n]').forEach(e=>{e.textContent=t(e.dataset.i18n)});
    $('search').placeholder=t('search');$('search').setAttribute('aria-label',t('search'));$('filter').setAttribute('aria-label',t('filter'));
    $('lang').textContent=lang==='zh'?'EN':'中文';
    $('connection').textContent=t(connected?'connected':data?'offline':'connecting');
    if(data)draw(data);
  }
  $('lang').onclick=()=>{lang=lang==='zh'?'en':'zh';try{localStorage.setItem('cma.locale',lang)}catch(_){}setLang();};
  setLang();void load();
  try {
    eventSource=new EventSource(api('/events'));
    eventSource.onopen=()=>{connected=true;$('connection').textContent=t('connected');$('dot').className='dot';};
    eventSource.onmessage=e=>{try{connected=true;draw(JSON.parse(e.data));$('connection').textContent=t('connected');$('dot').className='dot';}catch(_){}};
    eventSource.onerror=()=>{connected=false;$('connection').textContent=t('offline');$('dot').className='dot off';};
  } catch(_) {setInterval(load,5000);}
  window.addEventListener('pagehide',()=>{if(eventSource)eventSource.close();clearTimeout(pollTimer)});
})();
`;
