/* 湘味寻宝 · Food Wars card-combo + optional MediaPipe hand gestures. */
(() => {
  "use strict";
  const API_URL = "http://127.0.0.1:1234/v1/chat/completions";
  // LM Studio: if your server needs a specific model id, change this to the loaded model id.
  const LOCAL_MODEL = "local-model";
  const REQUEST_TIMEOUT_MS = 60000;
  const DEMO_FALLBACK = true;
  const MAX_INGREDIENTS = 2;
  const $ = (s) => document.querySelector(s);
  const cards = [...document.querySelectorAll(".ingredient-card")];
  const byId = Object.fromEntries(cards.map((card) => [card.dataset.id, card]));
  const pot = $("#cauldronDrop");
  const playfield = $("#playfield");
  const toast = $("#toast");
  const selected = [];
  let busy = false;
  let toastTimer = null;
  let activeDrag = null;
  let autoCookTimer = null;
  let gestureRunning = false;
  let gestureHands = null;
  let cameraStream = null;
  let gestureLoop = null;
  let gestureCandidate = null;
  let gestureSince = 0;
  let gestureLatched = false;
  let lastGestureAction = 0;

  const ingredients = {
    chili: { name: "辣椒", flavor: "鲜辣、香气明亮", description: "鲜红辣椒把热烈的辛香带进锅里，让整道创意湘味一入口就醒神。" },
    pork: { name: "猪肉", flavor: "油润、鲜香、回味醇厚", description: "猪五花煸出醇厚肉香，让锅里的滋味更饱满圆润，香气一层层铺开。" },
    fish: { name: "鱼头", flavor: "鲜嫩、鲜香、层次分明", description: "鲜鱼带来细腻的鲜味，遇上湖南式辛香，鲜、香、辣在热气里交织。" },
    bacon: { name: "湘西腊肉", flavor: "烟熏、咸香、山野气息", description: "湘西腊肉的烟熏香融入汤汁，让这锅创意湘味多了深沉的山野气息。" }
  };
  const gestureMap = { 1: "chili", 2: "pork", 3: "fish", 4: "bacon" };
  const gestureNames = { 1: "一指 · 辣椒", 2: "两指 · 猪肉", 3: "三指 · 鱼头", 4: "四指 · 湘西腊肉" };

  function toastMessage(message) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
  }

  function status(message) { $("#stageStatus").textContent = message; }

  function updateUI() {
    cards.forEach((card) => {
      const isSelected = selected.includes(card.dataset.id);
      card.classList.toggle("selected", isSelected);
      card.setAttribute("aria-pressed", String(isSelected));
      card.disabled = busy;
      card.draggable = false;
    });
    $("#potCounter").textContent = `${selected.length} / ${MAX_INGREDIENTS} 入锅`;
    $("#potHint").hidden = selected.length > 0 || busy;
    pot.classList.toggle("has-ingredients", selected.length > 0);
    $("#potChipRow").replaceChildren(...selected.map((id) => {
      const chip = document.createElement("span");
      chip.className = "pot-chip";
      chip.textContent = ingredients[id].name;
      return chip;
    }));
    if (!busy) {
      if (selected.length === 0) status("先选一张卡牌。第二张食材投入后，锅会自动开始烹饪。");
      else if (selected.length === 1) status(`「${ingredients[selected[0]].name}」已入锅，再投一张不同的食材卡！`);
    }
  }

  function animateCardIntoPot(id) {
    const card = byId[id];
    if (!card) return;
    const from = card.getBoundingClientRect();
    const target = pot.getBoundingClientRect();
    const ghost = card.cloneNode(true);
    ghost.className = "drag-ghost";
    ghost.removeAttribute("id");
    ghost.style.left = `${from.left + from.width / 2}px`;
    ghost.style.top = `${from.top + from.height / 2}px`;
    ghost.style.width = `${from.width}px`;
    ghost.style.height = `${from.height}px`;
    ghost.querySelectorAll("button").forEach((b) => b.remove());
    document.body.appendChild(ghost);
    void ghost.offsetWidth;
    ghost.style.transition = "left .55s cubic-bezier(.2,.8,.2,1), top .55s cubic-bezier(.2,.8,.2,1), transform .55s ease, opacity .55s ease";
    ghost.style.left = `${target.left + target.width / 2}px`;
    ghost.style.top = `${target.top + target.height * .52}px`;
    ghost.style.transform = "translate(-50%,-50%) rotate(16deg) scale(.28)";
    ghost.style.opacity = ".08";
    setTimeout(() => ghost.remove(), 620);
  }

  function addIngredient(id, source = "tap") {
    if (!ingredients[id] || busy) return false;
    if (selected.includes(id)) {
      toastMessage(`${ingredients[id].name} 已经在锅里啦，换一张卡吧！`);
      return false;
    }
    if (selected.length >= MAX_INGREDIENTS) return false;
    animateCardIntoPot(id);
    selected.push(id);
    updateUI();
    pot.classList.add("has-ingredients");
    toastMessage(`${source === "gesture" ? "手势投料！" : "投料成功！"} ${ingredients[id].name} 入锅`);
    if (selected.length === MAX_INGREDIENTS) {
      status("两张食材已投入！锅火升起，正在生成你的创意湘菜……");
      clearTimeout(autoCookTimer);
      autoCookTimer = setTimeout(cook, 650);
    }
    return true;
  }

  function toggleIngredient(id) {
    if (busy) return;
    if (selected.includes(id)) {
      selected.splice(selected.indexOf(id), 1);
      updateUI();
      toastMessage(`已取出${ingredients[id].name}`);
      return;
    }
    addIngredient(id, "tap");
  }

  function parseJsonResponse(text) {
    const trimmed = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end < start) throw new Error("模型返回的内容不是 JSON");
    return JSON.parse(trimmed.slice(start, end + 1));
  }

  function validateDish(dish) {
    const clean = (value, fallback, max = 180) => typeof value === "string" ? value.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, max) || fallback : fallback;
    const rarity = clean(dish.rarity, "湘味创意", 20);
    return {
      name: clean(dish.name, "湘味创意小炒", 36),
      description: clean(dish.description, "两种食材在热锅中相遇，碰撞出鲜辣又有层次的湖南风味。", 180),
      hunanFlavor: clean(dish.hunanFlavor, "香辣鲜明，锅气十足。", 90),
      rarity: ["普通", "稀有", "传说"].includes(rarity) ? rarity : "湘味创意"
    };
  }

  async function requestDish(ids, signal) {
    const ingredientText = ids.map((id) => ingredients[id].name).join("、");
    const response = await fetch(API_URL, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal,
      body: JSON.stringify({
        model: LOCAL_MODEL, temperature: 0.85,
        messages: [
          { role: "system", content: "你是湖南创意湘菜主厨，为卡通烹饪游戏设计菜品。严格返回一个 JSON 对象，不要 Markdown 或额外说明，字段为 name（简短中文菜名）、description（不超过70字、诱人但不浮夸的介绍）、hunanFlavor（不超过45字，说明湖南风味特色）、rarity（普通/稀有/传说）。可以自由创意，但不要谎称虚构菜是传统名菜，不要添加用户未提供的主食材。" },
          { role: "user", content: `本次仅使用这些主食材：${ingredientText}。请组合成一道有湖南风味的创意菜。` }
        ]
      })
    });
    if (!response.ok) throw new Error(`LM Studio 请求失败（HTTP ${response.status}）`);
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new Error("模型没有返回文本内容");
    return validateDish(parseJsonResponse(content));
  }

  function makeDemoDish(ids) {
    const has = (id) => ids.includes(id);
    if (has("chili") && has("pork")) return { name: "烈焰椒香小炒肉", description: "五花肉煸出醇厚油香，再让鲜辣椒裹住每一片肉，香气扑面，特别适合配一碗热米饭。", hunanFlavor: "鲜辣开胃、锅气十足，灵感来自湖南家常小炒的热烈风味。", rarity: "稀有" };
    if (has("chili") && has("fish")) return { name: "剁椒鲜鱼头小锅", description: "鲜嫩鱼头遇上红辣椒的清亮辛香，热气掀开的一刻，鲜味与辣味一起扑鼻而来。", hunanFlavor: "鲜、辣、香交织；属于创意搭配，并非传统菜谱复刻。", rarity: "传说" };
    if (has("chili") && has("bacon")) return { name: "湘西烟香爆椒腊肉", description: "腊肉的烟熏香落进滚烫的辣椒锅，咸香与鲜辣层层叠起，越嚼越有山野味。", hunanFlavor: "烟熏腊香碰上鲜辣椒，浓郁直接，带有湘西风味灵感。", rarity: "稀有" };
    if (has("pork") && has("fish")) return { name: "双鲜浓汤炖锅", description: "猪肉的醇厚与鱼头的鲜甜慢慢交融，汤汁浓润，入口鲜香而有层次。", hunanFlavor: "以鲜味为主，配少许湖南式辛香提味。", rarity: "稀有" };
    if (has("pork") && has("bacon")) return { name: "双重肉香焖锅", description: "猪肉的柔润和腊肉的烟熏咸香融合，慢火焖煮后香气更深，口感浓郁饱满。", hunanFlavor: "烟熏腊香与肉脂浓香叠加，适合喜欢厚味的人。", rarity: "传说" };
    return { name: "鱼香腊味创意锅", description: "鱼头的鲜嫩遇上腊肉的烟香，热汤把两种风味串联起来，鲜香浓厚，回味悠长。", hunanFlavor: "鲜味、烟香与辣味相互衬托，是一道创意湘味组合。", rarity: "稀有" };
  }

  function renderDish(dish, ids, isDemo) {
    $("#resultName").textContent = dish.name;
    $("#resultDescription").textContent = dish.description;
    $("#resultFlavor").textContent = dish.hunanFlavor;
    $("#resultRarity").textContent = `${dish.rarity} · 湘味创意解锁`;
    $("#resultIngredients").replaceChildren(...ids.map((id) => {
      const chip = document.createElement("span"); chip.textContent = ingredients[id].name; return chip;
    }));
    $("#demoNote").hidden = !isDemo;
    $("#resultOverlay").hidden = false;
    $("#closeResult").focus({ preventScroll: true });
  }

  async function cook() {
    if (busy || selected.length !== MAX_INGREDIENTS) return;
    busy = true;
    playfield.classList.add("is-cooking");
    clearTimeout(autoCookTimer);
    cards.forEach((card) => { card.disabled = true; });
    const ids = [...selected];
    pot.classList.add("cooking-now");
    $("#potCookingBadge").hidden = false;
    $("#potCookingText").textContent = `${ids.map((id) => ingredients[id].name).join(" + ")} 正在锅里翻滚！`;
    $("#potHint").hidden = true;
    status("湘味正在融合……模型生成期间，锅会持续翻滚和冒蒸汽。请稍等！");
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let dish; let isDemo = false;
    try {
      const minAnimation = new Promise((resolve) => setTimeout(resolve, 1700));
      try {
        const request = requestDish(ids, controller.signal);
        [dish] = await Promise.all([request, minAnimation]);
      } catch (error) {
        if (!DEMO_FALLBACK) throw error;
        dish = makeDemoDish(ids); isDemo = true;
        $("#potCookingText").textContent = "灶火续上！正在整理创意菜谱……";
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
    } catch (error) {
      console.error("AI cooking request failed:", error);
      toastMessage(error.name === "AbortError" ? "模型等待超时，请确认 LM Studio 仍在运行。" : "模型连接失败，请检查接口地址和 CORS 设置。");
      status("这锅先留在灶上。检查模型后，可以重置再试。 ");
      selected.splice(0, selected.length);
      updateUI();
      return;
    } finally {
      clearTimeout(timeoutId);
      busy = false;
      playfield.classList.remove("is-cooking");
      pot.classList.remove("cooking-now");
      $("#potCookingBadge").hidden = true;
      updateUI();
    }
    // The recipe overlay appears only after the inline pot animation finishes.
    renderDish(dish, ids, isDemo);
  }

  function resetRound() {
    clearTimeout(autoCookTimer);
    if (busy) { toastMessage("锅正在烹饪，请等这道菜揭晓后再重置。"); return; }
    selected.splice(0, selected.length);
    $("#resultOverlay").hidden = true;
    $("#potCookingBadge").hidden = true;
    pot.classList.remove("cooking-now", "has-ingredients", "drag-over");
    playfield.classList.remove("is-cooking");
    updateUI();
    toastMessage("锅已经清好啦，换一组卡牌重新开始！");
  }

  function finishResult() {
    $("#resultOverlay").hidden = true;
    selected.splice(0, selected.length);
    updateUI();
  }

  // Mouse/touch drag works without a camera. Pointer drag is used for consistent touch handling.
  cards.forEach((card) => {
    card.addEventListener("click", (event) => {
      if (card.dataset.justDragged === "true") { card.dataset.justDragged = "false"; event.preventDefault(); return; }
      toggleIngredient(card.dataset.id);
    });
    card.addEventListener("pointerdown", (event) => {
      if (busy || event.button !== 0) return;
      activeDrag = { id: card.dataset.id, card, startX: event.clientX, startY: event.clientY, moved: false, ghost: null };
      try { card.setPointerCapture(event.pointerId); } catch (_) {}
    });
    card.addEventListener("pointermove", (event) => {
      if (!activeDrag || activeDrag.card !== card) return;
      const dx = event.clientX - activeDrag.startX; const dy = event.clientY - activeDrag.startY;
      if (!activeDrag.moved && Math.hypot(dx, dy) > 12) {
        activeDrag.moved = true;
        const rect = card.getBoundingClientRect();
        const ghost = card.cloneNode(true); ghost.className = "drag-ghost";
        ghost.style.left = `${event.clientX}px`; ghost.style.top = `${event.clientY}px`;
        ghost.style.width = `${rect.width}px`; ghost.style.height = `${rect.height}px`;
        document.body.appendChild(ghost); activeDrag.ghost = ghost; card.classList.add("dragging-source");
      }
      if (activeDrag.moved && activeDrag.ghost) {
        activeDrag.ghost.style.left = `${event.clientX}px`; activeDrag.ghost.style.top = `${event.clientY}px`;
        const potRect = pot.getBoundingClientRect();
        const onPot = event.clientX >= potRect.left && event.clientX <= potRect.right && event.clientY >= potRect.top && event.clientY <= potRect.bottom;
        pot.classList.toggle("drag-over", onPot);
      }
    });
    const endDrag = (event) => {
      if (!activeDrag || activeDrag.card !== card) return;
      const drag = activeDrag; activeDrag = null;
      if (drag.ghost) drag.ghost.remove(); card.classList.remove("dragging-source"); pot.classList.remove("drag-over");
      if (drag.moved) {
        card.dataset.justDragged = "true"; setTimeout(() => { card.dataset.justDragged = "false"; }, 250);
        const r = pot.getBoundingClientRect();
        const onPot = event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom;
        if (onPot) addIngredient(drag.id, "drag");
        else toastMessage("把卡牌拖到中央烹饪锅上再松手！");
      }
    };
    card.addEventListener("pointerup", endDrag);
    card.addEventListener("pointercancel", endDrag);
  });

  pot.addEventListener("dragover", (event) => { event.preventDefault(); pot.classList.add("drag-over"); });
  pot.addEventListener("dragleave", () => pot.classList.remove("drag-over"));
  pot.addEventListener("drop", (event) => {
    event.preventDefault(); pot.classList.remove("drag-over"); const id = event.dataTransfer?.getData("text/plain"); if (id) addIngredient(id, "drag");
  });
  cards.forEach((card) => card.addEventListener("dragstart", (event) => { event.dataTransfer?.setData("text/plain", card.dataset.id); }));
  $("#resetButton").addEventListener("click", resetRound);
  $("#closeResult").addEventListener("click", finishResult);
  $("#closeResultButton").addEventListener("click", finishResult);
  $("#newMix").addEventListener("click", () => { finishResult(); toastMessage("选两张新卡，继续探索湘味！"); });
  $("#resultOverlay").addEventListener("click", (event) => { if (event.target === $("#resultOverlay")) finishResult(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !$("#resultOverlay").hidden) finishResult(); });

  // ---------------- Camera gesture control ----------------
  function setCameraStatus(message, live = false) {
    $("#cameraStatus").textContent = message;
    $("#cameraDot").classList.toggle("live", live);
    $("#gesturePanel").classList.toggle("active", live);
  }

  function countRaisedFingers(landmarks) {
    // Index, middle, ring and pinky. Counting these four avoids handedness-dependent thumb logic.
    const pairs = [[8, 6], [12, 10], [16, 14], [20, 18]];
    let count = 0;
    for (const [tip, pip] of pairs) if (landmarks[tip].y < landmarks[pip].y - 0.025) count++;
    return count;
  }

  function resetGestureCandidate() {
    gestureCandidate = null; gestureSince = 0; gestureLatched = false;
  }

  function handleHandResults(results) {
    if (!gestureRunning) return;
    const landmarks = results.multiHandLandmarks?.[0];
    if (!landmarks) {
      resetGestureCandidate();
      $("#gestureFeedback").textContent = "把手放进镜头。举起 1–4 根手指，保持约 0.7 秒。";
      return;
    }
    const count = countRaisedFingers(landmarks);
    const id = gestureMap[count];
    if (!id) {
      resetGestureCandidate();
      $("#gestureFeedback").textContent = selected.length === 1 ? "再举一个不同的手势卡，投进锅里。" : "识别到手掌，请伸出 1–4 根手指选择食材。";
      return;
    }
    $("#gestureFeedback").textContent = `识别：${gestureNames[count]}。保持手势即可投料。`;
    const now = performance.now();
    if (gestureCandidate !== id) {
      gestureCandidate = id; gestureSince = now; gestureLatched = false;
      return;
    }
    if (!gestureLatched && now - gestureSince >= 720 && now - lastGestureAction >= 900) {
      gestureLatched = true; lastGestureAction = now;
      const success = addIngredient(id, "gesture");
      if (success) {
        $("#gestureFeedback").textContent = `投放成功：${ingredients[id].name}！换一个手势投第二张卡。`;
        spawnStars();
      }
    }
  }

  function spawnStars() {
    const rect = pot.getBoundingClientRect();
    for (let i = 0; i < 3; i++) {
      const star = document.createElement("span"); star.className = "cook-shine"; star.textContent = i === 1 ? "✦" : "✧";
      star.style.left = `${rect.left + rect.width * (0.35 + .15 * i)}px`;
      star.style.top = `${rect.top + rect.height * .35}px`;
      document.body.appendChild(star); setTimeout(() => star.remove(), 720);
    }
  }

  async function startCamera() {
    if (gestureRunning) { stopCamera(); return; }
    if (!navigator.mediaDevices?.getUserMedia) {
      toastMessage("当前浏览器不支持摄像头；请使用 localhost 或 HTTPS。卡牌点击仍可使用。"); return;
    }
    $("#gesturePanel").hidden = false;
    $("#gestureToggle").textContent = "✋ 关闭手势";
    setCameraStatus("正在启动…", false);
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      const video = $("#gestureVideo"); video.srcObject = cameraStream; await video.play();
      if (!window.Hands) throw new Error("MediaPipe Hands 脚本未加载；检查网络后再试。");
      gestureHands = new window.Hands({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
      gestureHands.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.6, minTrackingConfidence: 0.55 });
      gestureHands.onResults(handleHandResults);
      gestureRunning = true; setCameraStatus("手势已开启", true);
      $("#gestureFeedback").textContent = "1 指辣椒 · 2 指猪肉 · 3 指鱼头 · 4 指腊肉。保持约 0.7 秒投料。";
      let lastVideoTime = -1;
      const processFrame = async () => {
        if (!gestureRunning || !gestureHands) return;
        if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
          lastVideoTime = video.currentTime;
          try { await gestureHands.send({ image: video }); }
          catch (error) { console.warn("Hand tracking frame failed:", error); }
        }
        gestureLoop = requestAnimationFrame(processFrame);
      };
      processFrame();
      toastMessage("手势模式已开启：伸出不同根数的手指投放食材。");
    } catch (error) {
      console.error("Unable to start hand gesture control:", error);
      stopCamera();
      $("#gesturePanel").hidden = false;
      $("#gestureToggle").textContent = "✋ 重试手势";
      setCameraStatus("启动失败", false);
      $("#gestureFeedback").textContent = error.message || "无法启动摄像头，请检查权限与网络。";
      toastMessage("手势未启动；仍可点击或拖拽卡牌继续玩。");
    }
  }

  function stopCamera() {
    gestureRunning = false;
    if (gestureLoop) cancelAnimationFrame(gestureLoop);
    gestureLoop = null;
    if (gestureHands) { try { gestureHands.close(); } catch (_) {} }
    gestureHands = null;
    if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
    const video = $("#gestureVideo"); if (video) video.srcObject = null;
    resetGestureCandidate();
    $("#gestureToggle").textContent = "✋ 开启手势";
    setCameraStatus("摄像头已关闭", false);
    $("#gestureFeedback").textContent = "已关闭。点击或拖拽下方卡牌同样可以投料。";
  }

  $("#gestureToggle").addEventListener("click", startCamera);
  $("#stopCamera").addEventListener("click", stopCamera);
  window.addEventListener("beforeunload", stopCamera);
  updateUI();
})();
