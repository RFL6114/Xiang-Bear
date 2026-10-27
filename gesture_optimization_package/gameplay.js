(() => {
  const $ = (s) => document.querySelector(s);
  const street = $('#streetScene'), cook = $('#cookScene'), playerWrap = $('#playerWrap');
  const shops = [...document.querySelectorAll('.shop')];
  const shopInfo = [
    {name:'老周肉铺',desc:'腊味、鲜肉与烟火气',title:'腊味小灶',sub:'试试辣椒与湘西腊肉的香辣组合'},
    {name:'洞庭鱼行',desc:'鲜鱼现挑，湖鲜当日到',title:'洞庭鱼头灶',sub:'鱼头入锅，做一道鲜香湘味'},
    {name:'巷口豆坊',desc:'手作豆腐与发酵豆豉',title:'豆香小灶',sub:'豆腐也能成为一场风味冒险'},
    {name:'百味香料',desc:'一巷辛香，找到你的味型',title:'百味调香台',sub:'用不同食材叠出你自己的味道'}
  ];
  let x = 12, facing = 1, walking = false, nearShop = -1, selected = 'chili', added = [], heat = 1, stirCount = 0;
  let walkTimer = null, cameraStream = null, handsModel = null, cameraLoop = null, cameraOn = false, candidateGesture = '', candidateSince = 0, latchedGesture = '', lastGestureAt = 0;
  // Hand-pose smoothing prevents one-frame landmark jitter from triggering an action.
  let gestureHistory = [], missingHandSince = 0, unknownGestureSince = 0, lastNoHandStatusAt = 0;
  const emoji = {chili:'🌶️',pork:'🥩',fish:'🐟',bacon:'🥓'};
  function setStatus(title, detail) { $('#gestureStatus').textContent = title; $('#gestureDetail').textContent = detail; }
  function move(dir) { if (!street.classList.contains('hidden')) { facing = dir; x = Math.max(8, Math.min(92, x + dir * 5)); updatePlayer(); updateNearby(); } }
  // 手势转向只改变角色朝向，不会突然把角色横向瞬移；握拳时会沿当前朝向持续走。
  function face(dir) { if (street.classList.contains('hidden')) return; facing = dir < 0 ? -1 : 1; playerWrap.classList.remove('turning'); void playerWrap.offsetWidth; playerWrap.classList.add('turning'); setTimeout(()=>playerWrap.classList.remove('turning'),280); updatePlayer(); $('#streetCaption').textContent = facing < 0 ? '向左看看街巷' : '向右看看街巷'; $('#streetSubcaption').textContent = walking ? '保持握拳，角色会沿当前朝向继续行走' : '握拳开始行走，张开手掌停止'; setStatus(facing < 0 ? '角色已朝左' : '角色已朝右', walking ? '保持握拳即可沿当前方向前进' : '握拳行走 · 张开手掌停止'); }
  function updatePlayer() { playerWrap.style.left = x + '%'; playerWrap.style.transform = 'translateX(-50%)'; const sprite=$('#player'); if(sprite) sprite.style.transform = `translateX(-50%) scaleX(${facing})`; const streetStops=[14,37,62,86], mapStops=[14,40,65,90]; let mapX=mapStops[0]; if(x<=streetStops[0])mapX=mapStops[0]; else if(x>=streetStops[3])mapX=mapStops[3]; else {for(let i=0;i<streetStops.length-1;i++){if(x>=streetStops[i]&&x<=streetStops[i+1]){const t=(x-streetStops[i])/(streetStops[i+1]-streetStops[i]);mapX=mapStops[i]+t*(mapStops[i+1]-mapStops[i]);break;}}} $('#mapPlayer').style.left = mapX + '%'; }
  function updateNearby() {
    const shopStops = [14, 37, 62, 86];
    let index = 0; for (let i=1;i<shopStops.length;i++) if (Math.abs(x-shopStops[i])<Math.abs(x-shopStops[index])) index=i;
    const dist = Math.abs(x - shopStops[index]);
    const newNear = dist < 5.8 ? index : -1;
    if (newNear !== nearShop) { nearShop = newNear; shops.forEach((s,i)=>s.classList.toggle('nearby',i===nearShop)); }
    const prompt = $('#shopPrompt');
    if (nearShop >= 0) { const info=shopInfo[nearShop]; $('#promptName').textContent=info.name; $('#promptDesc').textContent=info.desc; prompt.classList.add('visible'); $('#streetCaption').textContent='你来到了'+info.name+'门前'; $('#streetSubcaption').textContent='确认进入店铺，开始第一人称烹饪'; }
    else { prompt.classList.remove('visible'); $('#streetCaption').textContent='沿着青石路慢慢逛'; $('#streetSubcaption').textContent='靠近店铺，看看今天有什么新鲜食材'; }
  }
  function startWalk(on=true) {
    // Walking belongs to the street scene only; never start a movement timer inside the kitchen.
    if (on && street.classList.contains('hidden')) return;
    // Do not replace a target-walking timer or restart the cadence on every repeated input.
    if (on && walking && walkTimer) return;

    walking = Boolean(on);
    playerWrap.classList.toggle('walking', walking);
    $('#walkLabel').textContent = walking ? '行走中 · 松开停止' : '按住前进';
    setStatus(
      walking ? '行走手势已识别' : '手势控制已就绪',
      walking ? '保持握拳持续沿街行走；张开手掌或移开双手可停止' : '握拳行走 · 食指横指转向 · 双指确认'
    );
    if (walkTimer) { clearInterval(walkTimer); walkTimer = null; }

    if (walking) {
      const tick = () => {
        if (!walking) return;
        if (street.classList.contains('hidden')) { startWalk(false); return; }
        const nextX = Math.max(8, Math.min(92, x + facing * 1.15));
        x = nextX;
        updatePlayer();
        updateNearby();
        if ((x <= 8 && facing < 0) || (x >= 92 && facing > 0)) {
          startWalk(false);
          setStatus('已到街巷边缘', '指向另一侧转向，再握拳继续行走');
        }
      };
      tick();
      walkTimer = setInterval(tick, 180);
    }
  }
  function enterShop() { if (nearShop < 0) { setStatus('还没走到店门口','请继续握拳行走，靠近店铺后再做确认手势'); $('#streetSubcaption').textContent='先走到店铺门前，再确认进入'; return; } const info=shopInfo[nearShop]; walking=false; if(walkTimer){clearInterval(walkTimer);walkTimer=null;} playerWrap.classList.remove('walking'); $('#cookTitle').textContent=info.title; $('#cookSubtitle').textContent=info.sub; street.classList.add('hidden'); cook.classList.remove('hidden'); $('#modeLabel').textContent='第一人称烹饪'; setStatus('烹饪手势已就绪','confirm 下锅 · stir 搅拌 · fire 调整火候'); }
  function backStreet() { cook.classList.add('hidden'); street.classList.remove('hidden'); $('#modeLabel').textContent='街巷探索'; walking=false; playerWrap.classList.remove('walking'); updateNearby(); setStatus('手势控制已就绪','继续探索街巷，寻找下一家店'); }
  function selectCard(id) { selected=id; document.querySelectorAll('.ingredient-card').forEach(c=>c.classList.toggle('selected',c.dataset.id===id)); $('#actionHint').textContent=`已选中「${document.querySelector(`[data-id="${id}"]`).dataset.name}」——确认手势即可投入锅中`; }
  function addIngredient() { const card=document.querySelector(`[data-id="${selected}"]`); if(!card)return; added.push({id:selected,name:card.dataset.name,emoji:emoji[selected]}); $('#ingredientCount').textContent=added.length; const pot=$('#potContent'); pot.querySelector('.pot-placeholder')?.remove(); const item=document.createElement('span'); item.className='pot-item'; item.textContent=emoji[selected]; const idx=added.length-1; item.style.left=(16+(idx%4)*19)+'%'; item.style.top=(18+Math.floor(idx/4)*28)+'%'; item.style.transform=`rotate(${(idx*31)%60-30}deg)`; pot.appendChild(item); pot.style.background=added.length>2?'radial-gradient(ellipse,#b85b32,#6c4b32 70%)':'radial-gradient(ellipse,#687443,#9c7041 50%,#46362a 75%)'; $('#cookFeedback').textContent=`${card.dataset.name}入锅！香气渐渐出来了`; $('#actionHint').textContent='食材已入锅；继续选牌，或搅拌让味道融合'; $('#spatulaHand').textContent='🥄'; }
  function stir() { stirCount++; $('#potContent').animate([{transform:'rotate(0)'},{transform:'rotate(4deg)'},{transform:'rotate(-4deg)'},{transform:'rotate(0)'}],{duration:550}); document.querySelectorAll('.pot-item').forEach((el,i)=>el.animate([{transform:'translate(0,0) rotate(0)'},{transform:`translate(${i%2?8:-8}px,-5px) rotate(40deg)`},{transform:'translate(0,0) rotate(0)'}],{duration:550})); $('#cookFeedback').textContent=`翻炒第 ${stirCount} 次 · 食材香味融合中`; $('#spatulaHand').textContent='🥢'; setTimeout(()=>$('#spatulaHand').textContent='🥄',700); }
  function changeHeat() { heat=heat%3+1; $('#cookFeedback').textContent=['','文火慢煨，香味渐浓','中火翻炒，滋滋作响','大火爆香！锅气十足'][heat]; $('#fireBtn').textContent=['🔥 调整火候','🔥 文火','🔥 中火','🔥 大火'][heat]; $('#potContent').style.filter=heat===3?'saturate(1.35) brightness(1.08)':heat===1?'saturate(.85)':'saturate(1.1)'; }
  function gesture(name) {
    const g = String(name || '').toLowerCase();
    if (['walk','forward','walking','fist'].includes(g)) {
      if (cook.classList.contains('hidden')) startWalk(true);
      else setStatus('当前处于烹饪场景', '选中食材卡后做确认手势下锅；三指搅拌，四指调火');
    } else if (['stop','idle','open_palm','open-palm','none'].includes(g)) {
      startWalk(false);
    } else if (['left','point_left','point-left','turn_left'].includes(g)) {
      face(-1);
    } else if (['right','point_right','point-right','turn_right'].includes(g)) {
      face(1);
    } else if (['confirm','enter','pinch','select'].includes(g)) {
      if (!cook.classList.contains('hidden')) addIngredient();
      else enterShop();
    } else if (['stir','mix','rotate'].includes(g)) {
      if (!cook.classList.contains('hidden')) stir();
      else setStatus('搅拌手势已识别', '进入店铺后做三指手势即可搅拌翻炒');
    } else if (['fire','heat','thumbs_up'].includes(g)) {
      if (!cook.classList.contains('hidden')) changeHeat();
      else setStatus('火候手势已识别', '进入烹饪场景后做四指手势调整火候');
    } else {
      setStatus('已收到手势：' + g, '如需映射，请在 gameplay.js 的 gesture() 中补充识别器标签');
    }
  }
  // Bridge for the existing camera/hand-tracking code. Call handleRecognizedGesture('walk'|'left'|'right'|'stop'|'confirm'|'stir'|'fire').
  window.handleRecognizedGesture = gesture;
  window.foodWarsGestureControls = { walk: () => startWalk(true), stop: () => startWalk(false), turnLeft: () => face(-1), turnRight: () => face(1), confirm: () => gesture('confirm'), stir: () => stir(), fire: () => changeHeat() };
  window.dispatchEvent(new CustomEvent('foodwars:gesture-ready'));
  window.addEventListener('foodwars:gesture',e=>gesture(e.detail?.gesture || e.detail));
  document.addEventListener('keydown',e=>{ if(['ArrowLeft','ArrowRight','ArrowUp',' ','Enter'].includes(e.key))e.preventDefault(); if(e.key==='ArrowLeft')move(-1); if(e.key==='ArrowRight')move(1); if(e.key==='ArrowUp')startWalk(true); if(e.key===' ')startWalk(false); if(e.key==='Enter'){if(cook.classList.contains('hidden'))enterShop();else addIngredient();} if(e.key.toLowerCase()==='s'&&!cook.classList.contains('hidden'))stir(); if(e.key.toLowerCase()==='f'&&!cook.classList.contains('hidden'))changeHeat(); });
  $('#turnLeft').addEventListener('click',()=>move(-1)); $('#turnRight').addEventListener('click',()=>move(1));
  const walkBtn=$('#walkToggle'); walkBtn.addEventListener('pointerdown',e=>{e.preventDefault();startWalk(true)}); ['pointerup','pointercancel','pointerleave'].forEach(ev=>walkBtn.addEventListener(ev,()=>startWalk(false)));
  $('#enterShopBtn').addEventListener('click',enterShop);
  function walkToShop(index){ if(street.classList.contains('hidden'))return; const stops=[14,37,62,86]; const target=stops[index]; if(!Number.isFinite(target))return; if(walkTimer){clearInterval(walkTimer);walkTimer=null;} facing=target<x?-1:1; updatePlayer(); playerWrap.classList.add('walking'); walking=true; $('#walkLabel').textContent='正在前往店铺'; setStatus('正在沿街前往','角色会走到所选店铺门前，不会瞬移'); walkTimer=setInterval(()=>{const delta=target-x;if(Math.abs(delta)<.8){x=target;walking=false;clearInterval(walkTimer);walkTimer=null;playerWrap.classList.remove('walking');$('#walkLabel').textContent='按住前进';}else{x+=Math.sign(delta)*Math.min(1.1,Math.abs(delta));}updatePlayer();updateNearby();},100); }
  document.querySelectorAll('[data-map-shop]').forEach(node=>{node.addEventListener('click',()=>walkToShop(Number(node.dataset.mapShop)));node.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();walkToShop(Number(node.dataset.mapShop));}});});
  shops.forEach((s,i)=>s.addEventListener('click',()=>walkToShop(i)));
  $('#backToStreet').addEventListener('click',backStreet); document.querySelectorAll('.ingredient-card').forEach(c=>c.addEventListener('click',()=>selectCard(c.dataset.id))); $('#addIngredient').addEventListener('click',addIngredient); $('#stirBtn').addEventListener('click',stir); $('#fireBtn').addEventListener('click',changeHeat);
  const modal=$('#helpModal'); $('#helpBtn').addEventListener('click',()=>modal.classList.remove('hidden')); $('#closeHelp').addEventListener('click',()=>modal.classList.add('hidden')); $('#closeHelpBottom').addEventListener('click',()=>modal.classList.add('hidden')); modal.addEventListener('click',e=>{if(e.target===modal)modal.classList.add('hidden')});
  // Real camera integration. Finger extension is measured relative to the wrist, which is
  // more tolerant of a tilted hand than comparing every fingertip to the top of the image.
  function pointDistance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function extendedFinger(lm, tip, pip) {
    const wristDistance = pointDistance(lm[tip], lm[0]);
    const jointDistance = pointDistance(lm[pip], lm[0]);
    return wristDistance > jointDistance * 1.12;
  }
  function gestureFromLandmarks(lm) {
    const fingers = [
      extendedFinger(lm, 8, 6),
      extendedFinger(lm, 12, 10),
      extendedFinger(lm, 16, 14),
      extendedFinger(lm, 20, 18)
    ];
    const n = fingers.filter(Boolean).length;
    const thumbOpen = pointDistance(lm[4], lm[5]) > pointDistance(lm[3], lm[5]) * 1.18;

    if (n === 0) return { key: 'walk', label: '握拳：持续行走' };
    if (n === 4 && thumbOpen) return { key: 'stop', label: '张开手掌：停止' };

    // Index-only: a horizontal finger turns; a mostly vertical finger confirms.
    // The threshold scales with the palm width so the same pose works at different camera distances.
    if (n === 1 && fingers[0]) {
      const dx = lm[8].x - lm[5].x;
      const palmWidth = Math.abs(lm[5].x - lm[17].x);
      const horizontalThreshold = Math.max(0.035, palmWidth * 0.30);
      if (Math.abs(dx) > horizontalThreshold) {
        return dx < 0
          ? { key: 'left', label: '食指横指左：角色转向左' }
          : { key: 'right', label: '食指横指右：角色转向右' };
      }
      return { key: 'confirm', label: '竖起食指：确认 / 进入 / 下锅' };
    }
    if (n === 2 && fingers[0] && fingers[1]) return { key: 'confirm', label: '食指与中指：确认 / 进入 / 下锅' };
    if (n === 3 && fingers[0] && fingers[1] && fingers[2]) return { key: 'stir', label: '三指：搅拌翻炒' };
    if (n === 4) return { key: 'fire', label: '四指伸展、拇指收拢：调整火候' };
    return null;
  }

  function stableGestureFromHistory() {
    if (!gestureHistory.length) return null;
    const counts = new Map();
    for (const item of gestureHistory) {
      if (item) counts.set(item.key, (counts.get(item.key) || 0) + 1);
    }
    let bestKey = null, bestCount = 0;
    for (const [key, count] of counts) {
      if (count > bestCount) { bestKey = key; bestCount = count; }
    }
    const required = Math.max(2, Math.ceil(gestureHistory.length * 0.57));
    if (!bestKey || bestCount < required) return null;
    const match = [...gestureHistory].reverse().find(item => item && item.key === bestKey);
    return match || null;
  }

  function onCameraResults(results) {
    if (!cameraOn) return;
    const now = performance.now();
    const lm = results.multiHandLandmarks?.[0];

    if (!lm) {
      if (!missingHandSince) missingHandSince = now;
      gestureHistory = [];
      candidateGesture = '';
      candidateSince = 0;
      if (now - missingHandSince > 150 && now - lastNoHandStatusAt > 500) {
        $('#cameraHint').textContent = '请把手放入镜头画面，并保持动作清晰';
        lastNoHandStatusAt = now;
      }
      // Ignore brief tracking dropouts, but stop if the hand stays missing for a moment.
      if (walking && now - missingHandSince >= 350) {
        startWalk(false);
        latchedGesture = '';
        setStatus('行走已安全停止', '摄像头暂时没有识别到手；重新举手并保持握拳即可继续');
      }
      if (now - missingHandSince >= 350) latchedGesture = '';
      return;
    }

    missingHandSince = 0;
    const rawGesture = gestureFromLandmarks(lm);
    if (!rawGesture) {
      gestureHistory = [];
      candidateGesture = '';
      candidateSince = 0;
      if (!unknownGestureSince) unknownGestureSince = now;
      $('#cameraHint').textContent = '手势不明确，请只伸出需要的手指并保持稳定';
      // Neutral/transitional poses release the one-shot latch, but do not stop walking immediately.
      if (now - unknownGestureSince >= 280) latchedGesture = '';
      if (walking && now - unknownGestureSince >= 650) startWalk(false);
      return;
    }
    unknownGestureSince = 0;

    gestureHistory.push(rawGesture);
    if (gestureHistory.length > 7) gestureHistory.shift();
    const stable = stableGestureFromHistory();
    if (!stable) {
      $('#cameraHint').textContent = rawGesture.label + ' · 正在稳定识别…';
      return;
    }

    $('#cameraHint').textContent = stable.label + ' · 保持约 0.45 秒';
    if (candidateGesture !== stable.key) {
      candidateGesture = stable.key;
      candidateSince = now;
      return;
    }

    // Fire a command once per stable pose. Switching to another stable pose or a neutral pose
    // releases the latch, so repeated ingredient additions remain possible without repeated firing.
    if (now - candidateSince >= 450 && latchedGesture !== stable.key && now - lastGestureAt >= 450) {
      latchedGesture = stable.key;
      lastGestureAt = now;
      gesture(stable.key);
    }
  }
  async function toggleCamera(){
    if(cameraOn){stopCamera();return;}
    if(!navigator.mediaDevices?.getUserMedia){setStatus('摄像头不可用','请使用 localhost 或 HTTPS；键盘与按钮仍可操作');return;}
    $('#cameraPanel').classList.remove('hidden');$('#cameraToggle').textContent='关闭摄像头';$('#cameraHint').textContent='正在请求摄像头权限…';
    try{
      cameraStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:640},height:{ideal:480}},audio:false});
      const video=$('#gestureVideo');video.srcObject=cameraStream;await video.play();
      if(!window.Hands)throw new Error('MediaPipe Hands 未加载，请检查网络后刷新页面。');
      handsModel=new window.Hands({locateFile:file=>`https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`});
      handsModel.setOptions({maxNumHands:1,modelComplexity:1,minDetectionConfidence:.6,minTrackingConfidence:.55});handsModel.onResults(onCameraResults);
      cameraOn=true;$('#cameraDot').classList.add('live');setStatus('摄像头手势已连接','握拳持续行走 · 食指横指转向 · 双指进入 / 下锅');
      let lastTime=-1;const frame=async()=>{if(!cameraOn||!handsModel)return;if(video.readyState>=2&&video.currentTime!==lastTime){lastTime=video.currentTime;try{await handsModel.send({image:video});}catch(e){console.warn(e);}}cameraLoop=requestAnimationFrame(frame);};frame();
    }catch(e){console.error(e);stopCamera();$('#cameraPanel').classList.remove('hidden');$('#cameraHint').textContent=e.message||'摄像头启动失败';setStatus('摄像头未启动','请检查权限、HTTPS / localhost 和网络');}
  }
  function stopCamera() {
    cameraOn = false;
    if (cameraLoop) cancelAnimationFrame(cameraLoop);
    cameraLoop = null;
    if (handsModel) { try { handsModel.close(); } catch (e) {} handsModel = null; }
    if (cameraStream) cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
    const video = $('#gestureVideo');
    if (video) video.srcObject = null;
    if (walking) startWalk(false); // Turning the camera off must not leave the bear walking forever.
    $('#cameraDot').classList.remove('live');
    $('#cameraToggle').textContent = '开启摄像头手势';
    $('#cameraPanel').classList.add('hidden');
    candidateGesture = '';
    candidateSince = 0;
    latchedGesture = '';
    gestureHistory = [];
    missingHandSince = 0;
    unknownGestureSince = 0;
    setStatus('手势控制已就绪', '键盘和屏幕按钮仍可操作');
  }
  $('#cameraToggle').addEventListener('click',toggleCamera);$('#cameraClose').addEventListener('click',stopCamera);window.addEventListener('beforeunload',stopCamera);
  updatePlayer();updateNearby();
})();
