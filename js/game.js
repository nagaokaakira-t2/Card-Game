// ==============================
// カードゲーム(仮) — ゲームエンジン
//
// キャッシュ対策メモ: ファイル名固定。更新時は index.html の `?v=数字` を上げる。
// gamedata.json 更新時はこのファイル先頭の DATA_VERSION を上げる。
// ==============================

const DATA_VERSION = 4;
const SCRIPT_VERSION = 7;

const ELEMENT_NAMES = { fire: "火", wind: "風", water: "水", earth: "土", heaven: "天", nether: "冥" };
const ELEMENT_ORDER = ["fire", "wind", "water", "earth", "heaven", "nether"];

let GAME_DATA = null;
let ELEMENT_CYCLE = [];
let NEUTRAL_ELEMENTS = [];
let AI_LEVEL = "cpu";

const builder = {
  deck: [],
  abilities: { passive: [], active: [] },
};

const state = {
  turnPlayer: "self",
  turnCount: 1,
  selectedAttacker: null,
  selectedHandCard: null,
  gameOver: false,
  players: { self: newPlayerState(), opponent: newPlayerState() },
};

function newPlayerState() {
  return {
    hp: 120, maxHp: 120, light: 0,
    deck: [], hand: [], field: [], graveyard: [],
    abilities: { passive: [], active: [] },
    usedActive: new Set(),
    pendingEndOfTurnSelfDamage: 0,
  };
}

function uid() { return Math.random().toString(36).slice(2, 10); }

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
  const isNeutral = NEUTRAL_ELEMENTS.includes(attackerElement) || NEUTRAL_ELEMENTS.includes(defenderElement);
  if (isNeutral) return 1;
  const ai = ELEMENT_CYCLE.indexOf(attackerElement);
  const di = ELEMENT_CYCLE.indexOf(defenderElement);
  if (ai === -1 || di === -1) return 1;
  if ((ai + 1) % ELEMENT_CYCLE.length === di) return 2;
  if ((di + 1) % ELEMENT_CYCLE.length === ai) return 0.5;
  return 1;
}

