// ==============================
// カードゲーム(仮) — ゲームエンジン
// 画面: モード選択 → デッキ/能力ビルダー → 対戦画面
//
// キャッシュ対策メモ:
// ファイル名は固定(index.html / style.css / game.js / gamedata.json)。
// 更新した時は index.html 内の `?v=数字` を上げるだけでよい。
// gamedata.json を更新した時は、このファイル先頭の DATA_VERSION を上げる。
// ==============================

const DATA_VERSION = 1;
const SCRIPT_VERSION = 4;

const ELEMENT_NAMES = {
  fire: "火", wind: "風", water: "水", earth: "土", heaven: "天", nether: "冥",
};

let GAME_DATA = null;
let ELEMENT_CYCLE = [];
let NEUTRAL_ELEMENTS = [];
let AI_LEVEL = "cpu"; // "cpu"(かんたん) or "ai"(強め)

// ビルダー画面で編集中のデータ(対戦開始前)
const builder = {
  deck: [], // カードオブジェクトの配列(重複可、【唯一】は1枚まで)
  abilities: { passive: [], active: [] }, // 選択中の能力オブジェクト配列
};

const state = {
  turnPlayer: "self",
  turnCount: 1,
  selectedAttacker: null,
  gameOver: false,
  players: {
    self: newPlayerState(),
    opponent: newPlayerState(),
  },
};

