(() => {
  const $ = (selector) => document.querySelector(selector);
  const street = $('#streetScene');
  const cook = $('#cookScene');
  const playerWrap = $('#playerWrap');
  const shops = [...document.querySelectorAll('.shop')];

  const shopInfo = [
    { name: '老周肉铺', desc: '腊味、鲜肉与烟火气', title: '腊味小灶', sub: '从五花肉、鲜辣椒开始，炒出湖南香味' },
    { name: '洞庭鱼行', desc: '鲜鱼现挑，湖鲜当日到', title: '洞庭鱼头灶', sub: '取鱼头与调味料，做一道鲜香湘味' },
    { name: '巷口豆坊', desc: '手作豆腐与发酵豆豉', title: '豆香小灶', sub: '取豆腐、蒜瓣和酱料，慢慢煨出豆香' },
    { name: '百味香料', desc: '一巷辛香，找到你的味型', title: '百味调香台', sub: '从各种香料与酱汁开始搭配味道' }
  ];

  const kitchenItems = [
    { id: 'pork', name: '五花肉', emoji: '🥩', image: 'assets/food-illustrations/pork.png', kind: 'ingredient' },
    { id: 'chili', name: '鲜辣椒', emoji: '🌶️', image: 'assets/food-illustrations/chili.png', kind: 'ingredient' },
    { id: 'greens', name: '青菜', emoji: '🥬', image: 'assets/food-illustrations/greens.png', kind: 'ingredient' },
    { id: 'soy', name: '老抽', emoji: '🍶', image: 'assets/food-illustrations/soy-sauce.png', kind: 'sauce' },
    { id: 'douban', name: '豆豉辣酱', emoji: '🌶️', image: 'assets/food-illustrations/chili-paste.png', kind: 'sauce' }
  ];
  const itemById = Object.fromEntries(kitchenItems.map(item => [item.id, item]));
  const HEAT_LABELS = ['', '文火', '中火', '大火'];

  let x = 8;
  let facing = 1;
  let walking = false;
  let nearShop = -1;
  let heldIngredient = null;
  let selectedKitchenItemId = 'pork';
  let added = [];
  let heat = 1;
  let stirCount = 0;
  let walkTimer = null;

  let cameraStream = null;
  let handsModel = null;
  let cameraLoop = null;
  let cameraOn = false;
  let candidateGesture = '';
  let candidateSince = 0;
  let latchedGesture = '';
  let lastGestureAt = 0;
  let gestureHistory = [];
  let missingHandSince = 0;
  let unknownGestureSince = 0;
  let lastNoHandStatusAt = 0;

  // Pinch is edge-triggered: grab once when it starts, drop on release over the wok.
  let pinchActive = false;
  let pinchStartedAt = 0;
  let pinchActionDone = false;
  let pinchStartPoint = null;
  let lastPinchPoint = null;
  let lastHandPoint = null;
  let pinchGestureActive = false;
  let dishCreated = false;

  function setStatus(title, detail) {
    const titleEl = $('#gestureStatus');
    const detailEl = $('#gestureDetail');
    if (titleEl) titleEl.textContent = title;
    if (detailEl) detailEl.textContent = detail;
  }

  function getShopStops() {
    // These centers line up with the four shop entrances in the painted street background.
    return [15, 39, 65, 89];
  }

  function move(dir) {
    if (!street.classList.contains('hidden')) {
      facing = dir < 0 ? -1 : 1;
      x = Math.max(6, Math.min(94, x + dir * 4.5));
      updatePlayer();
      updateNearby();
    } else {
      cycleKitchenTarget(dir);
    }
  }

  function updatePlayer() {
    playerWrap.style.left = x + '%';
    playerWrap.style.transform = 'translateX(-50%)';
    const sprite = $('#player');
    // The image itself fills the now-bounded wrapper; do not apply an extra translateX.
    if (sprite) sprite.style.transform = `scaleX(${facing})`;

    const stops = getShopStops();
    const mapStops = [14, 40, 65, 90];
    let mapX = mapStops[0];
    if (x <= stops[0]) mapX = mapStops[0];
    else if (x >= stops[3]) mapX = mapStops[3];
    else {
      for (let i = 0; i < stops.length - 1; i++) {
        if (x >= stops[i] && x <= stops[i + 1]) {
          const span = Math.max(0.001, stops[i + 1] - stops[i]);
          const t = (x - stops[i]) / span;
          mapX = mapStops[i] + t * (mapStops[i + 1] - mapStops[i]);
          break;
        }
      }
    }
    $('#mapPlayer').style.left = mapX + '%';
  }

  function updateNearby() {
    const stops = getShopStops();
    const sceneWidth = street.getBoundingClientRect().width || 1200;
    // Door interaction zone is deliberately narrow: prompts only appear close to a door.
    const doorThreshold = Math.max(2.5, Math.min(3.2, 46 / sceneWidth * 100));
    let index = 0;
    for (let i = 1; i < stops.length; i++) {
      if (Math.abs(x - stops[i]) < Math.abs(x - stops[index])) index = i;
    }
    const distance = Math.abs(x - stops[index]);
    const newNear = distance <= doorThreshold ? index : -1;
    if (newNear !== nearShop) {
      nearShop = newNear;
      shops.forEach((shop, i) => shop.classList.toggle('nearby', i === nearShop));
    }
    const prompt = $('#shopPrompt');
    if (nearShop >= 0) {
      const info = shopInfo[nearShop];
      $('#promptName').textContent = info.name;
      $('#promptDesc').textContent = info.desc;
      prompt.classList.add('visible');
      $('#streetCaption').textContent = '你来到了' + info.name + '门前';
      $('#streetSubcaption').textContent = '已到门口；拇指与食指捏合并保持，或点击“进入店铺”';
    } else {
      prompt.classList.remove('visible');
      $('#streetCaption').textContent = '沿着青石路慢慢逛';
      $('#streetSubcaption').textContent = '走到店铺门前，出现提示后再捏合确认进入';
    }
  }

  function face(dir) {
    if (street.classList.contains('hidden')) { cycleKitchenTarget(dir); return; }
    facing = dir < 0 ? -1 : 1;
    playerWrap.classList.remove('turning');
    void playerWrap.offsetWidth;
    playerWrap.classList.add('turning');
    updatePlayer();
    window.setTimeout(() => playerWrap.classList.remove('turning'), 220);
    setStatus(facing < 0 ? '已识别向左指向' : '已识别向右指向', '保持横向食指姿势可转向；握拳继续沿朝向行走');
    $('#streetCaption').textContent = facing < 0 ? '小熊朝左观察街巷' : '小熊朝右探索街巷';
  }

  function walkToShop(index) {
    if (street.classList.contains('hidden')) return;
    const target = getShopStops()[index];
    if (!Number.isFinite(target)) return;
    if (walkTimer) { clearInterval(walkTimer); walkTimer = null; }
    walking = false;
    playerWrap.classList.remove('walking');
    if (Math.abs(target - x) <= 0.5) {
      x = target; updatePlayer(); updateNearby();
      setStatus('已到店门前', '捏合拇指与食指进入店铺');
      return;
    }
    facing = target < x ? -1 : 1;
    walking = true;
    playerWrap.classList.add('walking');
    updatePlayer();
    $('#walkLabel').textContent = '正在前往店铺';
    setStatus('正在沿街前往', `小熊正前往${shopInfo[index].name}，到门口后再捏合进入`);
    walkTimer = setInterval(() => {
      const delta = target - x;
      if (Math.abs(delta) <= 0.8) {
        x = target; walking = false;
        clearInterval(walkTimer); walkTimer = null;
        playerWrap.classList.remove('walking');
        $('#walkLabel').textContent = '按住前进';
        setStatus('已到店门前', '现在捏合拇指与食指，确认进入店铺');
      } else {
        x += Math.sign(delta) * Math.min(0.85, Math.abs(delta));
      }
      updatePlayer(); updateNearby();
    }, 90);
  }

  function startWalk(on = true) {
    if (on && street.classList.contains('hidden')) return;
    if (on && walking && walkTimer) return;
    walking = Boolean(on);
    playerWrap.classList.toggle('walking', walking);
    $('#walkLabel').textContent = walking ? '行走中 · 松开停止' : '按住前进';
    setStatus(
      walking ? '行走手势已识别' : '手势控制已就绪',
      walking ? '保持握拳持续沿街行走；张开手掌或移开手后可停止' : '握拳行走 · 张掌停止 · 单食指水平指向转向；近门捏合进入'
    );
    if (walkTimer) { clearInterval(walkTimer); walkTimer = null; }
    if (!walking) return;

    const tick = () => {
      if (!walking) return;
      if (street.classList.contains('hidden')) { startWalk(false); return; }
      const beforeNearShop = nearShop;
      x = Math.max(8, Math.min(92, x + facing * 1.15));
      updatePlayer();
      updateNearby();
      // Stop once when entering a door's interaction zone, keeping the entry prompt stable.
      // After the player starts walking again, they can keep going past the shop.
      if (beforeNearShop < 0 && nearShop >= 0) {
        walking = false;
        if (walkTimer) clearInterval(walkTimer);
        walkTimer = null;
        playerWrap.classList.remove('walking');
        $('#walkLabel').textContent = '按住前进';
        setStatus('已停在店门前', `已到${shopInfo[nearShop].name}附近；捏合约半秒进入，继续握拳可走过店铺`);
        return;
      }
      if ((x <= 8 && facing < 0) || (x >= 92 && facing > 0)) {
        startWalk(false);
        setStatus('已到街巷边缘', '伸出食指朝另一侧转向，再握拳继续行走');
      }
    };
    tick();
    if (walking) walkTimer = setInterval(tick, 180);
  }

  function resetCookingForVisit() {
    heldIngredient = null;
    added = [];
    heat = 1;
    stirCount = 0;
    $('#ingredientCount').textContent = '0';
    dishCreated = false;
    $('#dishResultModal')?.classList.add('hidden');
    document.querySelectorAll('.kitchen-object').forEach(object => object.classList.remove('is-taken'));
    $('#cookFeedback').textContent = '看着🤏定位圆点对准插画，捏合拿取后移到中央炒锅松开';
    $('#fireBtn').textContent = '🔥 火候';
    $('#heatIndicator').textContent = HEAT_LABELS[heat];
    const pot = $('#potContent');
    pot.querySelectorAll('.pot-item').forEach(el => el.remove());
    pot.querySelector('.pot-placeholder')?.remove();
    const placeholder = document.createElement('span');
    placeholder.className = 'pot-placeholder';
    placeholder.textContent = '把食材移到锅里松开';
    pot.appendChild(placeholder);
    pot.style.filter = 'saturate(.9)';
    $('#fireGlow').className = 'fire-glow';
    $('#wokDropZone').classList.remove('drop-ready');
    syncCookingUI();
  }

  function enterShop() {
    if (nearShop < 0) {
      setStatus('还没走到店门口', '请继续沿街走，等店铺提示出现后再捏合确认');
      $('#streetSubcaption').textContent = '离店门还有一段距离；先走到门前';
      return false;
    }
    const info = shopInfo[nearShop];
    if (walkTimer) { clearInterval(walkTimer); walkTimer = null; }
    walking = false;
    playerWrap.classList.remove('walking');
    $('#cookTitle').textContent = info.title;
    $('#cookSubtitle').textContent = '俯视灶台：在左侧案板或右侧酱料区捏合拿取，移至锅里松开下料';
    resetCookingForVisit();
    street.classList.add('hidden');
    cook.classList.remove('hidden');
    $('#modeLabel').textContent = '第一人称烹饪';
    setStatus('进入俯视灶台', '捏合取料并保持，移动到锅区后松开；捏合火候区可调火');
    return true;
  }

  function backStreet() {
    cook.classList.add('hidden');
    street.classList.remove('hidden');
    $('#modeLabel').textContent = '街巷探索';
    if (walking) startWalk(false);
    playerWrap.classList.remove('walking');
    updatePlayer();
    updateNearby();
    heldIngredient = null;
    syncCookingUI();
    setStatus('回到街巷', '握拳持续前进，单食指明确横指转向；靠近店门后捏合进入');
  }

  function syncCookingUI() {
    document.querySelectorAll('.kitchen-object').forEach(button => {
      button.classList.toggle('focus-target', button.dataset.kitchenItem === selectedKitchenItemId && !button.classList.contains('is-taken'));
    });
    const heldArtSlot = $('#heldEmoji');
    heldArtSlot.replaceChildren();
    if (heldIngredient?.image) {
      const heldImg = document.createElement('img');
      heldImg.src = heldIngredient.image;
      heldImg.alt = heldIngredient.name;
      heldArtSlot.appendChild(heldImg);
    } else {
      const empty = document.createElement('span'); empty.className = 'held-empty'; empty.textContent = '空手';
      heldArtSlot.appendChild(empty);
    }
    $('#heldIngredientName').textContent = heldIngredient ? heldIngredient.name : '空手';
    $('#heldIngredient').classList.toggle('holding', Boolean(heldIngredient));
    $('#handCursorEmoji').textContent = heldIngredient ? heldIngredient.emoji : '🤏';
    $('#handCursor').classList.toggle('visible', Boolean(heldIngredient) && cameraOn && !cook.classList.contains('hidden'));
    $('#actionHint').textContent = heldIngredient
      ? `手中：${heldIngredient.name}。保持捏合移动到中央炒锅，松开手指下锅。`
      : '捏合左侧食材或右侧酱料拿取；捏合火候区调火；三指或翻炒区可翻炒。';
  }

  function cycleKitchenTarget(dir) {
    if (cook.classList.contains('hidden')) return;
    const buttons = [...document.querySelectorAll('.kitchen-object')];
    if (!buttons.length) return;
    let index = buttons.findIndex(button => button.dataset.kitchenItem === selectedKitchenItemId);
    index = (index + dir + buttons.length) % buttons.length;
    selectedKitchenItemId = buttons[index].dataset.kitchenItem;
    syncCookingUI();
    const item = itemById[selectedKitchenItemId];
    $('#cookFeedback').textContent = `键盘定位：${item.name}；Enter 可拿取`;
  }

  function acquireKitchenItem(id) {
    const item = itemById[id];
    const sourceButton = document.querySelector(`[data-kitchen-item="${id}"]`);
    if (!item || sourceButton?.classList.contains('is-taken')) return;
    if (heldIngredient && heldIngredient.id !== id) {
      document.querySelector(`[data-kitchen-item="${heldIngredient.id}"]`)?.classList.remove('is-taken');
      $('#cookFeedback').textContent = `已放回${heldIngredient.name}，拿起${item.name}`;
    } else {
      $('#cookFeedback').textContent = `拿起${item.name}；保持捏合移动到锅区，松开下料`;
    }
    sourceButton?.classList.add('is-taken');
    heldIngredient = item;
    selectedKitchenItemId = id;
    syncCookingUI();
    setStatus('已拿起' + item.name, '保持拇指与食指捏合，移动到中央锅区后松开');
  }

  function pickUpOrDropIngredient() {
    if (cook.classList.contains('hidden')) { enterShop(); return; }
    if (heldIngredient) {
      dropHeldItemIntoWok();
      return;
    }
    acquireKitchenItem(selectedKitchenItemId || 'pork');
  }

  function dropHeldItemIntoWok() {
    if (!heldIngredient) {
      $('#cookFeedback').textContent = '先捏合左侧食材或右侧酱料拿起来';
      return;
    }
    const itemInfo = heldIngredient;
    added.push(itemInfo);
    $('#ingredientCount').textContent = String(added.length);
    const pot = $('#potContent');
    pot.querySelector('.pot-placeholder')?.remove();
    const item = document.createElement('span');
    item.className = 'pot-item';
    const foodArt = document.createElement('img');
    foodArt.src = itemInfo.image;
    foodArt.alt = itemInfo.name;
    item.appendChild(foodArt);
    const idx = added.length - 1;
    const positions = [
      [37,32], [58,38], [28,51], [48,58], [64,56], [39,67], [52,28], [24,40], [68,45], [43,45]
    ];
    const [left, top] = positions[idx % positions.length];
    item.style.left = `calc(${left}% - 11%)`;
    item.style.top = `calc(${top}% - 10%)`;
    item.style.transform = `rotate(${(idx * 31) % 50 - 25}deg)`;
    item.title = itemInfo.name;
    pot.appendChild(item);
    pot.style.filter = heat === 3 ? 'saturate(1.35) brightness(1.08)' : heat === 1 ? 'saturate(.9)' : 'saturate(1.1)';
    heldIngredient = null;
    $('#cookFeedback').textContent = `${itemInfo.name}入锅！${itemInfo.kind === 'sauce' ? '酱香开始融合' : '锅气渐渐起来了'}`;
    $('#wokDropZone').classList.remove('drop-ready');
    syncCookingUI();
    setStatus('下料成功', `锅里已有 ${added.length} 样食材 / 调味；继续取料或翻炒`);
  }

  function stir() {
    if (cook.classList.contains('hidden')) return;
    if (!added.length) {
      $('#cookFeedback').textContent = '先拿取食材或酱料下锅，再开始翻炒';
      return;
    }
    stirCount++;
    $('#potContent').animate(
      [{ transform: 'rotate(0deg)' }, { transform: 'rotate(4deg)' }, { transform: 'rotate(-4deg)' }, { transform: 'rotate(0deg)' }],
      { duration: 550 }
    );
    document.querySelectorAll('.pot-item').forEach((element, i) => {
      element.animate(
        [{ translate: '0 0', rotate: '0deg' }, { translate: `${i % 2 ? 8 : -8}px -5px`, rotate: '35deg' }, { translate: '0 0', rotate: '0deg' }],
        { duration: 550 }
      );
    });
    $('#cookFeedback').textContent = `翻炒第 ${stirCount} 次 · 食材与酱汁正在融合`;
    setStatus('正在翻炒', '捏合锅旁翻炒区，或伸出三指继续翻炒');
  }

  function changeHeat() {
    if (cook.classList.contains('hidden')) return;
    heat = heat % 3 + 1;
    $('#heatIndicator').textContent = HEAT_LABELS[heat];
    $('#fireBtn').textContent = ['🔥 调整火候', '🔥 文火', '🔥 中火', '🔥 大火'][heat];
    $('#cookFeedback').textContent = ['', '文火慢煨，香味渐浓', '中火翻炒，滋滋作响', '大火爆香！锅气十足'][heat];
    $('#potContent').style.filter = heat === 3 ? 'saturate(1.35) brightness(1.08)' : heat === 1 ? 'saturate(.9)' : 'saturate(1.1)';
    $('#fireGlow').className = 'fire-glow' + (heat === 2 ? ' hot-2' : heat === 3 ? ' hot-3' : '');
    setStatus('火候已调整', `${HEAT_LABELS[heat]} · 继续添料并翻炒`);
  }

  function finishDish() {
    if (cook.classList.contains('hidden')) return;
    const ingredients = added.filter(item => item.kind === 'ingredient');
    const sauces = added.filter(item => item.kind === 'sauce');
    if (ingredients.length < 1 || added.length < 2) {
      $('#cookFeedback').textContent = '再加入一样食材或酱料，锅里有两样东西就能成菜';
      setStatus('还差一点食材', '至少加入一项食材和另一项食材 / 酱料后再完成出锅');
      return;
    }
    if (stirCount < 1) {
      $('#cookFeedback').textContent = '先翻炒一次，让食材与酱汁融合，再完成出锅';
      setStatus('还需要翻炒', '捏合翻炒区或用三指翻炒一次');
      return;
    }

    const ids = new Set(added.map(item => item.id));
    const hasPork = ids.has('pork');
    const hasChili = ids.has('chili');
    const hasGreens = ids.has('greens');
    let title, image, story;
    if (hasPork && hasChili) {
      title = ids.has('douban') ? '豆豉辣椒小炒肉' : '湖南辣椒小炒肉';
      image = 'assets/finished-dishes/hunan-chili-pork.webp';
      story = '五花肉煸出油香，鲜辣椒带出湖南风味，趁热下饭最合适。';
    } else if (!hasPork && hasGreens) {
      title = hasChili ? '香辣青菜小炒' : '酱香清炒时蔬';
      image = 'assets/finished-dishes/chili-greens.webp';
      story = '青菜清香裹着酱汁，辣椒提鲜，颜色清亮，口感爽脆。';
    } else if (hasPork) {
      title = ids.has('douban') ? '豆豉酱香小炒肉' : '湘味酱香小炒肉';
      image = 'assets/finished-dishes/hunan-chili-pork.webp';
      story = '肉片吸收了酱汁与锅气，口味厚实，是一道家常湘味。';
    } else {
      title = '红椒下饭小炒';
      image = 'assets/finished-dishes/chili-greens.webp';
      story = '蔬香与辣味在锅中融合，适合配一碗热米饭。';
    }
    const score = Math.min(100, 62 + ingredients.length * 8 + sauces.length * 5 + Math.min(stirCount, 4) * 3 + (heat === 2 ? 5 : heat === 3 ? 2 : 0));
    const grade = score >= 90 ? '掌勺高手 · 锅气十足' : score >= 80 ? '湘味出色 · 香气满满' : score >= 70 ? '家常好味 · 继续精进' : '初次开锅 · 已有雏形';
    $('#dishResultTitle').textContent = title;
    $('#dishResultImage').src = image;
    $('#dishResultImage').alt = title + '成品插画';
    $('#dishResultSummary').textContent = story + ` 本次火候：${HEAT_LABELS[heat]}；翻炒 ${stirCount} 次。`;
    $('#dishResultGrade').textContent = `掌勺评分：${score} · ${grade}`;
    $('#dishResultIngredients').textContent = `用到：${added.map(item => item.name).join('、')}`;
    $('#dishResultModal').classList.remove('hidden');
    dishCreated = true;
    $('#cookFeedback').textContent = '成品已完成！可以继续调整，或端菜回街巷';
    setStatus('成品已生成', `${title} · ${score} 分`);
  }

  function closeDishResult() { $('#dishResultModal').classList.add('hidden'); }

  function gesture(name) {
    const key = String(name || '').toLowerCase();
    if (['walk','forward','walking','fist'].includes(key)) {
      if (cook.classList.contains('hidden')) startWalk(true);
      else setStatus('握拳已识别', '烹饪时不会移动小熊；捏合翻炒区或伸出三指来翻炒');
    } else if (['stop','idle','open_palm','open-palm','none'].includes(key)) {
      if (cook.classList.contains('hidden')) startWalk(false);
      else setStatus('手势已松开', heldIngredient ? `手中仍拿着${heldIngredient.name}，移动到锅区松开即可下料` : '捏合食材或酱料取用');
    } else if (['left','point_left','point-left','turn_left'].includes(key)) {
      if (cook.classList.contains('hidden')) face(-1);
      else cycleKitchenTarget(-1);
    } else if (['right','point_right','point-right','turn_right'].includes(key)) {
      if (cook.classList.contains('hidden')) face(1);
      else cycleKitchenTarget(1);
    } else if (['confirm','enter','pinch','select'].includes(key)) {
      if (cook.classList.contains('hidden')) enterShop();
      else pickUpOrDropIngredient();
    } else if (['stir','mix','rotate'].includes(key)) {
      stir();
    } else if (['fire','heat','thumbs_up'].includes(key)) {
      changeHeat();
    } else {
      setStatus('已收到手势：' + key, '如需映射，请在 gesture() 中补充对应标签');
    }
  }

  // Public bridge retained for existing external gesture integration.
  window.handleRecognizedGesture = gesture;
  window.foodWarsGestureControls = {
    walk: () => startWalk(true), stop: () => startWalk(false),
    turnLeft: () => gesture('left'), turnRight: () => gesture('right'),
    confirm: () => gesture('confirm'), stir: () => stir(), fire: () => changeHeat(),
    nextIngredient: () => cycleKitchenTarget(1), pickupOrDrop: () => pickUpOrDropIngredient()
  };
  window.dispatchEvent(new CustomEvent('foodwars:gesture-ready'));
  window.addEventListener('foodwars:gesture', event => gesture(event.detail?.gesture || event.detail));

  document.addEventListener('keydown', event => {
    if (['ArrowLeft','ArrowRight','ArrowUp',' ','Enter'].includes(event.key)) event.preventDefault();
    if (event.key === 'ArrowLeft') move(-1);
    if (event.key === 'ArrowRight') move(1);
    if (event.key === 'ArrowUp') { if (cook.classList.contains('hidden')) startWalk(true); else pickUpOrDropIngredient(); }
    if (event.key === ' ') { if (cook.classList.contains('hidden')) startWalk(false); else stir(); }
    if (event.key === 'Enter') { if (cook.classList.contains('hidden')) enterShop(); else pickUpOrDropIngredient(); }
    if (event.key.toLowerCase() === 's') stir();
    if (event.key.toLowerCase() === 'f') changeHeat();
  });

  $('#turnLeft').addEventListener('click', () => move(-1));
  $('#turnRight').addEventListener('click', () => move(1));
  const walkButton = $('#walkToggle');
  walkButton.addEventListener('pointerdown', event => { event.preventDefault(); startWalk(true); });
  ['pointerup','pointercancel','pointerleave'].forEach(type => walkButton.addEventListener(type, () => startWalk(false)));
  $('#enterShopBtn').addEventListener('click', enterShop);
  shops.forEach((shop, index) => shop.addEventListener('click', () => walkToShop(index)));
  document.querySelectorAll('[data-map-shop]').forEach(node => {
    node.addEventListener('click', () => walkToShop(Number(node.dataset.mapShop)));
  });
  $('#backToStreet').addEventListener('click', backStreet);
  document.querySelectorAll('.kitchen-object').forEach(button => {
    button.addEventListener('click', () => acquireKitchenItem(button.dataset.kitchenItem));
  });
  $('#wokDropZone').addEventListener('click', () => {
    if (heldIngredient) dropHeldItemIntoWok();
    else $('#cookFeedback').textContent = '先从左侧拿食材，或从右侧拿酱料';
  });
  $('#fireZone').addEventListener('click', changeHeat);
  $('#stirZone').addEventListener('click', stir);
  $('#pickupIngredient').addEventListener('click', pickUpOrDropIngredient);
  $('#stirBtn').addEventListener('click', stir);
  $('#fireBtn').addEventListener('click', changeHeat);
  $('#finishDishBtn').addEventListener('click', finishDish);
  $('#closeDishResult').addEventListener('click', closeDishResult);
  $('#continueCooking').addEventListener('click', closeDishResult);
  $('#serveDishBtn').addEventListener('click', () => { closeDishResult(); backStreet(); });
  $('#dishResultModal').addEventListener('click', event => { if (event.target === $('#dishResultModal')) closeDishResult(); });

  const modal = $('#helpModal');
  $('#helpBtn').addEventListener('click', () => modal.classList.remove('hidden'));
  $('#closeHelp').addEventListener('click', () => modal.classList.add('hidden'));
  $('#closeHelpBottom').addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', event => { if (event.target === modal) modal.classList.add('hidden'); });

  function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function extendedFinger(lm, tip, pip) {
    // Compare the fingertip-to-wrist and PIP-to-wrist distances to tolerate hand scale changes.
    return distance(lm[tip], lm[0]) > distance(lm[pip], lm[0]) * 1.14;
  }
  function gestureFromLandmarks(lm) {
    const palmWidth = distance(lm[5], lm[17]);
    const handScale = Math.max(distance(lm[0], lm[9]), palmWidth, 0.065);
    const pinchGap = distance(lm[4], lm[8]) / handScale;

    // Pinch has separate start/release thresholds (hysteresis) to avoid flickering near the edge.
    if (pinchGestureActive) {
      if (pinchGap <= 0.36) return { key: 'pinch', label: '捏合保持：拿取 / 下料' };
      pinchGestureActive = false;
    }
    if (pinchGap < 0.245) {
      pinchGestureActive = true;
      return { key: 'pinch', label: '拇指与食指捏合：拿取 / 确认' };
    }

    const fingers = [
      extendedFinger(lm, 8, 6), extendedFinger(lm, 12, 10),
      extendedFinger(lm, 16, 14), extendedFinger(lm, 20, 18)
    ];
    const count = fingers.filter(Boolean).length;
    const thumbOpen = distance(lm[4], lm[5]) > distance(lm[3], lm[5]) * 1.14;

    if (count === 0) return { key: 'walk', label: '握拳：持续行走' };
    if (count === 4 && thumbOpen) return { key: 'stop', label: '张开手掌：停止行走' };

    // Direction classification requires one extended index finger with a strong horizontal vector.
    if (count === 1 && fingers[0]) {
      const dx = lm[8].x - lm[5].x;
      const dy = lm[8].y - lm[5].y;
      const horizontal = Math.abs(dx) > Math.max(0.055, handScale * 0.48) && Math.abs(dx) > Math.abs(dy) * 1.35;
      if (horizontal) {
        // The live preview is mirrored: raw positive X points to the player's visible left.
        return dx > 0
          ? { key: 'left', label: '食指朝画面左侧：转向左' }
          : { key: 'right', label: '食指朝画面右侧：转向右' };
      }
      return null;
    }
    if (count === 3 && fingers[0] && fingers[1] && fingers[2]) return { key: 'stir', label: '三指：翻炒' };
    if (count === 4 && !thumbOpen) return { key: 'fire', label: '四指伸展：调整火候' };
    return null;
  }

  function stableGestureFromHistory() {
    if (!gestureHistory.length) return null;
    const counts = new Map();
    for (const item of gestureHistory) if (item) counts.set(item.key, (counts.get(item.key) || 0) + 1);
    let bestKey = null, bestCount = 0;
    for (const [key, count] of counts) if (count > bestCount) { bestKey = key; bestCount = count; }
    const required = Math.max(2, Math.ceil(gestureHistory.length * 0.62));
    if (!bestKey || bestCount < required) return null;
    return [...gestureHistory].reverse().find(item => item && item.key === bestKey) || null;
  }

  function cameraPointInWorkspace(lm) {
    const workspace = $('#kitchenWorkspace');
    if (!workspace || cook.classList.contains('hidden')) return null;
    const rect = workspace.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    // Preview mirrors the front camera, so convert the raw horizontal coordinate to preview space.
    const rawX = (lm[4].x + lm[8].x) / 2;
    const rawY = (lm[4].y + lm[8].y) / 2;
    const nx = 1 - rawX;
    const ny = rawY;
    return { x: rect.left + nx * rect.width, y: rect.top + ny * rect.height, nx, ny };
  }

  function pointInsideElement(point, selector) {
    if (!point) return false;
    const element = typeof selector === 'string' ? $(selector) : selector;
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
  }

  function findKitchenObjectAtPoint(point) {
    if (!point) return null;
    let best = null;
    let bestDistance = Infinity;
    for (const object of document.querySelectorAll('.kitchen-object:not(.is-taken)')) {
      const rect = object.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const dx = point.x - centerX;
      const dy = point.y - centerY;
      const rx = rect.width * 0.60 + 8;
      const ry = rect.height * 0.58 + 8;
      if (Math.abs(dx) <= rx && Math.abs(dy) <= ry) {
        const normalizedDistance = (dx / rx) ** 2 + (dy / ry) ** 2;
        if (normalizedDistance < bestDistance) { best = object; bestDistance = normalizedDistance; }
      }
    }
    return best;
  }

  function updateHandCursor(point) {
    const cursor = $('#handCursor');
    if (!point || cook.classList.contains('hidden')) {
      cursor.classList.remove('visible');
      $('#wokDropZone').classList.remove('drop-ready');
      document.querySelectorAll('.kitchen-object').forEach(object => object.classList.remove('cursor-target'));
      return;
    }
    cursor.style.left = `${point.nx * 100}%`;
    cursor.style.top = `${point.ny * 100}%`;
    // Keep the pinch cursor visible even before grabbing, so the player can aim at an object.
    cursor.classList.toggle('visible', cameraOn && !cook.classList.contains('hidden'));
    $('#handCursorEmoji').textContent = heldIngredient ? heldIngredient.emoji : '🤏';
    const hovered = findKitchenObjectAtPoint(point);
    document.querySelectorAll('.kitchen-object').forEach(object => object.classList.toggle('cursor-target', object === hovered));
    $('#wokDropZone').classList.toggle('drop-ready', Boolean(heldIngredient) && pointInsideElement(point, $('#wokDropZone')));
  }

  function handleKitchenPinchStart(point) {
    if (!point) {
      setStatus('已识别捏合', '请把捏合点移动到左侧食材、右侧酱料或火候区域');
      return;
    }
    const object = findKitchenObjectAtPoint(point);
    if (object) {
      acquireKitchenItem(object.dataset.kitchenItem);
      return;
    }
    if (pointInsideElement(point, '#fireZone')) { changeHeat(); return; }
    if (pointInsideElement(point, '#stirZone')) { stir(); return; }
    if (pointInsideElement(point, '#wokDropZone')) {
      $('#cookFeedback').textContent = heldIngredient ? `拿着${heldIngredient.name}；松开手指就会下锅` : '先捏合左侧食材或右侧酱料拿取';
      return;
    }
    $('#cookFeedback').textContent = heldIngredient
      ? `手中是${heldIngredient.name}；移到中央炒锅上方再松开`
      : '捏合点落在空白处；请移到案板食材或酱料瓶上';
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
      pinchGestureActive = false;
      if (pinchActive) {
        pinchActive = false;
        pinchActionDone = false;
        pinchStartedAt = 0;
        pinchStartPoint = null;
        lastPinchPoint = null;
      }
      updateHandCursor(null);
      if (now - missingHandSince > 180 && now - lastNoHandStatusAt > 600) {
        $('#cameraHint').textContent = '请把手放入镜头画面，并保持动作清晰';
        lastNoHandStatusAt = now;
      }
      if (walking && now - missingHandSince >= 380) {
        startWalk(false);
        latchedGesture = '';
        setStatus('行走已安全停止', '摄像头暂时没有识别到手；重新举手并保持握拳即可继续');
      }
      if (now - missingHandSince >= 380) latchedGesture = '';
      return;
    }

    missingHandSince = 0;
    const point = cameraPointInWorkspace(lm);
    lastHandPoint = point;
    const rawGesture = gestureFromLandmarks(lm);

    // Pinch-start picks up an object. Keeping the pinch closed moves the held object;
    // releasing it while over the wok drops the object into the pan.
    if (rawGesture?.key === 'pinch') {
      gestureHistory = [];
      candidateGesture = '';
      candidateSince = 0;
      unknownGestureSince = 0;
      if (!pinchActive) {
        pinchActive = true;
        pinchStartedAt = now;
        pinchStartPoint = point;
        pinchActionDone = false;
      }
      lastPinchPoint = point;
      if (!cook.classList.contains('hidden')) updateHandCursor(point);
      $('#cameraHint').textContent = cook.classList.contains('hidden')
        ? '保持捏合约半秒；只有靠近店门提示出现时才进入'
        : (heldIngredient ? '已拿起 ' + heldIngredient.name + ' · 看着圆点移到锅心，再松开手指' : '先看工作台里的🤏圆点；对准食材 / 酱料捏合约0.17秒拿起');

      const dwell = cook.classList.contains('hidden') ? 520 : 170;
      if (!pinchActionDone && now - pinchStartedAt >= dwell) {
        pinchActionDone = true;
        if (cook.classList.contains('hidden')) {
          if (nearShop >= 0) enterShop();
          else {
            setStatus('还没走到店门口', '捏合已识别，但必须先靠近店门并出现提示');
            $('#streetSubcaption').textContent = '先走到门口，出现“发现一家店”提示后再捏合';
          }
        } else {
          handleKitchenPinchStart(pinchStartPoint);
          // Reposition the held-object cursor at the current hand location.
          updateHandCursor(point);
        }
      }
      return;
    }

    // Pinch was released. Only a release over the wok counts as dropping the held item.
    if (pinchActive) {
      const releasePoint = lastPinchPoint || point;
      if (!cook.classList.contains('hidden') && pinchActionDone && heldIngredient && pointInsideElement(releasePoint, '#wokDropZone')) {
        dropHeldItemIntoWok();
      }
      pinchActive = false;
      pinchStartedAt = 0;
      pinchActionDone = false;
      pinchStartPoint = null;
      lastPinchPoint = null;
      latchedGesture = '';
    }

    if (!rawGesture) {
      gestureHistory = [];
      candidateGesture = '';
      candidateSince = 0;
      if (!unknownGestureSince) unknownGestureSince = now;
      $('#cameraHint').textContent = '手势不明确：请只伸食指水平指向，或清晰地拇指食指捏合';
      if (now - unknownGestureSince >= 280) latchedGesture = '';
      if (walking && now - unknownGestureSince >= 650) startWalk(false);
      return;
    }
    unknownGestureSince = 0;
    if (!cook.classList.contains('hidden')) updateHandCursor(point);

    gestureHistory.push(rawGesture);
    if (gestureHistory.length > 7) gestureHistory.shift();
    const stable = stableGestureFromHistory();
    if (!stable) {
      $('#cameraHint').textContent = rawGesture.label + ' · 正在稳定识别…';
      return;
    }
    $('#cameraHint').textContent = stable.label + ' · 保持动作稳定';

    if (candidateGesture !== stable.key) {
      candidateGesture = stable.key;
      candidateSince = now;
      // A clearly different stable pose releases the previous one-shot action latch.
      if (latchedGesture !== stable.key) latchedGesture = '';
      return;
    }

    const dwellByGesture = { walk: 260, stop: 180, left: 260, right: 260, stir: 280, fire: 320 };
    const dwell = dwellByGesture[stable.key] ?? 280;
    const minGap = ['left','right'].includes(stable.key) ? 240 : 280;
    if (now - candidateSince >= dwell && latchedGesture !== stable.key && now - lastGestureAt >= minGap) {
      latchedGesture = stable.key;
      lastGestureAt = now;
      gesture(stable.key);
    }
  }

  async function toggleCamera() {
    if (cameraOn) { stopCamera(); return; }
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('摄像头不可用', '请使用 localhost 或 HTTPS；键盘与界面按钮仍可操作');
      return;
    }
    $('#cameraPanel').classList.remove('hidden');
    $('#cameraToggle').textContent = '关闭摄像头';
    $('#cameraHint').textContent = '正在请求摄像头权限…';
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      const video = $('#gestureVideo');
      video.srcObject = cameraStream;
      await video.play();
      if (!window.Hands) throw new Error('MediaPipe Hands 未加载，请检查网络后刷新页面。');
      handsModel = new window.Hands({ locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
      handsModel.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.65, minTrackingConfidence: 0.60 });
      handsModel.onResults(onCameraResults);
      cameraOn = true;
      $('#cameraDot').classList.add('live');
      setStatus('摄像头手势已连接', '握拳行走 · 张掌停止 · 单食指横指转向 · 门口捏合进入');
      let lastTime = -1;
      const frame = async () => {
        if (!cameraOn || !handsModel) return;
        if (video.readyState >= 2 && video.currentTime !== lastTime) {
          lastTime = video.currentTime;
          try { await handsModel.send({ image: video }); } catch (error) { console.warn(error); }
        }
        cameraLoop = requestAnimationFrame(frame);
      };
      frame();
    } catch (error) {
      console.error(error);
      stopCamera();
      $('#cameraPanel').classList.remove('hidden');
      $('#cameraHint').textContent = error.message || '摄像头启动失败';
      setStatus('摄像头未启动', '请检查权限、HTTPS / localhost 和网络');
    }
  }

  function stopCamera() {
    cameraOn = false;
    if (cameraLoop) cancelAnimationFrame(cameraLoop);
    cameraLoop = null;
    if (handsModel) { try { handsModel.close(); } catch (_) {} handsModel = null; }
    if (cameraStream) cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
    const video = $('#gestureVideo');
    if (video) video.srcObject = null;
    if (walking) startWalk(false);
    pinchActive = false;
    pinchGestureActive = false;
    pinchActionDone = false;
    pinchStartedAt = 0;
    pinchStartPoint = null;
    lastPinchPoint = null;
    lastHandPoint = null;
    $('#cameraDot').classList.remove('live');
    $('#cameraToggle').textContent = '开启摄像头手势';
    $('#cameraPanel').classList.add('hidden');
    $('#handCursor').classList.remove('visible');
    $('#wokDropZone').classList.remove('drop-ready');
    candidateGesture = '';
    candidateSince = 0;
    latchedGesture = '';
    gestureHistory = [];
    missingHandSince = 0;
    unknownGestureSince = 0;
    syncCookingUI();
    setStatus('手势控制已就绪', '可用键盘、界面按钮或摄像头手势');
  }

  $('#cameraToggle').addEventListener('click', toggleCamera);
  $('#cameraClose').addEventListener('click', stopCamera);
  window.addEventListener('beforeunload', stopCamera);
  window.addEventListener('resize', () => { updatePlayer(); updateNearby(); });

  syncCookingUI();
  updatePlayer();
  updateNearby();
})();
