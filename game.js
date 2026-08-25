// ==============================
// カードゲーム(仮) — ゲームエンジン
// vsCPU(かんたん) / vsAI(強め) の一人プレイ専用。
// カードの個別効果テキストは表示のみで、まだ自動発動しません(今後の実装課題)。
//
// キャッシュ対策メモ:
// このファイル自体は「game.js」のまま固定し、更新したときは
// index.html 側の <script src="js/game.js?v=1"> の数字だけを増やす。
// data/gamedata.json の読み込みも同様に ?v=1 を付けており、
// データを更新した時はこのファイル内の DATA_VERSION を増やせばよい。
// ==============================

const DATA_VERSION = 1;

const ELEMENT_NAMES = {
  fire: "火", wind: "風", water: "水", earth: "土", heaven: "天", nether: "冥",
};

let GAME_DATA = null;
let ELEMENT_CYCLE = [];
let NEUTRAL_ELEMENTS = [];
let AI_LEVEL = "cpu"; // "cpu"(かんたん) or "ai"(強め)

const state = {
  turnPlayer: "self",
  turnCount: 1,
  selectedAttacker: null, // {owner, instanceId}
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
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function getElementMultiplier(attackerElement, defenderElement) {
  const isNeutral =
    NEUTRAL_ELEMENTS.includes(attackerElement) ||
    NEUTRAL_ELEMENTS.includes(defenderElement);
  if (isNeutral) return 1;

  const ai = ELEMENT_CYCLE.indexOf(attackerElement);
  const di = ELEMENT_CYCLE.indexOf(defenderElement);
  if (ai === -1 || di === -1) return 1;

  if ((ai + 1) % ELEMENT_CYCLE.length === di) return 2; // 有利
  if ((di + 1) % ELEMENT_CYCLE.length === ai) return 0.5; // 不利
  return 1;
}

function buildDeck(allCards, size = 50) {
  const deck = [];
  const hasUnique = (card) =>
    card.traits.includes("唯一") && deck.some((c) => c.id === card.id);
  let guard = 0;
  while (deck.length < size && guard < size * 50) {
    guard++;
    const card = allCards[Math.floor(Math.random() * allCards.length)];
    if (hasUnique(card)) continue;
    deck.push({ ...card, instanceId: uid() });
  }
  return shuffle(deck);
}

function pickAbilities(pool) {
  const { maxCost, passive, active } = pool;
  const all = shuffle([...passive, ...active]);
  const chosen = { passive: [], active: [] };
  let total = 0;
  for (const ab of all) {
    if (total + ab.cost <= maxCost) {
      total += ab.cost;
      if (ab.type === "passive") chosen.passive.push(ab);
      else chosen.active.push(ab);
    }
  }
  return chosen;
}

function drawCards(playerKey, count) {
  const p = state.players[playerKey];
  for (let i = 0; i < count; i++) {
    if (p.deck.length === 0) break; // デッキ切れは今後の実装課題
    p.hand.push(p.deck.pop());
  }
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
  const p = state.players[playerKey];
  p.light = 5 + lightBonus(playerKey);
  drawPhase(playerKey);
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
    p.field.push({
      ...card,
      summoningSick: true,
      hasAttacked: false,
      currentHealth: card.health,
    });
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
    case "a-heal":
      p.hp = Math.min(p.maxHp, p.hp + 8);
      break;
    case "a-nova":
      opp.field.forEach((c) => (c.currentHealth -= 3));
      cleanupField(otherKey(playerKey));
      break;
    case "a-draw":
      drawCards(playerKey, 2);
      break;
    case "a-boost":
      p.field.forEach((c) => (c.attack += 1));
      break;
    default:
      break;
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
  if (playerKey !== state.turnPlayer || playerKey !== "self") return;
  const p = state.players[playerKey];
  const creature = p.field.find((c) => c.instanceId === instanceId);
  if (!creature) return;
  if (creature.summoningSick) {
    log("召喚酔い中のクリーチャーは攻撃できません。");
    return;
  }
  if (creature.hasAttacked) {
    log("このクリーチャーはこのターンすでに攻撃しました。");
    return;
  }
  state.selectedAttacker = { owner: playerKey, instanceId };
  render();
}

function resolveAttack(attackerOwner, attackerInstanceId, targetOwner, targetInstanceId) {
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
    log(
      `${playerLabel(attackerOwner)}の「${attacker.name}」が${playerLabel(targetOwner)}の「${defender.name}」に${dmg}ダメージ` +
        (mult === 2 ? "(属性有利!)" : mult === 0.5 ? "(属性不利…)" : "") + "。"
    );
    cleanupField(targetOwner);
  }
  attacker.hasAttacked = true;
  state.selectedAttacker = null;
  checkWin();
  render();
}