function newPlayerState() {
  return {
    hp: 120,
    maxHp: 120,
    light: 0,
    deck: [],
    hand: [],
    field: [],
    graveyard: [],
    abilities: { passive: [], active: [] },
    usedActive: new Set(),
  };
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function showFatalError(msg) {
  const el = document.getElementById("fatal-error");
  el.textContent = "エラーが発生しました:\n" + msg;
  el.style.display = "block";
}

// ---------- 画面切り替え(class + inline style の両方で確実に) ----------
function showScreen(id) {
  ["mode-select", "builder-screen", "game-screen"].forEach((s) => {
    const el = document.getElementById(s);
    const active = s === id;
    el.classList.toggle("hidden", !active);
    el.style.display = active ? "" : "none";
  });
}

// ---------- 属性相性 ----------
function getElementMultiplier(attackerElement, defenderElement) {
  const isNeutral =
    NEUTRAL_ELEMENTS.includes(attackerElement) ||
    NEUTRAL_ELEMENTS.includes(defenderElement);
  if (isNeutral) return 1;

  const ai = ELEMENT_CYCLE.indexOf(attackerElement);
  const di = ELEMENT_CYCLE.indexOf(defenderElement);
  if (ai === -1 || di === -1) return 1;

  if ((ai + 1) % ELEMENT_CYCLE.length === di) return 2;
  if ((di + 1) % ELEMENT_CYCLE.length === ai) return 0.5;
  return 1;
}

// ---------- デッキ/能力の自動構築(CPU側・および「おまかせ」用) ----------
function buildRandomDeck(allCards, size = 50, base = []) {
  const deck = [...base];
  const hasUnique = (card) =>
    card.traits.includes("唯一") && deck.some((c) => c.id === card.id);
  let guard = 0;
  while (deck.length < size && guard < size * 80) {
    guard++;
    const card = allCards[Math.floor(Math.random() * allCards.length)];
    if (hasUnique(card)) continue;
    deck.push(card);
  }
  return deck;
}

function pickRandomAbilities(pool, base = { passive: [], active: [] }) {
  const { maxCost, passive, active } = pool;
  const chosen = { passive: [...base.passive], active: [...base.active] };
  let total = [...chosen.passive, ...chosen.active].reduce((s, a) => s + a.cost, 0);
  const chosenIds = new Set([...chosen.passive, ...chosen.active].map((a) => a.id));
  const all = shuffle([...passive, ...active]).filter((a) => !chosenIds.has(a.id));
  for (const ab of all) {
    if (total + ab.cost <= maxCost) {
      total += ab.cost;
      if (ab.type === "passive") chosen.passive.push(ab);
      else chosen.active.push(ab);
    }
  }
  return chosen;
}

// ---------- ビルダー画面 ----------

function deckCardCount(cardId) {
  return builder.deck.filter((c) => c.id === cardId).length;
}

function canAddCard(card) {
  if (builder.deck.length >= 50) return false;
  if (card.traits.includes("唯一") && deckCardCount(card.id) >= 1) return false;
  return true;
}

function addCardToBuilder(card) {
  if (!canAddCard(card)) return;
  builder.deck.push(card);
  renderBuilder();
}

function removeCardFromBuilder(cardId) {
  const idx = builder.deck.findIndex((c) => c.id === cardId);
  if (idx === -1) return;
  builder.deck.splice(idx, 1);
  renderBuilder();
}

function abilityCostTotal() {
  return [...builder.abilities.passive, ...builder.abilities.active].reduce(
    (s, a) => s + a.cost, 0
  );
}

function isAbilitySelected(id) {
  return (
    builder.abilities.passive.some((a) => a.id === id) ||
    builder.abilities.active.some((a) => a.id === id)
  );
}

function toggleAbility(ability) {
  if (isAbilitySelected(ability.id)) {
    builder.abilities.passive = builder.abilities.passive.filter((a) => a.id !== ability.id);
    builder.abilities.active = builder.abilities.active.filter((a) => a.id !== ability.id);
  } else {
    if (abilityCostTotal() + ability.cost > 13) return;
    if (ability.type === "passive") builder.abilities.passive.push(ability);
    else builder.abilities.active.push(ability);
  }
  renderBuilder();
}

function renderBuilder() {
  document.getElementById("deck-count-display").textContent = builder.deck.length;
  document.getElementById("ability-cost-display").textContent = abilityCostTotal();
  document.getElementById("confirm-start-btn").disabled = builder.deck.length !== 50;

  const pool = document.getElementById("card-pool");
  pool.innerHTML = "";
  GAME_DATA.cards.forEach((card) => {
    const count = deckCardCount(card.id);
    const div = document.createElement("div");
    div.className = `pool-card element-${card.element}`;
    const traitMark = card.traits.includes("唯一") ? "【唯一】" : "";
    div.innerHTML = `
      <div class="card-name">${traitMark}${card.name}</div>
      <div class="card-meta">${ELEMENT_NAMES[card.element]} / 光${card.cost} / ${card.type === "creature" ? `攻${card.attack}体${card.health}` : "特殊効果"}</div>
      <div class="card-text">${card.text || ""}</div>
      <div class="pool-card-row">
        <button class="pool-btn minus-btn" ${count === 0 ? "disabled" : ""}>−</button>
        <span class="pool-count">${count}</span>
        <button class="pool-btn plus-btn" ${canAddCard(card) ? "" : "disabled"}>+</button>
      </div>
    `;
    div.querySelector(".plus-btn").onclick = () => addCardToBuilder(card);
    div.querySelector(".minus-btn").onclick = () => removeCardFromBuilder(card.id);
    pool.appendChild(div);
  });

  const abilityPool = document.getElementById("ability-pool");
  abilityPool.innerHTML = "";
  const allAbilities = [...GAME_DATA.playerAbilities.passive, ...GAME_DATA.playerAbilities.active];
  allAbilities.forEach((ability) => {
    const selected = isAbilitySelected(ability.id);
    const wouldExceed = !selected && abilityCostTotal() + ability.cost > 13;
    const div = document.createElement("div");
    div.className = `ability-option${selected ? " selected" : ""}${wouldExceed ? " disabled" : ""}`;
    div.innerHTML = `
      <b>${ability.name}</b>(${ability.type === "passive" ? "パッシブ" : "アクティブ"}/コスト${ability.cost})<br/>
      ${ability.text}
    `;
    if (!wouldExceed) div.onclick = () => toggleAbility(ability);
    abilityPool.appendChild(div);
  });
}

function setupBuilderScreenEvents() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.tab;
      document.getElementById("deck-tab").classList.toggle("hidden", tab !== "deck");
      document.getElementById("abilities-tab").classList.toggle("hidden", tab !== "abilities");
    });
  });

  document.getElementById("deck-random-fill-btn").onclick = () => {
    builder.deck = buildRandomDeck(GAME_DATA.cards, 50, builder.deck);
    renderBuilder();
  };
  document.getElementById("deck-default-btn").onclick = () => {
    builder.deck = buildRandomDeck(GAME_DATA.cards, 50, []);
    renderBuilder();
  };
  document.getElementById("deck-reset-btn").onclick = () => {
    builder.deck = [];
    renderBuilder();
  };

  document.getElementById("ability-random-fill-btn").onclick = () => {
    builder.abilities = pickRandomAbilities(GAME_DATA.playerAbilities, builder.abilities);
    renderBuilder();
  };
  document.getElementById("ability-default-btn").onclick = () => {
    builder.abilities = pickRandomAbilities(GAME_DATA.playerAbilities, { passive: [], active: [] });
    renderBuilder();
  };
  document.getElementById("ability-reset-btn").onclick = () => {
    builder.abilities = { passive: [], active: [] };
    renderBuilder();
  };

  document.getElementById("back-to-mode-btn").onclick = () => showScreen("mode-select");

  document.getElementById("quick-start-btn").onclick = () => {
    builder.deck = buildRandomDeck(GAME_DATA.cards, 50, builder.deck);
    builder.abilities = pickRandomAbilities(GAME_DATA.playerAbilities, builder.abilities);
    beginMatch();
  };

  document.getElementById("confirm-start-btn").onclick = () => {
    if (builder.deck.length !== 50) return;
    beginMatch();
  };
}