// ---------- デッキ/能力の自動構築 ----------
function buildRandomDeck(allCards, size = 50, base = []) {
  const deck = [...base];
  const hasUnique = (card) => card.traits.includes("唯一") && deck.some((c) => c.id === card.id);
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

// ---------- ビルダー画面(属性×種類の列で表示) ----------

function deckCardCount(cardId) { return builder.deck.filter((c) => c.id === cardId).length; }
function canAddCard(card) {
  if (builder.deck.length >= 50) return false;
  if (card.traits.includes("唯一") && deckCardCount(card.id) >= 1) return false;
  return true;
}
function addCardToBuilder(card) { if (canAddCard(card)) { builder.deck.push(card); renderBuilder(); } }
function removeCardFromBuilder(cardId) {
  const idx = builder.deck.findIndex((c) => c.id === cardId);
  if (idx !== -1) { builder.deck.splice(idx, 1); renderBuilder(); }
}

function abilityCostTotal() {
  return [...builder.abilities.passive, ...builder.abilities.active].reduce((s, a) => s + a.cost, 0);
}
function isAbilitySelected(id) {
  return builder.abilities.passive.some((a) => a.id === id) || builder.abilities.active.some((a) => a.id === id);
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

function poolCardNode(card) {
  const count = deckCardCount(card.id);
  const div = document.createElement("div");
  div.className = `pool-card element-${card.element}`;
  const traitMark = traitMarks(card);
  div.innerHTML = `
    <div class="card-name">${traitMark}${card.name}</div>
    <div class="card-meta">光${card.cost}${card.type === "creature" ? ` / 攻${card.attack}体${card.health}` : ""}</div>
    <div class="card-text">${card.text || ""}</div>
    <div class="pool-card-row">
      <button class="pool-btn minus-btn" ${count === 0 ? "disabled" : ""}>−</button>
      <span class="pool-count">${count}</span>
      <button class="pool-btn plus-btn" ${canAddCard(card) ? "" : "disabled"}>+</button>
    </div>
  `;
  div.querySelector(".plus-btn").onclick = () => addCardToBuilder(card);
  div.querySelector(".minus-btn").onclick = () => removeCardFromBuilder(card.id);
  return div;
}

function renderBuilder() {
  document.getElementById("deck-count-display").textContent = builder.deck.length;
  document.getElementById("ability-cost-display").textContent = abilityCostTotal();
  document.getElementById("confirm-start-btn").disabled = builder.deck.length !== 50;

  const pool = document.getElementById("card-pool");
  pool.innerHTML = "";
  ELEMENT_ORDER.forEach((elementId) => {
    const cardsOfElement = GAME_DATA.cards.filter((c) => c.element === elementId);
    const elementInfo = (GAME_DATA.elements || []).find((e) => e.id === elementId) || {};
    const col = document.createElement("div");
    col.className = `pool-column element-${elementId}`;
    col.innerHTML = `
      <div class="pool-column-title">${ELEMENT_NAMES[elementId]}</div>
      <div class="pool-column-desc">${elementInfo.description || ""}</div>
    `;

    const creatureLabel = document.createElement("div");
    creatureLabel.className = "pool-type-label";
    creatureLabel.textContent = "クリーチャー";
    col.appendChild(creatureLabel);
    cardsOfElement.filter((c) => c.type === "creature").forEach((c) => col.appendChild(poolCardNode(c)));

    const specialLabel = document.createElement("div");
    specialLabel.className = "pool-type-label";
    specialLabel.textContent = "特殊効果";
    col.appendChild(specialLabel);
    cardsOfElement.filter((c) => c.type === "special").forEach((c) => col.appendChild(poolCardNode(c)));

    pool.appendChild(col);
  });

  const abilityPool = document.getElementById("ability-pool");
  abilityPool.innerHTML = "";
  const allAbilities = [...GAME_DATA.playerAbilities.passive, ...GAME_DATA.playerAbilities.active];
  allAbilities.forEach((ability) => {
    const selected = isAbilitySelected(ability.id);
    const wouldExceed = !selected && abilityCostTotal() + ability.cost > 13;
    const div = document.createElement("div");
    div.className = `ability-option${selected ? " selected" : ""}${wouldExceed ? " disabled" : ""}`;
    div.innerHTML = `<b>${ability.name}</b>(${ability.type === "passive" ? "パッシブ" : "アクティブ"}/コスト${ability.cost})<br/>${ability.text}`;
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

  document.getElementById("deck-random-fill-btn").onclick = () => { builder.deck = buildRandomDeck(GAME_DATA.cards, 50, builder.deck); renderBuilder(); };
  document.getElementById("deck-default-btn").onclick = () => { builder.deck = buildRandomDeck(GAME_DATA.cards, 50, []); renderBuilder(); };
  document.getElementById("deck-reset-btn").onclick = () => { builder.deck = []; renderBuilder(); };

  document.getElementById("ability-random-fill-btn").onclick = () => { builder.abilities = pickRandomAbilities(GAME_DATA.playerAbilities, builder.abilities); renderBuilder(); };
  document.getElementById("ability-default-btn").onclick = () => { builder.abilities = pickRandomAbilities(GAME_DATA.playerAbilities, { passive: [], active: [] }); renderBuilder(); };
  document.getElementById("ability-reset-btn").onclick = () => { builder.abilities = { passive: [], active: [] }; renderBuilder(); };

  document.getElementById("back-to-mode-btn").onclick = () => showScreen("mode-select");

  document.getElementById("quick-start-btn").onclick = () => {
    builder.deck = buildRandomDeck(GAME_DATA.cards, 50, builder.deck);
    builder.abilities = pickRandomAbilities(GAME_DATA.playerAbilities, builder.abilities);
    beginMatch();
  };
  document.getElementById("confirm-start-btn").onclick = () => {
    if (builder.deck.length === 50) beginMatch();
  };
}

// ---------- ターゲット選択ヘルパー ----------
function pickWeakestEnemyCreature(selfKey) {
  const opp = state.players[otherKey(selfKey)];
  if (opp.field.length === 0) return null;
  return opp.field.reduce((min, c) => (c.currentHealth < min.currentHealth ? c : min));
}
function pickWeakestAllyForHeal(selfKey) {
  const p = state.players[selfKey];
  if (p.field.length === 0) return null;
  return p.field.reduce((min, c) => (c.currentHealth / c.health < min.currentHealth / min.health ? c : min));
}
function pickStrongestAllyForBuff(selfKey) {
  const p = state.players[selfKey];
  if (p.field.length === 0) return null;
  return p.field.reduce((max, c) => (c.attack > max.attack ? c : max));
}
function pickStrongestEnemyForDebuff(selfKey) {
  const opp = state.players[otherKey(selfKey)];
  if (opp.field.length === 0) return null;
  return opp.field.reduce((max, c) => (c.attack > max.attack ? c : max));
}
function discardRandomFromHand(playerKey) {
  const p = state.players[playerKey];
  if (p.hand.length === 0) return;
  const idx = Math.floor(Math.random() * p.hand.length);
  const [card] = p.hand.splice(idx, 1);
  p.graveyard.push(card);
  logAction(playerKey, "効果", `手札の「${card.name}」を捨てた。`);
}

// ---------- カード効果の自動発動エンジン(召喚時/使用時) ----------
function hasPassive(playerKey, abilityId) {
  return state.players[playerKey].abilities.passive.some((a) => a.id === abilityId);
}
function elementDamageBonus(ownerKey, element) {
  if (element === "fire" && hasPassive(ownerKey, "p-fire-burn")) return 1;
  if (element === "nether" && hasPassive(ownerKey, "p-nether-drain")) return 1;
  return 0;
}
function elementHealBonus(ownerKey, element) {
  if (element === "water" && hasPassive(ownerKey, "p-water-heal")) return 1;
  return 0;
}
function heavenMercy(ownerKey) {
  return hasPassive(ownerKey, "p-heaven-mercy") ? 1 : 0;
}

const EFFECT_ON_PLAY = {
  damageEnemyCreature: (ownerKey, card, params) => {
    const target = pickWeakestEnemyCreature(ownerKey);
    if (!target) { logAction(ownerKey, "効果", `${card.name}の効果は対象がおらず不発。`); return; }
    const bonus = elementDamageBonus(ownerKey, card.element);
    target.currentHealth -= params.dmg + bonus;
    logAction(ownerKey, "効果", `${card.name}が${target.name}に${params.dmg + bonus}ダメージ。`);
    cleanupField(otherKey(ownerKey));
  },
  healPlayer: (ownerKey, card, params) => {
    const p = state.players[ownerKey];
    const bonus = elementHealBonus(ownerKey, card.element);
    p.hp = Math.min(p.maxHp, p.hp + params.heal + bonus);
    logAction(ownerKey, "効果", `${card.name}でHPを${params.heal + bonus}回復した。`);
  },
  drawCards: (ownerKey, card, params) => {
    drawCards(ownerKey, params.draw);
    logAction(ownerKey, "効果", `${card.name}で手札を${params.draw}枚引いた。`);
  },
  healAllyCreature: (ownerKey, card, params) => {
    const target = pickWeakestAllyForHeal(ownerKey);
    if (!target) { logAction(ownerKey, "効果", `${card.name}の効果は対象がおらず不発。`); return; }
    const bonus = elementHealBonus(ownerKey, card.element);
    target.currentHealth = Math.min(target.health, target.currentHealth + params.heal + bonus);
    logAction(ownerKey, "効果", `${card.name}が${target.name}のHPを${params.heal + bonus}回復した。`);
  },
  lightGain: (ownerKey, card, params) => {
    state.players[ownerKey].light += params.light;
    logAction(ownerKey, "効果", `${card.name}で光が${params.light}増えた。`);
  },
  buffAllyAtk: (ownerKey, card, params) => {
    const target = pickStrongestAllyForBuff(ownerKey);
    if (!target) { logAction(ownerKey, "効果", `${card.name}の効果は対象がおらず不発。`); return; }
    target.attack += params.buff;
    logAction(ownerKey, "効果", `${card.name}が${target.name}の攻撃力を${params.buff}上げた。`);
  },
  debuffEnemyAtk: (ownerKey, card, params) => {
    const target = pickStrongestEnemyForDebuff(ownerKey);
    if (!target) { logAction(ownerKey, "効果", `${card.name}の効果は対象がおらず不発。`); return; }
    target.attack = Math.max(0, target.attack - params.buff);
    logAction(ownerKey, "効果", `${card.name}が${target.name}の攻撃力を${params.buff}下げた。`);
  },
  aoeDamageEnemyCreatures: (ownerKey, card, params) => {
    const opp = state.players[otherKey(ownerKey)];
    if (opp.field.length === 0) { logAction(ownerKey, "効果", `${card.name}の効果は対象がおらず不発。`); return; }
    const bonus = elementDamageBonus(ownerKey, card.element);
    opp.field.forEach((c) => (c.currentHealth -= params.dmg + bonus));
    logAction(ownerKey, "効果", `${card.name}が相手の場全体に${params.dmg + bonus}ダメージ。`);
    cleanupField(otherKey(ownerKey));
  },
  lightGainThenSelfDamageOnTurnEnd: (ownerKey, card, params) => {
    const p = state.players[ownerKey];
    p.light += params.light;
    const mercy = card.element === "heaven" ? heavenMercy(ownerKey) : 0;
    p.pendingEndOfTurnSelfDamage += Math.max(0, 1 - mercy);
    logAction(ownerKey, "効果", `${card.name}で光が${params.light}増えた(ターン終了時に反動あり)。`);
  },
  drawThenDiscard: (ownerKey, card, params) => {
    drawCards(ownerKey, params.draw);
    discardRandomFromHand(ownerKey);
    logAction(ownerKey, "効果", `${card.name}で手札を${params.draw}枚引き、1枚捨てた。`);
  },
  damageEnemyCreatureThenSelfDamage: (ownerKey, card, params) => {
    const target = pickWeakestEnemyCreature(ownerKey);
    const p = state.players[ownerKey];
    const dmgBonus = card.element === "nether" ? elementDamageBonus(ownerKey, "nether") : 0;
    if (target) {
      target.currentHealth -= params.dmg + dmgBonus;
      logAction(ownerKey, "効果", `${card.name}が${target.name}に${params.dmg + dmgBonus}ダメージ。`);
      cleanupField(otherKey(ownerKey));
    } else {
      logAction(ownerKey, "効果", `${card.name}の攻撃対象はいなかった。`);
    }
    const mercy = card.element === "heaven" ? heavenMercy(ownerKey) : 0;
    const selfDmg = Math.max(0, 1 - mercy);
    if (selfDmg > 0) {
      p.hp -= selfDmg;
      logAction(ownerKey, "効果", `${card.name}の反動で自分に${selfDmg}ダメージ。`);
    }
    checkWin();
  },
  discardEnemyThenSelfLightLoss: (ownerKey, card) => {
    discardRandomFromHand(otherKey(ownerKey));
    const p = state.players[ownerKey];
    if (p.light > 0) p.light -= 1;
    logAction(ownerKey, "効果", `${card.name}で相手の手札を1枚捨てさせた。`);
  },
  aoeDamageEnemyCreaturesThenSelfDamage: (ownerKey, card, params) => {
    const opp = state.players[otherKey(ownerKey)];
    const p = state.players[ownerKey];
    const dmgBonus = elementDamageBonus(ownerKey, "nether");
    if (opp.field.length > 0) {
      opp.field.forEach((c) => (c.currentHealth -= params.dmg + dmgBonus));
      logAction(ownerKey, "効果", `${card.name}が相手の場全体に${params.dmg + dmgBonus}ダメージ。`);
      cleanupField(otherKey(ownerKey));
    } else {
      logAction(ownerKey, "効果", `${card.name}の効果は対象がおらず不発。`);
    }
    p.hp -= 1;
    logAction(ownerKey, "効果", `${card.name}の反動で自分に1ダメージ。`);
    checkWin();
  },
  lightGainThenSelfDamage: (ownerKey, card, params) => {
    const p = state.players[ownerKey];
    p.light += params.light;
    p.hp -= 1;
    logAction(ownerKey, "効果", `${card.name}で光が${params.light}増えたが、反動で1ダメージ。`);
    checkWin();
  },
};

function applyOnPlayEffect(ownerKey, card) {
  if (card.effect && EFFECT_ON_PLAY[card.effect.kind]) {
    EFFECT_ON_PLAY[card.effect.kind](ownerKey, card, card.effect.params);
    render();
  }
}

function applyTurnStartEffects(playerKey) {
  const p = state.players[playerKey];
  p.field.forEach((c) => {
    if (c.effect && c.effect.kind === "buffSelfAtkOnTurnStart") {
      const bonus = c.element === "wind" && hasPassive(playerKey, "p-wind-growth") ? 1 : 0;
      const total = c.effect.params.buff + bonus;
      c.attack += total;
      logAction(playerKey, "効果", `${c.name}の攻撃力が${total}上がった(現在${c.attack})。`);
    }
  });
}

function applyTurnEndEffects(playerKey) {
  const p = state.players[playerKey];
  p.field.forEach((c) => {
    if (!c.effect) return;
    if (c.effect.kind === "damageEnemyCreatureOnTurnEnd") {
      const target = pickWeakestEnemyCreature(playerKey);
      if (target) {
        const bonus = elementDamageBonus(playerKey, c.element);
        target.currentHealth -= c.effect.params.dmg + bonus;
        logAction(playerKey, "効果", `${c.name}が${target.name}に${c.effect.params.dmg + bonus}ダメージ。`);
      }
    }
    if (c.effect.kind === "bonusAttackDamageThenSelfDamageOnTurnEnd") {
      const mercy = c.element === "heaven" ? heavenMercy(playerKey) : 0;
      const selfDmg = Math.max(0, 1 - mercy);
      if (selfDmg > 0) {
        c.currentHealth -= selfDmg;
        logAction(playerKey, "効果", `${c.name}はターン終了時の消耗で${selfDmg}ダメージを受けた。`);
      }
    }
  });
  cleanupField(playerKey);
  cleanupField(otherKey(playerKey));
  if (p.pendingEndOfTurnSelfDamage > 0) {
    p.hp -= p.pendingEndOfTurnSelfDamage;
    logAction(playerKey, "効果", `蓄積した効果の反動で${p.pendingEndOfTurnSelfDamage}ダメージを受けた。`);
    p.pendingEndOfTurnSelfDamage = 0;
  }
  checkWin();
}

function computeLightForTurn(playerKey) {
  const p = state.players[playerKey];
  const opp = state.players[otherKey(playerKey)];
  let bonus = 0;
  p.field.forEach((c) => {
    if (c.effect && (c.effect.kind === "passiveLightGain" || c.effect.kind === "passiveLightGainWithDrawPenalty")) {
      bonus += c.effect.params.light;
      if (c.effect.kind === "passiveLightGain" && c.element === "earth" && hasPassive(playerKey, "p-earth-light")) {
        bonus += 1;
      }
    }
  });
  if (p.abilities.passive.some((a) => a.id === "p-light-up")) bonus += 1;
  let penalty = 0;
  opp.field.forEach((c) => {
    if (c.effect && c.effect.kind === "enemyLightDrainThenSelfDamage") penalty += 1;
  });
  return Math.max(0, 5 + bonus - penalty);
}

function computeDrawPenalty(playerKey) {
  const p = state.players[playerKey];
  let penalty = 0;
  p.field.forEach((c) => { if (c.effect && c.effect.kind === "passiveLightGainWithDrawPenalty") penalty += 1; });
  return penalty;
}

// ---------- 対戦ロジック ----------

function drawCards(playerKey, count) {
  const p = state.players[playerKey];
  for (let i = 0; i < count; i++) {
    if (p.deck.length === 0) { triggerDeckOutLoss(playerKey); return; }
    p.hand.push(p.deck.pop());
  }
}

function triggerDeckOutLoss(playerKey) {
  if (state.gameOver) return;
  state.gameOver = true;
  logAction(playerKey, "情報", "山札が尽きて引けなかった。敗北。");
  const btn = document.getElementById("end-turn-btn");
  if (btn) btn.disabled = true;
  render();
}

function drawPhase(playerKey) {
  const p = state.players[playerKey];
  const penalty = computeDrawPenalty(playerKey);
  const need = Math.max(0, (p.hand.length < 5 ? 5 - p.hand.length : 1) - penalty);
  if (need > 0) drawCards(playerKey, need);
}

function startTurn(playerKey) {
  if (state.gameOver) return;
  const p = state.players[playerKey];
  p.light = computeLightForTurn(playerKey);

  // 自分の場にある「相手の光を削る代わりに自分も毎ターン1ダメージ」系の反動
  p.field.forEach((c) => {
    if (c.effect && c.effect.kind === "enemyLightDrainThenSelfDamage") {
      p.hp -= 1;
      logAction(playerKey, "効果", `${c.name}の反動で1ダメージを受けた。`);
    }
  });
  checkWin();
  if (state.gameOver) { render(); return; }

  drawPhase(playerKey);
  if (state.gameOver) { render(); return; }

  p.field.forEach((c) => { c.summoningSick = false; c.hasAttacked = false; });
  if (p.abilities.passive.some((a) => a.id === "p-regen")) p.hp = Math.min(p.maxHp, p.hp + 2);

  applyTurnStartEffects(playerKey);

  render();
  if (playerKey === "opponent" && !state.gameOver) setTimeout(runAiTurn, 500);
}

function otherKey(playerKey) { return playerKey === "self" ? "opponent" : "self"; }

function playCard(playerKey, instanceId) {
  if (state.gameOver) return false;
  const p = state.players[playerKey];
  const idx = p.hand.findIndex((c) => c.instanceId === instanceId);
  if (idx === -1) return false;
  const card = p.hand[idx];
  if (card.cost > p.light) {
    if (playerKey === "self") logAction(playerKey, "情報", `光が足りません(必要:${card.cost} / 所持:${p.light})`);
    return false;
  }
  if (card.type === "creature" && p.field.length >= 5) {
    if (playerKey === "self") logAction(playerKey, "情報", "場のクリーチャーが5体を超えるため召喚できません。");
    return false;
  }
  p.light -= card.cost;
  p.hand.splice(idx, 1);
  if (card.type === "creature") {
    const hasHaste = card.traits && card.traits.includes("速攻");
    const instance = { ...card, summoningSick: !hasHaste, hasAttacked: false, currentHealth: card.health };
    p.field.push(instance);
    logAction(playerKey, "召喚", `「${card.name}」を場に出した。${hasHaste ? "(速攻ですぐ動ける)" : ""}`);
    applyOnPlayEffect(playerKey, instance);
  } else {
    p.graveyard.push(card);
    logAction(playerKey, "使用", `「${card.name}」を使った。`);
    applyOnPlayEffect(playerKey, card);
  }
  render();
  return true;
}

const ACTIVE_LIGHT_COST = {
  "a-heal": 3, "a-nova": 5, "a-draw": 2, "a-shield": 3, "a-revive": 6, "a-boost": 2,
  "a-fire-blast": 4, "a-wind-haste": 2, "a-water-rain": 3, "a-earth-fortify": 3,
  "a-heaven-surge": 1, "a-nether-execute": 5,
};

function useActive(playerKey, abilityId) {
  if (state.gameOver) return false;
  const p = state.players[playerKey];
  if (p.usedActive.has(abilityId)) {
    if (playerKey === "self") logAction(playerKey, "情報", "このアクティブ能力はすでに使用済みです。");
    return false;
  }
  const ability = p.abilities.active.find((a) => a.id === abilityId);
  if (!ability) return false;
  const lightCost = ACTIVE_LIGHT_COST[ability.id] || 0;
  if (p.light < lightCost) {
    if (playerKey === "self") logAction(playerKey, "情報", `光が足りません(必要:${lightCost})`);
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
    case "a-fire-blast": {
      const target = pickWeakestEnemyCreature(playerKey);
      if (target) { target.currentHealth -= 4; cleanupField(otherKey(playerKey)); }
      break;
    }
    case "a-wind-haste": {
      const target = p.field.find((c) => c.summoningSick || c.hasAttacked) || p.field[0];
      if (target) { target.summoningSick = false; target.hasAttacked = false; }
      break;
    }
    case "a-water-rain":
      p.field.forEach((c) => { c.currentHealth = Math.min(c.health, c.currentHealth + 3); });
      break;
    case "a-earth-fortify":
      p.field.forEach((c) => { c.health += 2; c.currentHealth += 2; });
      break;
    case "a-heaven-surge":
      p.light += 4;
      break;
    case "a-nether-execute": {
      const target = pickStrongestEnemyForDebuff(playerKey);
      if (target) { target.currentHealth = -999; cleanupField(otherKey(playerKey)); }
      p.hp -= 2;
      checkWin();
      break;
    }
    default: break;
  }
  logAction(playerKey, "効果", `能力「${ability.name}」を発動した。`);
  render();
  return true;
}

function cleanupField(playerKey) {
  const p = state.players[playerKey];
  const dead = p.field.filter((c) => c.currentHealth <= 0);
  dead.forEach((c) => {
    p.graveyard.push(c);
    if (c.effect && c.effect.kind === "healPlayerOnDeath") {
      p.hp = Math.min(p.maxHp, p.hp + c.effect.params.heal);
      logAction(playerKey, "効果", `${c.name}が破壊され、HPが${c.effect.params.heal}回復した。`);
    }
  });
  p.field = p.field.filter((c) => c.currentHealth > 0);
}

function selectHandCard(instanceId) {
  if (state.gameOver || state.turnPlayer !== "self") return;
  state.selectedAttacker = null;
  state.selectedHandCard = instanceId;
  render();
}
function selectAttacker(playerKey, instanceId) {
  if (state.gameOver || playerKey !== state.turnPlayer || playerKey !== "self") return;
  const p = state.players[playerKey];
  const creature = p.field.find((c) => c.instanceId === instanceId);
  if (!creature) return;
  if (creature.summoningSick) { logAction("self", "情報", "召喚酔い中のクリーチャーは攻撃できません。"); return; }
  if (creature.hasAttacked) { logAction("self", "情報", "このクリーチャーはこのターンすでに攻撃しました。"); return; }
  state.selectedHandCard = null;
  state.selectedAttacker = { owner: playerKey, instanceId };
  render();
}
function cancelSelection() { state.selectedHandCard = null; state.selectedAttacker = null; render(); }
function confirmPlaySelectedCard() {
  if (!state.selectedHandCard) return;
  const id = state.selectedHandCard;
  state.selectedHandCard = null;
  playCard("self", id);
}

function resolveAttack(attackerOwner, attackerInstanceId, targetOwner, targetInstanceId) {
  if (state.gameOver) return;
  const atkP = state.players[attackerOwner];
  const attacker = atkP.field.find((c) => c.instanceId === attackerInstanceId);
  if (!attacker || attacker.hasAttacked || attacker.summoningSick) return;
  const defP = state.players[targetOwner];

  if (targetInstanceId === "PLAYER") {
    if (defP.field.length > 0) {
      if (attackerOwner === "self") logAction("self", "情報", "相手の場にクリーチャーがいるため、プレイヤーへの直接攻撃はできません。");
      return;
    }
    defP.hp -= attacker.attack;
    logAction(attackerOwner, "攻撃", `「${attacker.name}」が${playerLabel(targetOwner)}に${attacker.attack}ダメージ!`);
  } else {
    const defender = defP.field.find((c) => c.instanceId === targetInstanceId);
    if (!defender) return;
    const mult = getElementMultiplier(attacker.element, defender.element);
    let dmg;
    let destroyed = false;
    if (attacker.effect && attacker.effect.kind === "destroyOnAttackThenHalveSelf") {
      dmg = defender.currentHealth;
      destroyed = true;
    } else {
      dmg = Math.round(attacker.attack * mult);
      if (attacker.effect && (attacker.effect.kind === "bonusAttackDamage" || attacker.effect.kind === "bonusAttackDamageThenSelfDamageOnTurnEnd")) {
        dmg += attacker.effect.params.dmg + elementDamageBonus(attackerOwner, attacker.element);
      }
    }
    defender.currentHealth -= dmg;
    logAction(attackerOwner, "攻撃",
      `「${attacker.name}」が「${defender.name}」に${dmg}ダメージ` +
      (mult === 2 ? "(属性有利!)" : mult === 0.5 ? "(属性不利…)" : "") + "。"
    );
    if (destroyed) {
      attacker.currentHealth = Math.max(1, Math.floor(attacker.currentHealth / 2));
      logAction(attackerOwner, "効果", `「${attacker.name}」のHPが半分になった。`);
    }
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
      logAction(key, "情報", "HPが0になった。敗北。");
      const btn = document.getElementById("end-turn-btn");
      if (btn) btn.disabled = true;
    }
  }
}

function endTurn() {
  if (state.gameOver) return;
  state.selectedAttacker = null;
  state.selectedHandCard = null;
  applyTurnEndEffects(state.turnPlayer);
  if (state.gameOver) { render(); return; }
  state.turnPlayer = otherKey(state.turnPlayer);
  if (state.turnPlayer === "self") state.turnCount++;
  logAction(state.turnPlayer, "情報", `ターン開始(${state.turnCount})`);
  startTurn(state.turnPlayer);
}

function playerLabel(key) { return key === "self" ? "自分" : (AI_LEVEL === "ai" ? "AI" : "CPU"); }

function log(msg) {
  const logEl = document.getElementById("log");
  if (!logEl) return;
  const line = document.createElement("div");
  line.textContent = msg;
  logEl.prepend(line);
}

function logAction(actorKey, category, text) {
  const label = `${playerLabel(actorKey)}の${category}`;
  const full = `${label}: ${text}`;
  log(full);
  const banner = document.getElementById("action-banner");
  if (banner) banner.textContent = full;
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
      if (liveTargets.length === 0) { resolveAttack("opponent", attacker.instanceId, "self", "PLAYER"); return; }
      let best = null, bestScore = -Infinity;
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

function checkAndFinishAiTurn() { if (!state.gameOver) setTimeout(endTurn, 400); }

// ---------- 描画(対戦画面) ----------

function traitMarks(card) {
  const marks = [];
  if (card.traits && card.traits.includes("唯一")) marks.push("【唯一】");
  if (card.traits && card.traits.includes("速攻")) marks.push("【速攻】");
  return marks.join("");
}

function cardDetailHtml(card) {
  const traitMark = traitMarks(card);
  return `
    <div class="card-name">${traitMark}${card.name}</div>
    <div class="card-meta">${ELEMENT_NAMES[card.element]} / 光${card.cost}</div>
    ${card.type === "creature" ? `<div class="card-stats">攻${card.attack} / 体${card.currentHealth ?? card.health}</div>` : `<div class="card-stats">特殊効果</div>`}
    <div class="card-text">${card.text || "(効果なし)"}</div>
  `;
}

function cardEl(card, { clickable, onClick, small } = {}) {
  const div = document.createElement("div");
  div.className = `card element-${card.element}${small ? " card-small" : ""}`;
  div.innerHTML = cardDetailHtml(card);
  if (clickable) { div.classList.add("clickable"); div.onclick = onClick; }
  return div;
}

function renderSelectionPanel() {
  const content = document.getElementById("selection-content");
  content.innerHTML = "";

  if (state.selectedHandCard) {
    const s = state.players.self;
    const card = s.hand.find((c) => c.instanceId === state.selectedHandCard);
    if (!card) { content.innerHTML = `<p class="selection-hint">手札のカード、または自分の場のクリーチャーを選んでください。</p>`; return; }
    const detail = document.createElement("div");
    detail.className = `card selection-card-detail element-${card.element}`;
    detail.innerHTML = cardDetailHtml(card);
    const actions = document.createElement("div");
    actions.className = "selection-actions";
    const affordable = card.cost <= s.light;
    actions.innerHTML = `<p>${affordable ? "このカードを使いますか?" : "光が足りません(必要:" + card.cost + " / 所持:" + s.light + ")"}</p>`;
    const useBtn = document.createElement("button");
    useBtn.className = "confirm-btn";
    useBtn.textContent = card.type === "creature" ? "召喚する" : "使う";
    useBtn.disabled = !affordable;
    useBtn.onclick = confirmPlaySelectedCard;
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "cancel-btn";
    cancelBtn.textContent = "キャンセル";
    cancelBtn.onclick = cancelSelection;
    actions.appendChild(useBtn);
    actions.appendChild(cancelBtn);
    content.appendChild(detail);
    content.appendChild(actions);
  } else if (state.selectedAttacker) {
    const s = state.players.self;
    const creature = s.field.find((c) => c.instanceId === state.selectedAttacker.instanceId);
    if (!creature) { content.innerHTML = `<p class="selection-hint">手札のカード、または自分の場のクリーチャーを選んでください。</p>`; return; }
    const detail = document.createElement("div");
    detail.className = `card selection-card-detail element-${creature.element}`;
    detail.innerHTML = cardDetailHtml(creature);
    const actions = document.createElement("div");
    actions.className = "selection-actions";
    actions.innerHTML = `<p>攻撃対象(相手の場のクリーチャー、または相手プレイヤー)を選んでください。</p>`;
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "cancel-btn";
    cancelBtn.textContent = "キャンセル";
    cancelBtn.onclick = cancelSelection;
    actions.appendChild(cancelBtn);
    content.appendChild(detail);
    content.appendChild(actions);
  } else {
    content.innerHTML = `<p class="selection-hint">手札のカード、または自分の場のクリーチャーを選んでください。</p>`;
  }
}

function render() {
  const s = state.players.self;
  const o = state.players.opponent;

  document.getElementById("self-hp").textContent = s.hp;
  document.getElementById("self-maxhp").textContent = s.maxHp;
  document.getElementById("opponent-hp").textContent = o.hp;
  document.getElementById("opponent-maxhp").textContent = o.maxHp;
  document.getElementById("self-hp-bar").style.width = `${Math.max(0, (s.hp / s.maxHp) * 100)}%`;
  document.getElementById("opponent-hp-bar").style.width = `${Math.max(0, (o.hp / o.maxHp) * 100)}%`;
  document.getElementById("self-light").textContent = s.light;
  document.getElementById("opponent-light").textContent = o.light;
  document.getElementById("deck-count-self").textContent = s.deck.length;
  document.getElementById("deck-count-opponent").textContent = o.deck.length;
  document.getElementById("self-field-count").textContent = s.field.length;
  document.getElementById("opponent-field-count").textContent = o.field.length;
  document.getElementById("self-hand-count").textContent = s.hand.length;

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
    const isSelected = state.selectedHandCard === c.instanceId;
    const el = cardEl(c, { clickable: state.turnPlayer === "self", onClick: () => selectHandCard(c.instanceId) });
    if (isSelected) el.classList.add("selected");
    hand.appendChild(el);
  });

  renderSelectionPanel();

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
  state.selectedHandCard = null;
  state.gameOver = false;

  drawCards("self", 5);
  drawCards("opponent", 5);

  showScreen("game-screen");
  document.getElementById("end-turn-btn").onclick = endTurn;
  document.getElementById("end-turn-btn").disabled = false;
  document.getElementById("log").innerHTML = "";
  document.getElementById("action-banner").textContent = "";

  logAction("self", "情報", `対戦開始(相手: ${AI_LEVEL === "ai" ? "AI(強め)" : "CPU(かんたん)"})`);
  logAction(state.turnPlayer, "情報", `ターン開始(${state.turnCount})`);
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

window.addEventListener("error", (e) => { showFatalError(String(e.message || e)); });
window.addEventListener("unhandledrejection", (e) => { showFatalError(String((e.reason && e.reason.message) || e.reason || e)); });

try {
  init();
} catch (err) {
  showFatalError("初期化処理でエラーが発生しました: " + String(err));
}