// クリックで攻撃対象を選ぶ(自分専用の入力ハンドラ)
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
  const line = document.createElement("div");
  line.textContent = msg;
  logEl.prepend(line);
}

// ---------- CPU / AI ----------

function runAiTurn() {
  if (state.gameOver || state.turnPlayer !== "opponent") return;
  const p = state.players.opponent;

  if (AI_LEVEL === "cpu") {
    // かんたんCPU: 出せる手札をランダムに出し、出せる攻撃をランダムに行う
    let playable = p.hand.filter((c) => c.cost <= p.light && (c.type !== "creature" || p.field.length < 5));
    while (playable.length > 0) {
      const card = playable[Math.floor(Math.random() * playable.length)];
      playCard("opponent", card.instanceId);
      playable = p.hand.filter((c) => c.cost <= p.light && (c.type !== "creature" || p.field.length < 5));
    }
    const attackers = p.field.filter((c) => !c.summoningSick && !c.hasAttacked);
    attackers.forEach((attacker) => {
      const targets = state.players.self.field;
      if (targets.length > 0) {
        const target = targets[Math.floor(Math.random() * targets.length)];
        resolveAttack("opponent", attacker.instanceId, "self", target.instanceId);
      } else {
        resolveAttack("opponent", attacker.instanceId, "self", "PLAYER");
      }
    });
  } else {
    // 強めAI: コストの高いカードから優先的に出し、有利な属性やとどめを優先して攻撃する
    let hand = [...p.hand].sort((a, b) => b.cost - a.cost);
    for (const card of hand) {
      if (card.cost <= p.light && (card.type !== "creature" || p.field.length < 5)) {
        playCard("opponent", card.instanceId);
      }
    }
    // アクティブ能力: 自分のHPが半分以下なら回復を優先使用
    if (p.hp < p.maxHp / 2) {
      useActive("opponent", "a-heal");
    }

    const attackers = p.field.filter((c) => !c.summoningSick && !c.hasAttacked);
    const selfP = state.players.self;

    // とどめが取れるなら直接攻撃を優先
    if (selfP.field.length === 0) {
      const totalDamage = attackers.reduce((sum, c) => sum + c.attack, 0);
      if (totalDamage >= selfP.hp) {
        attackers.forEach((attacker) =>
          resolveAttack("opponent", attacker.instanceId, "self", "PLAYER")
        );
        checkAndFinishAiTurn();
        return;
      }
    }

    attackers.forEach((attacker) => {
      const liveTargets = selfP.field.filter((c) => c.currentHealth > 0);
      if (liveTargets.length === 0) {
        resolveAttack("opponent", attacker.instanceId, "self", "PLAYER");
        return;
      }
      // 属性有利になる相手を優先し、なければ最も倒しやすい相手を狙う
      let best = null;
      let bestScore = -Infinity;
      for (const target of liveTargets) {
        const mult = getElementMultiplier(attacker.element, target.element);
        const dmg = Math.round(attacker.attack * mult);
        const canKill = dmg >= target.currentHealth ? 1 : 0;
        const score = mult * 10 + canKill * 5 - target.currentHealth * 0.1;
        if (score > bestScore) {
          bestScore = score;
          best = target;
        }
      }
      if (best) {
        resolveAttack("opponent", attacker.instanceId, "self", best.instanceId);
      }
    });
  }
  checkAndFinishAiTurn();
}