// ---------- 対戦ロジック ----------

function drawCards(playerKey, count) {
  const p = state.players[playerKey];
  for (let i = 0; i < count; i++) {
    if (p.deck.length === 0) {
      triggerDeckOutLoss(playerKey);
      return;
    }
    p.hand.push(p.deck.pop());
  }
}

function triggerDeckOutLoss(playerKey) {
  if (state.gameOver) return;
  state.gameOver = true;
  log(`${playerLabel(playerKey)}は山札が尽きて引けなかった。${playerLabel(otherKey(playerKey))}の勝利!`);
  const btn = document.getElementById("end-turn-btn");
  if (btn) btn.disabled = true;
  render();
}

function drawPhase(playerKey) {
  const p = state.players[playerKey];
  const need = p.hand.length < 5 ? 5 - p.hand.length : 1;
  drawCards(playerKey, need);
}

function lightBonus(playerKey) {
  const p = state.players[playerKey];
  return p.abilities.passive.some((a) => a.id === "p-light-up") ? 1 : 0;
}

function startTurn(playerKey) {
  if (state.gameOver) return;
  const p = state.players[playerKey];
  p.light = 5 + lightBonus(playerKey);
  drawPhase(playerKey);
  if (state.gameOver) return;
  p.field.forEach((c) => {
    c.summoningSick = false;
    c.hasAttacked = false;
  });
  if (p.abilities.passive.some((a) => a.id === "p-regen")) {
    p.hp = Math.min(p.maxHp, p.hp + 2);
  }
  render();
  if (playerKey === "opponent" && !state.gameOver) {
    setTimeout(runAiTurn, 500);
  }
}

function otherKey(playerKey) {
  return playerKey === "self" ? "opponent" : "self";
}

function playCard(playerKey, instanceId) {
  if (state.gameOver) return false;
  const p = state.players[playerKey];
  const idx = p.hand.findIndex((c) => c.instanceId === instanceId);
  if (idx === -1) return false;
  const card = p.hand[idx];
  if (card.cost > p.light) {
    if (playerKey === "self") log(`光が足りません(必要:${card.cost} / 所持:${p.light})`);
    return false;
  }
  if (card.type === "creature" && p.field.length >= 5) {
    if (playerKey === "self") log("場のクリーチャーが5体を超えるため召喚できません。");
    return false;
  }
  p.light -= card.cost;
  p.hand.splice(idx, 1);
  if (card.type === "creature") {
    p.field.push({ ...card, summoningSick: true, hasAttacked: false, currentHealth: card.health });
    log(`${playerLabel(playerKey)}が「${card.name}」を召喚した。`);
  } else {
    p.graveyard.push(card);
    log(`${playerLabel(playerKey)}が「${card.name}」を使用した。(効果は今後実装)`);
  }
  render();
  return true;
}

const ACTIVE_LIGHT_COST = {
  "a-heal": 3, "a-nova": 5, "a-draw": 2, "a-shield": 3, "a-revive": 6, "a-boost": 2,
};

function useActive(playerKey, abilityId) {
  if (state.gameOver) return false;
  const p = state.players[playerKey];
  if (p.usedActive.has(abilityId)) {
    if (playerKey === "self") log("このアクティブ能力はすでに使用済みです。");
    return false;
  }
  const ability = p.abilities.active.find((a) => a.id === abilityId);
  if (!ability) return false;
  const lightCost = ACTIVE_LIGHT_COST[ability.id] || 0;
  if (p.light < lightCost) {
    if (playerKey === "self") log(`光が足りません(必要:${lightCost})`);
    return false;
  }
  p.light -= lightCost;
  p.usedActive.add(abilityId);

  const opp = state.players[otherKey(playerKey)];
  switch (ability.id) {
    case "a-heal": p.hp = Math.min(p.maxHp, p.hp + 8); break;
    case "a-nova": opp.field.forEach((c) => (c.currentHealth -= 3)); cleanupField(otherKey(playerKey)); break;
    case "a-draw": drawCards(playerKey, 2); break;
    case "a-boost": p.field.forEach((c) => (c.attack += 1)); break;
    default: break;
  }
  log(`${playerLabel(playerKey)}が能力「${ability.name}」を発動した。`);
  render();
  return true;
}

function cleanupField(playerKey) {
  const p = state.players[playerKey];
  const dead = p.field.filter((c) => c.currentHealth <= 0);
  dead.forEach((c) => p.graveyard.push(c));
  p.field = p.field.filter((c) => c.currentHealth > 0);
}

function selectAttacker(playerKey, instanceId) {
  if (state.gameOver || playerKey !== state.turnPlayer || playerKey !== "self") return;
  const p = state.players[playerKey];
  const creature = p.field.find((c) => c.instanceId === instanceId);
  if (!creature) return;
  if (creature.summoningSick) { log("召喚酔い中のクリーチャーは攻撃できません。"); return; }
  if (creature.hasAttacked) { log("このクリーチャーはこのターンすでに攻撃しました。"); return; }
  state.selectedAttacker = { owner: playerKey, instanceId };
  render();
}

function resolveAttack(attackerOwner, attackerInstanceId, targetOwner, targetInstanceId) {
  if (state.gameOver) return;
  const atkP = state.players[attackerOwner];
  const attacker = atkP.field.find((c) => c.instanceId === attackerInstanceId);
  if (!attacker || attacker.hasAttacked || attacker.summoningSick) return;
  const defP = state.players[targetOwner];

  if (targetInstanceId === "PLAYER") {
    if (defP.field.length > 0) {
      if (attackerOwner === "self") log("相手の場にクリーチャーがいるため、プレイヤーへの直接攻撃はできません。");
      return;
    }
    defP.hp -= attacker.attack;
    log(`${playerLabel(attackerOwner)}の「${attacker.name}」が${playerLabel(targetOwner)}に${attacker.attack}ダメージ!`);
  } else {
    const defender = defP.field.find((c) => c.instanceId === targetInstanceId);
    if (!defender) return;
    const mult = getElementMultiplier(attacker.element, defender.element);
    const dmg = Math.round(attacker.attack * mult);
    defender.currentHealth -= dmg;
    log(`${playerLabel(attackerOwner)}の「${attacker.name}」が${playerLabel(targetOwner)}の「${defender.name}」に${dmg}ダメージ` +
      (mult === 2 ? "(属性有利!)" : mult === 0.5 ? "(属性不利…)" : "") + "。");
    cleanupField(targetOwner);
  }
  attacker.hasAttacked = true;
  state.selectedAttacker = null;
  checkWin();
  render();
}