function checkAndFinishAiTurn() {
  if (!state.gameOver) {
    setTimeout(endTurn, 400);
  }
}

// ---------- 描画 ----------

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
  if (clickable) {
    div.classList.add("clickable");
    div.onclick = onClick;
  }
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
    `${playerLabel(state.turnPlayer)}のターン(${state.turnCount})`;

  const oppField = document.getElementById("opponent-field");
  oppField.innerHTML = "";
  o.field.forEach((c) => {
    const targetable =
      state.turnPlayer === "self" &&
      state.selectedAttacker && state.selectedAttacker.owner === "self";
    oppField.appendChild(
      cardEl(c, {
        clickable: targetable,
        onClick: () => playerResolveAttack("opponent", c.instanceId),
        small: true,
      })
    );
  });
  const oppPlayerTarget = document.getElementById("opponent-player-target");
  oppPlayerTarget.onclick = () => {
    if (state.turnPlayer === "self" && state.selectedAttacker && state.selectedAttacker.owner === "self") {
      playerResolveAttack("opponent", "PLAYER");
    }
  };

  const selfField = document.getElementById("player-field");
  selfField.innerHTML = "";
  s.field.forEach((c) => {
    const isSelected =
      state.selectedAttacker && state.selectedAttacker.instanceId === c.instanceId;
    const el = cardEl(c, {
      clickable: state.turnPlayer === "self",
      onClick: () => selectAttacker("self", c.instanceId),
      small: true,
    });
    if (isSelected) el.classList.add("selected");
    if (c.summoningSick) el.classList.add("sick");
    if (c.hasAttacked) el.classList.add("used");
    selfField.appendChild(el);
  });

  const hand = document.getElementById("player-hand");
  hand.innerHTML = "";
  s.hand.forEach((c) => {
    hand.appendChild(
      cardEl(c, {
        clickable: state.turnPlayer === "self",
        onClick: () => playCard("self", c.instanceId),
      })
    );
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
      div.onclick = () => {
        if (state.turnPlayer === "self") useActive("self", a.id);
      };
    }
    abilitiesEl.appendChild(div);
  });

  document.getElementById("deck-count-self").textContent = s.deck.length;
  document.getElementById("deck-count-opponent").textContent = o.deck.length;
  document.getElementById("end-turn-btn").disabled = state.gameOver || state.turnPlayer !== "self";
}

// ---------- 初期化 ----------

async function startGame(level) {
  AI_LEVEL = level;
  document.getElementById("mode-select").classList.add("hidden");
  document.getElementById("game-screen").classList.remove("hidden");

  const res = await fetch(`data/gamedata.json?v=${DATA_VERSION}`);
  GAME_DATA = await res.json();
  ELEMENT_CYCLE = GAME_DATA.elementCycle;
  NEUTRAL_ELEMENTS = GAME_DATA.neutralElements;

  for (const key of ["self", "opponent"]) {
    const p = state.players[key];
    p.deck = buildDeck(GAME_DATA.cards, 50);
    p.abilities = pickAbilities(GAME_DATA.playerAbilities);
  }

  drawCards("self", 5);
  drawCards("opponent", 5);

  document.getElementById("end-turn-btn").onclick = endTurn;

  log(`ゲーム開始(相手: ${level === "ai" ? "AI(強め)" : "CPU(かんたん)"})。カードデータ180種・プレイヤー能力を読み込みました。`);
  log(`--- ${playerLabel(state.turnPlayer)}のターン(${state.turnCount}) ---`);
  startTurn(state.turnPlayer);
}

document.querySelectorAll(".mode-btn").forEach((btn) => {
  btn.addEventListener("click", () => startGame(btn.dataset.level));
});