function playerResolveAttack(targetOwner, targetInstanceId) {
  if (!state.selectedAttacker) return;
  const { owner, instanceId } = state.selectedAttacker;
  resolveAttack(owner, instanceId, targetOwner, targetInstanceId);
}

function checkWin() {
  if (state.gameOver) return;
  for (const key of ["self", "opponent"]) {
    if (state.players[key].hp <= 0) {
      state.gameOver = true;
      log(`${playerLabel(key)}のHPが0になった。${playerLabel(otherKey(key))}の勝利!`);
      document.getElementById("end-turn-btn").disabled = true;
    }
  }
}

function endTurn() {
  if (state.gameOver) return;
  state.selectedAttacker = null;
  state.turnPlayer = otherKey(state.turnPlayer);
  if (state.turnPlayer === "self") state.turnCount++;
  log(`--- ${playerLabel(state.turnPlayer)}のターン(${state.turnCount}) ---`);
  startTurn(state.turnPlayer);
}

function playerLabel(key) {
  return key === "self" ? "自分" : (AI_LEVEL === "ai" ? "AI" : "CPU");
}

function log(msg) {
  const logEl = document.getElementById("log");
  if (!logEl) return;
  const line = document.createElement("div");
  line.textContent = msg;
  logEl.prepend(line);
}

// ---------- CPU / AI ----------

function runAiTurn() {
  if (state.gameOver || state.turnPlayer !== "opponent") return;
  const p = state.players.opponent;

  if (AI_LEVEL === "cpu") {
    let playable = p.hand.filter((c) => c.cost <= p.light && (c.type !== "creature" || p.field.length < 5));
    while (playable.length > 0) {
      const card = playable[Math.floor(Math.random() * playable.length)];
      playCard("opponent", card.instanceId);
      if (state.gameOver) return;
      playable = p.hand.filter((c) => c.cost <= p.light && (c.type !== "creature" || p.field.length < 5));
    }
    const attackers = p.field.filter((c) => !c.summoningSick && !c.hasAttacked);
    attackers.forEach((attacker) => {
      if (state.gameOver) return;
      const targets = state.players.self.field;
      if (targets.length > 0) {
        const target = targets[Math.floor(Math.random() * targets.length)];
        resolveAttack("opponent", attacker.instanceId, "self", target.instanceId);
      } else {
        resolveAttack("opponent", attacker.instanceId, "self", "PLAYER");
      }
    });
  } else {
    let hand = [...p.hand].sort((a, b) => b.cost - a.cost);
    for (const card of hand) {
      if (state.gameOver) return;
      if (card.cost <= p.light && (card.type !== "creature" || p.field.length < 5)) {
        playCard("opponent", card.instanceId);
      }
    }
    if (p.hp < p.maxHp / 2) useActive("opponent", "a-heal");
    if (state.gameOver) return;

    const attackers = p.field.filter((c) => !c.summoningSick && !c.hasAttacked);
    const selfP = state.players.self;

    if (selfP.field.length === 0) {
      const totalDamage = attackers.reduce((sum, c) => sum + c.attack, 0);
      if (totalDamage >= selfP.hp) {
        attackers.forEach((attacker) => resolveAttack("opponent", attacker.instanceId, "self", "PLAYER"));
        checkAndFinishAiTurn();
        return;
      }
    }

    attackers.forEach((attacker) => {
      if (state.gameOver) return;
      const liveTargets = selfP.field.filter((c) => c.currentHealth > 0);
      if (liveTargets.length === 0) {
        resolveAttack("opponent", attacker.instanceId, "self", "PLAYER");
        return;
      }
      let best = null;
      let bestScore = -Infinity;
      for (const target of liveTargets) {
        const mult = getElementMultiplier(attacker.element, target.element);
        const dmg = Math.round(attacker.attack * mult);
        const canKill = dmg >= target.currentHealth ? 1 : 0;
        const score = mult * 10 + canKill * 5 - target.currentHealth * 0.1;
        if (score > bestScore) { bestScore = score; best = target; }
      }
      if (best) resolveAttack("opponent", attacker.instanceId, "self", best.instanceId);
    });
  }
  checkAndFinishAiTurn();
}

function checkAndFinishAiTurn() {
  if (!state.gameOver) setTimeout(endTurn, 400);
}

// ---------- 描画(対戦画面) ----------

function cardEl(card, { clickable, onClick, small } = {}) {
  const div = document.createElement("div");
  div.className = `card element-${card.element}${small ? " card-small" : ""}`;
  const traitMark = card.traits && card.traits.includes("唯一") ? "【唯一】" : "";
  div.innerHTML = `
    <div class="card-name">${traitMark}${card.name}</div>
    <div class="card-meta">${ELEMENT_NAMES[card.element]} / 光${card.cost}</div>
    ${card.type === "creature" ? `<div class="card-stats">攻${card.attack} / 体${card.currentHealth ?? card.health}</div>` : `<div class="card-stats">特殊効果</div>`}
    <div class="card-text">${card.text || ""}</div>
  `;
  if (clickable) { div.classList.add("clickable"); div.onclick = onClick; }
  return div;
}

function render() {
  const s = state.players.self;
  const o = state.players.opponent;

  document.getElementById("self-hp").textContent = `${s.hp}/${s.maxHp}`;
  document.getElementById("opponent-hp").textContent = `${o.hp}/${o.maxHp}`;
  document.getElementById("self-light").textContent = s.light;
  document.getElementById("opponent-light").textContent = o.light;
  document.getElementById("turn-indicator").textContent =
    (state.gameOver ? "対戦終了 - " : "") + `${playerLabel(state.turnPlayer)}のターン(${state.turnCount})`;

  const oppField = document.getElementById("opponent-field");
  oppField.innerHTML = "";
  o.field.forEach((c) => {
    const targetable = state.turnPlayer === "self" && state.selectedAttacker && state.selectedAttacker.owner === "self";
    oppField.appendChild(cardEl(c, { clickable: targetable, onClick: () => playerResolveAttack("opponent", c.instanceId), small: true }));
  });
  document.getElementById("opponent-player-target").onclick = () => {
    if (state.turnPlayer === "self" && state.selectedAttacker && state.selectedAttacker.owner === "self") {
      playerResolveAttack("opponent", "PLAYER");
    }
  };

  const selfField = document.getElementById("player-field");
  selfField.innerHTML = "";
  s.field.forEach((c) => {
    const isSelected = state.selectedAttacker && state.selectedAttacker.instanceId === c.instanceId;
    const el = cardEl(c, { clickable: state.turnPlayer === "self", onClick: () => selectAttacker("self", c.instanceId), small: true });
    if (isSelected) el.classList.add("selected");
    if (c.summoningSick) el.classList.add("sick");
    if (c.hasAttacked) el.classList.add("used");
    selfField.appendChild(el);
  });

  const hand = document.getElementById("player-hand");
  hand.innerHTML = "";
  s.hand.forEach((c) => {
    hand.appendChild(cardEl(c, { clickable: state.turnPlayer === "self", onClick: () => playCard("self", c.instanceId) }));
  });

  const abilitiesEl = document.getElementById("self-abilities");
  abilitiesEl.innerHTML = "";
  [...s.abilities.passive, ...s.abilities.active].forEach((a) => {
    const div = document.createElement("div");
    div.className = "ability";
    const used = s.usedActive.has(a.id);
    div.innerHTML = `<b>${a.name}</b>(${a.type === "passive" ? "パッシブ" : "アクティブ"}/コスト${a.cost})<br/>${a.text}`;
    if (a.type === "active") {
      div.classList.add("clickable");
      if (used) div.classList.add("used");
      div.onclick = () => { if (state.turnPlayer === "self") useActive("self", a.id); };
    }
    abilitiesEl.appendChild(div);
  });

  document.getElementById("deck-count-self").textContent = s.deck.length;
  document.getElementById("deck-count-opponent").textContent = o.deck.length;
  document.getElementById("end-turn-btn").disabled = state.gameOver || state.turnPlayer !== "self";
}

// ---------- 対戦開始 ----------

function beginMatch() {
  const selfDeckInstances = shuffle(builder.deck).map((c) => ({ ...c, instanceId: uid() }));
  const opponentDeckInstances = buildRandomDeck(GAME_DATA.cards, 50).map((c) => ({ ...c, instanceId: uid() }));

  state.players.self = newPlayerState();
  state.players.opponent = newPlayerState();
  state.players.self.deck = shuffle(selfDeckInstances);
  state.players.opponent.deck = shuffle(opponentDeckInstances);
  state.players.self.abilities = builder.abilities;
  state.players.opponent.abilities = pickRandomAbilities(GAME_DATA.playerAbilities, { passive: [], active: [] });
  state.turnPlayer = "self";
  state.turnCount = 1;
  state.selectedAttacker = null;
  state.gameOver = false;

  drawCards("self", 5);
  drawCards("opponent", 5);

  showScreen("game-screen");
  document.getElementById("end-turn-btn").onclick = endTurn;
  document.getElementById("end-turn-btn").disabled = false;
  document.getElementById("log").innerHTML = "";

  log(`ゲーム開始(相手: ${AI_LEVEL === "ai" ? "AI(強め)" : "CPU(かんたん)"})。デッキ${state.players.self.deck.length + 5}枚構成でスタート。`);
  log(`--- ${playerLabel(state.turnPlayer)}のターン(${state.turnCount}) ---`);
  startTurn(state.turnPlayer);
}

// ---------- 初期化 ----------

async function loadGameData() {
  const res = await fetch(`data/gamedata.json?v=${DATA_VERSION}`);
  if (!res.ok) throw new Error(`data/gamedata.json の取得に失敗しました(HTTP ${res.status})`);
  return res.json();
}

function bootStatus(msg) {
  const el = document.getElementById("boot-status");
  if (el) el.textContent = msg;
}

async function selectMode(level) {
  AI_LEVEL = level;
  bootStatus("カードデータを読み込み中…(data/gamedata.json)");
  try {
    if (!GAME_DATA) {
      GAME_DATA = await loadGameData();
      ELEMENT_CYCLE = GAME_DATA.elementCycle;
      NEUTRAL_ELEMENTS = GAME_DATA.neutralElements;
    }
    bootStatus("読み込み完了。画面を切り替えます…");
    builder.deck = [];
    builder.abilities = { passive: [], active: [] };
    renderBuilder();
    showScreen("builder-screen");
  } catch (err) {
    bootStatus("");
    showFatalError(
      String(err) +
      "\n\ndata/gamedata.json が正しい場所に配置されているか、ファイル名やフォルダ構成(data/ フォルダごと)が" +
      "リポジトリに反映されているかご確認ください。"
    );
  }
}

function init() {
  bootStatus(`game.js v${SCRIPT_VERSION} 読み込み完了。ボタンを押すとゲームが始まります。`);
  document.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => selectMode(btn.dataset.level));
  });
  setupBuilderScreenEvents();
  showScreen("mode-select");
}

window.addEventListener("error", (e) => {
  showFatalError(String(e.message || e));
});
window.addEventListener("unhandledrejection", (e) => {
  showFatalError(String((e.reason && e.reason.message) || e.reason || e));
});

try {
  init();
} catch (err) {
  showFatalError("初期化処理でエラーが発生しました: " + String(err));
}
