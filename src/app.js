const STORAGE_KEY = 'crowdquest.demo.v1';
const SETTINGS_KEY = 'crowdquest.settings.v1';
const names = ['moonmoth', 'pixelpoppy', 'tiny_titan', 'lorelei_tv', 'mossyboots', 'softreset'];
const starter = () => ({ round: null, players: {}, hints: [], bets: [], vows: [], history: [], messages: [], oracle: {}, counters: { rounds: 0, solves: 0 }, spoilerTerms: [], nameSpoilers: false, spoilers: [], mercy: null, reports: [] });
let state;
try { state = { ...starter(), ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }; }
catch { state = starter(); }
let toastTimer;
let twitchSocket = null;
let twitchToken = null;
let twitchLogin = '';
let twitchChannel = '';
let twitchClientId = '';
let twitchUserId = '';
let twitchBroadcasterId = '';
let twitchScopes = [];
let pendingOAuthState = null;
const syncChannel = 'BroadcastChannel' in window ? new BroadcastChannel('crowdquest-demo') : null;
const $ = (id) => document.getElementById(id);
const escapeHTML = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const display = (value = '') => escapeHTML(value).replace(/\n/g, '<br>');
const activeRound = () => Boolean(state.round && state.round.status === 'active');
const publishState = () => fetch('/api/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(state)}).catch(()=>{});
const save = () => { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); syncChannel?.postMessage(state); publishState(); render(); };
const toast = (message) => { const node = $('toast'); node.textContent = message; node.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove('show'), 2400); };
const user = (name) => {
  const clean = String(name || 'guest').replace(/^@/, '').trim().replace(/[^a-zA-Z0-9_]/g, '').slice(0, 24) || 'guest';
  if (!state.players[clean]) state.players[clean] = { keys: 50, oracle: 0, hints: 0, wins: 0, chatted: false };
  return clean;
};
function message(name, text, kind = 'chat', reward = '') {
  state.messages.push({ name, text, kind, reward, time: Date.now() });
  if (state.messages.length > 70) state.messages = state.messages.slice(-70);
}
function system(text, reward = '') { message('CrowdQuest', text, 'system', reward); }
function ensureRound(source = 'a stuck moment') {
  if (activeRound()) return false;
  state.counters.rounds++;
  state.round = { id: state.counters.rounds, status: 'active', openedAt: Date.now(), source, unlocks: 0, solvedAt: null };
  state.bets = [];
  message('CrowdQuest', `Round ${state.round.id} is open. Place your bets: !solo or !caves.`, 'system');
  toast('A new stuck round is live. Let the bets begin.');
  return true;
}
function sealHint(text, author = 'cozyquester') {
  const hintText = String(text || '').trim().slice(0, 180);
  if (!hintText) { toast('Add a hint before sealing it.'); return; }
  ensureRound('a sealed hint');
  const sealed = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, text: hintText, author: user(author), at: Date.now(), roundId: state.round.id, unlocked: false, boosts: {} };
  state.hints.push(sealed);
  if (state.hints.length > 80) state.hints = state.hints.slice(-80);
  const owner = state.players[sealed.author]; owner.hints++;
  if (!owner.chatted) { owner.keys += 5; owner.chatted = true; }
  message(sealed.author, 'sealed a hint in the vault.', 'chat');
  system(`A new hint was sealed. Vault pressure is building (${state.hints.filter((h) => !h.unlocked).length} in the vault).`);
  toast('Hint sealed. Chat can start betting.'); save();
}
function placeBet(name, side, amount) {
  const who = user(name);
  if (!activeRound()) { system(`@${who}, wait for a stuck round to open before betting.`); save(); return; }
  if (state.bets.some((bet) => bet.name === who)) { system(`@${who}, your bet is already in. No changing your mind mid-round.`); save(); return; }
  const player = state.players[who];
  const stake = Math.max(1, Math.min(1000, Math.floor(Number(amount) || 10)));
  if (player.keys < stake) { system(`@${who}, you have ${player.keys} keys. Chat a little or lower that bet.`); save(); return; }
  player.keys -= stake;
  state.bets.push({ name: who, side, stake });
  message(who, `put ${stake} keys on !${side}.`, 'chat');
  system(`@${who} is backing ${side === 'solo' ? 'their pride' : 'the unlock'} for ${stake} keys.`);
  save();
}
function makeVow(minutes, text, author = 'cozyquester') {
  if (!activeRound()) ensureRound('a streamer vow');
  const duration = Math.max(1, Math.min(180, Number(minutes) || 5));
  const vow = { id: `${Date.now()}`, text: String(text || `I'll solve this in ${duration} minutes`).trim().slice(0, 100), author: user(author), startedAt: Date.now(), deadline: Date.now() + duration * 60_000, status: 'active', roundId: state.round?.id ?? null };
  state.vows.push(vow);
  system(`VOW: ${vow.text} — ${duration} minutes on the clock.`);
  toast('Vow made. The clock is running.'); save();
}
function expireVows() {
  let changed = false;
  for (const vow of state.vows) if (vow.status === 'active' && Date.now() >= vow.deadline) {
    vow.status = 'broken'; vow.brokenAt = Date.now();
    system(`The clock ran out on “${vow.text}” — added to receipts.`);
    changed = true;
  }
  if (changed) { save(); toast('A vow expired. It is now in the receipts.'); }
}
function resolveBets(outcome) {
  const bets = state.bets;
  if (!bets.length) { state.bets = []; system(`Round settled: ${outcome === 'solo' ? 'clean solve' : 'the vault was unlocked'}. No bets this time.`); return; }
  const winners = bets.filter((bet) => bet.side === outcome);
  const winningStake = winners.reduce((sum, bet) => sum + bet.stake, 0);
  const losingStake = bets.filter((bet) => bet.side !== outcome).reduce((sum, bet) => sum + bet.stake, 0);
  if (!winners.length) {
    for (const bet of bets) state.players[bet.name].keys += bet.stake;
    system(`Round settled: no one picked ${outcome}. All wagers returned to the players.`);
  } else {
    let paid = 0;
    winners.forEach((bet, i) => {
      const share = i === winners.length - 1 ? losingStake - paid : Math.floor(losingStake * bet.stake / winningStake);
      paid += share;
      state.players[bet.name].keys += bet.stake + share;
      state.players[bet.name].wins++;
      system(`@${bet.name} called it and wins ${bet.stake + share} keys.`, `+${bet.stake + share} keys`);
    });
    const losers = bets.filter((bet) => bet.side !== outcome);
    if (losers.length) system(`${losers.length} bet${losers.length === 1 ? '' : 's'} missed the call. Better luck next round.`);
  }
  state.bets = [];
}
function unlockHint(index = 1, by = 'cozyquester') {
  if (!activeRound()) { system('The vault is open. Start a round before using !unlock.'); save(); return; }
  const locked = state.hints.filter((hint) => hint.roundId === state.round.id && !hint.unlocked);
  const target = [...locked].sort((a,b)=>Object.values(b.boosts||{}).reduce((x,y)=>x+y,0)-Object.values(a.boosts||{}).reduce((x,y)=>x+y,0))[index - 1];
  if (target) target.unlocked = true;
  state.round.unlocks = Math.max(state.round.unlocks + 1, index);
  const unlocker = user(by);
  message(unlocker, `unlocked hint ${index}.`, 'chat');
  if (state.round.unlocks === 1) {
    for (const vow of state.vows) if (vow.status === 'active' && vow.roundId === state.round.id) { vow.status = 'broken'; vow.brokenAt = Date.now(); system(`The vow “${vow.text}” was broken — added to receipts.`); }
    resolveBets('caves');
  }
  if (target) {
    if (target.revealUntil && Date.now() < target.revealUntil) { system(`Hint ${index} fully revealed: “${target.text}”`); target.revealUntil = 0; }
    else system(`Hint ${index} is out: “${target.text}”`);
    toast('A hint is unlocked. The !caves bettors called it.');
  } else {
    system(`Unlock ${index} called. ${locked.length ? 'No sealed hint is attached to this unlock.' : 'The vault has no sealed hints yet.'}`);
  }
  if (index >= 3 || state.round.unlocks >= 3) closeRound('unlocked');
  save();
}
function closeRound(result) {
  if (!activeRound()) return;
  state.round.status = result;
  state.round.solvedAt = Date.now();
  if (result === 'solved') {
    state.counters.solves++;
    const outcome = state.round.unlocks ? 'caves' : 'solo';
    if (state.bets.length) resolveBets(outcome);
    for (const vow of state.vows) if (vow.status === 'active' && vow.roundId === state.round.id) { vow.status = Date.now() <= vow.deadline ? 'kept' : 'broken'; vow.closedAt = Date.now(); if (vow.status === 'kept') system(`Vow kept: “${vow.text}”. Put that in the Hall of Fame.`); else { vow.brokenAt = Date.now(); system(`The vow “${vow.text}” didn't make it — added to receipts.`); } }
    system('The round is solved. The vault is at rest.');
  } else {
    if (state.bets.length) resolveBets('caves');
    system('Round closed: the vault gave way after three unlocks.');
  }
}
const ignored = new Set(['the','and','for','with','that','this','from','into','your','you','are','was','were','have','has','will','when','what','where','how','why','who','then','than','they','them','their','there','here','about','just','very','more','some','could','would','should','hint','solve','solved','puzzle','worked','work','find','look','like','beneath','under','over','near','through','without','unlock','unlocking','solution','answer','key','clue','its','it','one','two','three','not','all','each','out','but','only','also','can','youre','is','in','on','a','an','to','of','as','at','by','i','we','our','my']);
function keywords(text) { return new Set(String(text || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((word) => word.length > 2 && !ignored.has(word))); }
function scoreOracles(solution) {
  const solutionWords = keywords(solution);
  if (!solutionWords.size) return [];
  const results = state.hints.filter((hint) => hint.roundId === state.round?.id).map((hint) => {
    const words = keywords(hint.text), overlap = [...words].filter((word) => solutionWords.has(word));
    return { hint, score: words.size ? overlap.length / Math.max(2, Math.min(words.size, solutionWords.size)) : 0, overlap };
  }).filter((result) => result.overlap.length && result.score >= 0.25).sort((a, b) => b.score - a.score);
  for (const result of results) {
    const owner = state.players[result.hint.author] || (state.players[result.hint.author] = { keys: 50, oracle: 0, hints: 0, wins: 0, chatted: false });
    const earned = Math.max(10, 10 + result.overlap.length * 5);
    owner.keys += earned;
    owner.oracle += 1;
    state.oracle[result.hint.author] = (state.oracle[result.hint.author] || 0) + 1;
    result.earned = earned;
    system(`Oracle called it: @${result.hint.author}'s hint matched “${result.overlap.join(', ')}”.`, `+${earned} keys · +1 Oracle`);
  }
  return results;
}
function solve(solution) {
  if (!activeRound()) { system('There is no round to solve. Call !stuck or seal a hint first.'); save(); return; }
  const outcome = state.round.unlocks ? 'caves' : 'solo';
  const scores = scoreOracles(solution);
  closeRound('solved');
  state.history.push({ id: state.round.id, at: Date.now(), source: state.round.source, result: outcome, solution: String(solution).trim().slice(0, 160), hints: state.hints.filter((h) => h.roundId === state.round.id || !h.roundId).length, oracles: scores.map((item) => item.hint.author) });
  toast(scores.length ? `${scores.length} Oracle${scores.length === 1 ? '' : 's'} called it!` : 'Round solved. A new quest awaits.');
  save();
}
function handleCommand(raw, actor = names[Math.floor(Math.random() * names.length)]) {
  const input = String(raw || '').trim();
  if (!input) return;
  const command = input.match(/^!([\w]+)(?:\s+([\s\S]*))?$/);
  const who = user(actor);
  const spoiler = state.spoilerTerms.find((term)=>term && input.toLowerCase().includes(term.toLowerCase()));
  if (spoiler && !input.startsWith('!')) { state.spoilers.push({ name: who, text: input, term: spoiler, at: Date.now() }); system(state.nameSpoilers?`Spoiler caught from @${who}.`:'A spoiler was caught and redacted.'); save(); return; }
  if (!state.players[who].chatted) { state.players[who].chatted = true; state.players[who].keys += 5; system(`@${who} earned 5 keys for joining the chat.`, '+5 keys'); }
  if (!command) {
    message(who, input);
    save(); return;
  }
  const [, cmd, argText = ''] = command;
  const [first, ...rest] = argText.split(/\s+/);
  switch (cmd.toLowerCase()) {
    case 'stuck': ensureRound('!stuck'); save(); break;
    case 'hint': if (!argText.trim()) { system(`@${who}, add a hint after !hint.`); save(); } else sealHint(argText, who); break;
    case 'solo': case 'caves': placeBet(who, cmd.toLowerCase(), first); break;
    case 'unlock': unlockHint(Number(first) || 1, who); break;
    case 'solved': case 'solve': solve(argText.trim() || 'the puzzle solution'); break;
    case 'vow': {
      const timer = first?.match(/^(\d+)(m|min|mins|minutes?|h|hr|hours?)?$/i);
      if (!timer) { system(`@${who}, try !vow 5m I'll solve without hints.`); save(); break; }
      const unit = (timer[2] || 'm').toLowerCase();
      const minutes = Number(timer[1]) * (unit.startsWith('h') ? 60 : 1);
      makeVow(minutes, rest.join(' ') || `I'll solve this in ${minutes} minutes`, who); break;
    }
    case 'receipts': {
      const broken = state.vows.filter((vow) => vow.status === 'broken');
      if (!broken.length) system(`@${who}, the Hall of Shame is empty. For now.`);
      else { system(`THE RECEIPTS: ${broken.slice(-3).map((vow) => `“${vow.text}” by @${vow.author}`).join(' · ')}`); }
      save(); break;
    }
    case 'keys': system(`@${who}, you have ${state.players[who].keys} keys. Chat, bet and trust your instincts to earn more.`); save(); break;
    case 'guess': {
      const guess = argText.trim().toLowerCase();
      const reveal = state.hints.find((hint) => hint.revealUntil > Date.now() && !hint.revealAt);
      if (!reveal) { system(`@${who}, there is no redacted hint right now.`); save(); break; }
      const answer = keywords(reveal.text), guessWords = keywords(guess);
      if ([...guessWords].some((word) => answer.has(word))) { reveal.guess = guess; reveal.guesser = who; state.players[who].keys += 5; system(`@${who} cracked a redacted hint and earned 5 keys.`, '+5 keys'); }
      else { message(who, 'made a guess at the redacted hint.'); }
      save(); break;
    }
    case 'boost': {
      const hint=state.hints.filter(h=>h.roundId===state.round?.id&&!h.unlocked)[Math.max(0,(Number(first)||1)-1)]; const amount=Math.max(1,Math.min(100,Number(rest[0])||10));
      if(!activeRound()||!hint){system(`@${who}, there is no sealed hint at that number to boost.`);save();break;}
      if(state.players[who].keys<amount){system(`@${who}, you need ${amount} keys to boost that hint.`);save();break;}
      state.players[who].keys-=amount;hint.boosts[who]=(hint.boosts[who]||0)+amount;system(`@${who} boosted hint ${first||1} with ${amount} keys.`);save();break;
    }
    case 'mercy': { if(!activeRound()){system('Mercy votes only open during a stuck round.');save();break;} if(Date.now()-state.round.openedAt<5*60_000){system(`@${who}, mercy opens after five minutes stuck.`);save();break;} state.mercy ||= {roundId:state.round.id,yes:[],no:[],openedAt:Date.now()}; if(state.mercy.roundId!==state.round.id)state.mercy={roundId:state.round.id,yes:[],no:[],openedAt:Date.now()}; const ballot=(first||'yes').toLowerCase()==='no'?'no':'yes';if(!state.mercy.yes.includes(who)&&!state.mercy.no.includes(who))state.mercy[ballot].push(who);const total=state.mercy.yes.length+state.mercy.no.length;if(state.mercy.yes.length>total/2&&!state.mercy.passed){state.mercy.passed=true;system('Mercy vote passed. The streamer is offered an unlock; the choice is theirs.');}system(`@${who} votes ${ballot==='yes'?'to offer an unlock':'to keep going'}. ${state.mercy.yes.length} for mercy, ${state.mercy.no.length} to keep going.`);save();break; }
    default: message(who, input); system(`@${who}, try !stuck, !hint, !solo, !caves, !unlock, !vow, !receipts, !boost, !mercy or !keys.`); save();
  }
}
function renderFeed() {
  const feed = $('chat-feed');
  if (!state.messages.length) { feed.innerHTML = '<div class="chat-empty"><span>✧</span><strong>Chat is warming up.</strong><small>Try a command below to kick off the round.</small></div>'; return; }
  feed.innerHTML = state.messages.slice(-30).map((item) => `<div class="chat-line"><strong class="${item.kind === 'system' ? 'chat-system' : ''}">${escapeHTML(item.name)}</strong> ${display(item.text)}${item.reward ? ` <span class="chat-reward">${escapeHTML(item.reward)}</span>` : ''}</div>`).join('');
  feed.scrollTop = feed.scrollHeight;
}
function renderLeaderboard() {
  const rows = Object.entries(state.players).filter(([, player]) => player.oracle > 0).sort((a, b) => b[1].oracle - a[1].oracle || b[1].keys - a[1].keys).slice(0, 5);
  $('leaderboard').innerHTML = rows.length ? rows.map(([name, player], index) => `<div class="leader-row"><span class="leader-rank">${String(index + 1).padStart(2, '0')}</span><span class="leader-face">${escapeHTML(name.slice(0, 1).toUpperCase())}</span><span class="leader-person"><strong>${escapeHTML(name)}</strong><small>${player.oracle >= 5 ? 'Vault legend' : player.oracle >= 3 ? 'Lore keeper' : 'Sharp eyes'}</small></span><span class="leader-points">✧ ${player.oracle}</span></div>`).join('') : '<div class="leader-empty"><span>✧</span><strong>The first Oracle is out there.</strong><small>Seal a hint and solve the puzzle to find them.</small></div>';
  $('total-oracles').textContent = Object.values(state.oracle).reduce((sum, count) => sum + count, 0);
}
function currentReport(){const round=state.round;const hints=round?state.hints.filter(h=>h.roundId===round.id):[];const vows=state.vows.filter(v=>!round||v.roundId===round.id);const oracles=Object.entries(state.players).filter(([,p])=>p.oracle>0).sort((a,b)=>b[1].oracle-a[1].oracle)[0];return {round:round?.id||state.counters.rounds,hints:hints.length,unlocks:round?.unlocks||0,broken:vows.filter(v=>v.status==='broken').length,oracle:oracles?.[0]||'—',spoilers:state.spoilers.length};}
function reportText(){const r=currentReport();return `CrowdQuest Vault Report · Round ${r.round}\n${r.hints} hints sealed · ${r.unlocks} unlocks · ${r.broken} vows broken · Top Oracle: ${r.oracle} · ${r.spoilers} spoilers caught.`;}
function refreshReport(){const r=currentReport();$('report-content').innerHTML=`<div class="report-card"><h3>Round ${r.round} · ${state.round?.status||'no round'}</h3><p>${escapeHTML(reportText()).replace(/\n/g,'<br>')}</p><div class="report-stats"><div class="report-stat"><b>${r.hints}</b><small>HINTS SEALED</small></div><div class="report-stat"><b>${r.unlocks}</b><small>TIMES CAVED</small></div><div class="report-stat"><b>${r.oracle}</b><small>TOP ORACLE</small></div><div class="report-stat"><b>${r.broken}</b><small>VOWS BROKEN</small></div></div></div>`;}
function render() {
  expireVows();
  const hints = state.hints.filter((hint) => !hint.unlocked);
  $('total-keys').textContent = Object.values(state.players).reduce((sum, player) => sum + player.keys, 0).toLocaleString();
  $('hint-count').textContent = hints.length;
  $('nav-hints').textContent = hints.length;
  const totalOracle = Object.values(state.players).reduce((sum, player) => sum + player.oracle, 0);
  $('oracle-rate').textContent = totalOracle ? `${Math.round(totalOracle / Math.max(1, state.hints.length) * 100)}%` : '—';
  $('oracle-unit').textContent = totalOracle ? `${totalOracle} right call${totalOracle === 1 ? '' : 's'}` : 'no solves yet';
  const settledVows = state.vows.filter((vow) => vow.status === 'kept' || vow.status === 'broken');
  const kept = settledVows.filter((vow) => vow.status === 'kept').length;
  $('vow-rate').textContent = settledVows.length ? `${Math.round(kept / settledVows.length * 100)}%` : '—';
  $('vow-unit').textContent = settledVows.length ? `${kept} kept · ${settledVows.length - kept} broken` : state.vows.length ? 'clock is running' : 'awaiting vows';
  $('bettor-count').textContent = state.bets.length;
  const soloStake = state.bets.filter((bet) => bet.side === 'solo').reduce((sum, bet) => sum + bet.stake, 0);
  const cavesStake = state.bets.filter((bet) => bet.side === 'caves').reduce((sum, bet) => sum + bet.stake, 0);
  $('pot-amount').textContent = soloStake + cavesStake;
  $('solo-odds').textContent = soloStake ? `${((soloStake + cavesStake) / soloStake).toFixed(1)}×` : '1.0×';
  $('caves-odds').textContent = cavesStake ? `${((soloStake + cavesStake) / cavesStake).toFixed(1)}×` : '1.0×';
  document.querySelectorAll('.bet-option').forEach((button) => button.disabled = !activeRound());
  const round = state.round;
  $('round-state').classList.toggle('is-live', activeRound());
  $('round-state').innerHTML = activeRound() ? '<i></i> ROUND LIVE' : round ? '<i></i> LAST ROUND SETTLED' : '<i></i> WAITING FOR A STUCK MOMENT';
  $('round-helper').textContent = activeRound() ? 'The round is live. Seal a hint, make a vow, or let chat back their instincts.' : 'Your next stuck moment starts a round. Chat bets, vows, and sealed hints all live here.';
  const stage = $('vault-stage');
  const pressure = Math.min(100, hints.length * 20 + (round?.unlocks || 0) * 15);
  stage.classList.toggle('pressure-2', pressure >= 40 && pressure < 75);
  stage.classList.toggle('pressure-3', pressure >= 75);
  $('pressure-fill').style.width = `${Math.max(2, pressure)}%`;
  $('pressure-label').textContent = pressure >= 75 ? 'STRAINING' : pressure >= 40 ? 'RISING' : pressure ? 'BUILDING' : 'CALM';
  $('vault-eyebrow').textContent = activeRound() ? `ROUND ${String(round.id).padStart(2, '0')} · ${hints.length} SEALED HINT${hints.length === 1 ? '' : 'S'}` : round ? `ROUND ${String(round.id).padStart(2, '0')} · ${round.status === 'solved' ? 'SOLVED' : 'UNLOCKED'}` : 'NOTHING SEALED. YET.';
  $('vault-title').innerHTML = activeRound() ? `The vault is<br /><em>${pressure >= 75 ? 'under pressure.' : 'holding.'}</em>` : 'The vault is<br /><em>wide open.</em>';
  $('vault-description').innerHTML = activeRound() ? `${round.unlocks ? `${round.unlocks} unlock${round.unlocks === 1 ? '' : 's'} so far.` : 'No unlocks yet.'} Chat thinks ${soloStake >= cavesStake ? '<code>!solo</code>' : '<code>!caves</code>'} is more likely.` : 'Drop a hint or call <code>!stuck</code> to get chat in on the puzzle.';
  const activeVow = [...state.vows].reverse().find((vow) => vow.status === 'active');
  if (activeVow) $('vault-description').innerHTML += `<br><span class="vow-timer">VOW ${escapeHTML(activeVow.text)} · <b data-deadline="${activeVow.deadline}">${timerText(activeVow.deadline)}</b></span>`;
  $('new-round').innerHTML = activeRound() ? '<span>＋</span> Seal a hint' : '<span>＋</span> Start a round';
  renderFeed(); renderLeaderboard();
  $('spoiler-feed').innerHTML=state.spoilers.slice(-5).map(s=>`<div class="spoiler-item">⚑ ${state.nameSpoilers?`<span class="offender">${escapeHTML(s.name)}</span> posted`:'Spoiler caught'}: <span class="redacted">${escapeHTML(s.text)}</span></div>`).join('');
}
function timerText(deadline) { const secs = Math.max(0, Math.ceil((deadline - Date.now()) / 1000)); return `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`; }
function tick() { for (const node of document.querySelectorAll('[data-deadline]')) node.textContent = timerText(Number(node.dataset.deadline)); }

function loadTwitchSettings() {
  try { const config = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); $('twitch-client-id').value = config.clientId || ''; $('twitch-channel').value = config.channel || ''; }
  catch { /* Ignore invalid local settings. */ }
}
function twitchStatus(connected, label) {
  const button = $('twitch-connect');
  button.textContent = connected ? '● Disconnect Twitch' : '◉  Connect Twitch';
  button.classList.toggle('is-connected', connected);
  const badge = document.querySelector('.demo-badge');
  badge.innerHTML = `<span></span> ${connected ? `LIVE · #${escapeHTML(twitchChannel)}` : 'SIMULATOR'}`;
  badge.classList.toggle('is-connected', connected);
  if (label) toast(label);
}
function connectToTwitch(token, login, channel, clientId, userId, scopes) {
  twitchSocket?.close();
  twitchToken = token;
  twitchLogin = login.toLowerCase();
  twitchChannel = channel.toLowerCase();
  twitchClientId = clientId;
  twitchUserId = userId;
  twitchScopes = scopes || [];
  twitchBroadcasterId = '';
  if (twitchLogin === twitchChannel) twitchBroadcasterId = twitchUserId;
  else fetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(twitchChannel)}`, {headers:{'Client-Id':twitchClientId,Authorization:`Bearer ${twitchToken}`}}).then(r=>r.ok?r.json():null).then(j=>{twitchBroadcasterId=j?.data?.[0]?.id||'';updateReportButton();}).catch(()=>{});
  const socket = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
  twitchSocket = socket;
  socket.addEventListener('open', () => {
    if (socket !== twitchSocket) return;
    socket.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
    socket.send(`PASS oauth:${token}`);
    socket.send(`NICK ${twitchLogin}`);
  });
  socket.addEventListener('message', (event) => {
    if (socket !== twitchSocket || typeof event.data !== 'string') return;
    for (const line of event.data.split('\r\n')) {
      if (!line) continue;
      if (line.startsWith('PING ')) { socket.send(line.replace(/^PING/, 'PONG')); continue; }
      if (/\s001\s/.test(line)) { socket.send(`JOIN #${twitchChannel}`); twitchStatus(true, `Connected to Twitch chat #${twitchChannel}.`); continue; }
      if (/NOTICE \* :Login authentication failed/i.test(line)) { socket.close(); twitchToken = null; twitchStatus(false, 'Twitch did not accept this token. Reconnect and authorize chat access.'); continue; }
      const chatLine = line.match(/^(?:@[^ ]+ )?:([^! ]+)!.* PRIVMSG #[^ ]+ :([\s\S]*)$/);
      if (chatLine) handleCommand(chatLine[2], chatLine[1]);
    }
  });
  socket.addEventListener('error', () => { if (socket === twitchSocket) twitchStatus(false, 'Could not reach Twitch chat. Check the connection and try again.'); });
  socket.addEventListener('close', () => { if (socket === twitchSocket) { twitchSocket = null; twitchToken = null; twitchStatus(false); } });
}
function canPinReport(){return Boolean(twitchToken&&twitchClientId&&twitchUserId&&twitchBroadcasterId&&twitchScopes.includes('user:write:chat')&&twitchScopes.includes('moderator:manage:chat_messages'));}
function updateReportButton(){const button=$('report-post');if(!button)return;button.disabled=!canPinReport();button.textContent=canPinReport()?'Post & pin report':'Post & pin (extra Twitch access needed)';}
async function validateAndJoin(token, channel) {
  let login = '';
  let userId = '';
  let scopes = [];
  const config = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  try {
    const response = await fetch('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${token}` } });
    if (response.ok) {
      const userInfo = await response.json();
      scopes = userInfo.scopes || [];
      if (!scopes.includes('chat:read') || !scopes.includes('chat:edit')) throw new Error('Twitch authorization needs chat:read and chat:edit scopes.');
      login = userInfo.login || '';
      userId = userInfo.user_id || '';
    }
  } catch (error) {
    if (error instanceof Error && /needs both/.test(error.message)) { toast(error.message); return; }
    // Twitch IRC performs its own token validation when the socket authenticates.
  }
  if (!login) login = channel;
  connectToTwitch(token, login, channel, config.clientId, userId, scopes);
}

$('chat-form').addEventListener('submit', (event) => { event.preventDefault(); const input = $('chat-input'); const value = input.value; input.value = ''; handleCommand(value); });
document.querySelectorAll('[data-command]').forEach((button) => button.addEventListener('click', () => handleCommand(button.dataset.command)));
$('new-round').addEventListener('click', () => {
  if (!activeRound()) ensureRound('streamer started a round');
  $('hint-dialog').showModal();
});
$('make-vow').addEventListener('click', () => { if (!activeRound()) ensureRound('a streamer vow'); $('vow-dialog').showModal(); });
$('solve-round').addEventListener('click', () => { if (!activeRound()) { toast('Start a round before solving it.'); return; } $('solve-dialog').showModal(); });
$('hint-form').addEventListener('submit', (event) => { event.preventDefault(); sealHint($('hint-text').value, $('hint-author').value); $('hint-text').value = ''; $('hint-dialog').close(); });
$('vow-form').addEventListener('submit', (event) => { event.preventDefault(); makeVow($('vow-minutes').value, $('vow-text').value); $('vow-dialog').close(); });
$('solve-form').addEventListener('submit', (event) => { event.preventDefault(); solve($('solve-text').value); $('solve-text').value = ''; $('solve-dialog').close(); });
$('auction-open').addEventListener('click',()=>{$('auction-dialog').showModal();});
$('auction-form').addEventListener('submit',(event)=>{event.preventDefault();const n=Number($('auction-hint').value)||1;handleCommand(`!boost ${n} ${Number($('auction-keys').value)||10}`);$('auction-dialog').close();});
$('safety-open').addEventListener('click',()=>{$('spoiler-terms').value=(state.spoilerTerms||[]).join(', ');$('spoiler-name-optin').checked=Boolean(state.nameSpoilers);$('safety-dialog').showModal();});
$('safety-form').addEventListener('submit',(event)=>{event.preventDefault();state.spoilerTerms=$('spoiler-terms').value.split(',').map(t=>t.trim()).filter(Boolean).slice(0,20);state.nameSpoilers=$('spoiler-name-optin').checked;save();$('safety-dialog').close();toast('Spoiler jail settings saved.');});
$('reveal-open').addEventListener('click',()=>{const locked=state.hints.filter(h=>h.roundId===state.round?.id&&!h.unlocked);$('reveal-hint').innerHTML=locked.map((h,i)=>`<option value="${escapeHTML(h.id)}">Hint ${i+1} · ${escapeHTML(h.author)}</option>`).join('');if(!locked.length){toast('Seal a hint before starting a redacted reveal.');return;}$('reveal-dialog').showModal();});
$('reveal-form').addEventListener('submit',(event)=>{event.preventDefault();const hint=state.hints.find(h=>h.id===$('reveal-hint').value);if(!hint)return;hint.revealUntil=Date.now()+20000;hint.revealAt=0;system(`A redacted hint is live for 20 seconds. Guess with !guess <word>.`);save();$('reveal-dialog').close();setTimeout(()=>{if(hint.revealUntil&&Date.now()>=hint.revealUntil){hint.revealAt=Date.now();system(`The redacted hint is fully revealed: “${hint.text}”`);save();}},20050);});
$('mercy-vote').addEventListener('click',()=>{if(!activeRound()){toast('Mercy votes open during a stuck round.');return;}if(Date.now()-state.round.openedAt<5*60_000){toast('Mercy vote opens after five minutes stuck.');return;}state.mercy={roundId:state.round.id,yes:[],no:[],openedAt:Date.now()};$('mercy-content').textContent='Chat can vote with !mercy. A majority only offers an unlock.';save();$('mercy-dialog').showModal();});
$('mercy-yes').addEventListener('click',()=>{state.mercy ||= {roundId:state.round?.id,yes:[],no:[],openedAt:Date.now()};for(const n of names.slice(0,4))if(!state.mercy.yes.includes(n))state.mercy.yes.push(n);const total=state.mercy.yes.length+state.mercy.no.length;const passed=total>0&&state.mercy.yes.length>total/2;$('mercy-content').textContent=`${state.mercy.yes.length} for mercy · ${state.mercy.no.length} to continue${passed?' · Majority reached. The streamer is offered an unlock.':''}`;if(passed)system('Mercy vote passed. The streamer is offered an unlock; the choice is theirs.');save();});
$('mercy-no').addEventListener('click',()=>{state.mercy ||= {roundId:state.round?.id,yes:[],no:[],openedAt:Date.now()};for(const n of names.slice(0,4))if(!state.mercy.no.includes(n))state.mercy.no.push(n);const total=state.mercy.yes.length+state.mercy.no.length;const passed=state.mercy.yes.length>total/2;$('mercy-content').textContent=`${state.mercy.yes.length} for mercy · ${state.mercy.no.length} to continue${passed?' · Majority reached. The streamer is offered an unlock.':''}`;save();});
$('report-open').addEventListener('click',()=>{refreshReport();updateReportButton();$('report-dialog').showModal();});
$('report-copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(reportText());toast('Vault Report copied.');}catch{toast('Copy the report text from the card.');}});
$('report-post').addEventListener('click',async()=>{if(!canPinReport()){toast('Reconnect and authorize the chat-write and chat-moderation scopes with a broadcaster or moderator account.');return;}const button=$('report-post');button.disabled=true;try{const response=await fetch('https://api.twitch.tv/helix/chat/messages',{method:'POST',headers:{'Client-Id':twitchClientId,Authorization:`Bearer ${twitchToken}`,'Content-Type':'application/json'},body:JSON.stringify({broadcaster_id:twitchBroadcasterId,sender_id:twitchUserId,message:reportText().replace(/\n/g,' '),pin:true})});const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.message||`Twitch returned ${response.status}`);if(result.data?.[0]?.is_sent===false)throw new Error(result.data[0].drop_reason?.message||'Twitch did not send the report.');toast('Vault Report posted and pinned in Twitch chat.');$('report-dialog').close();}catch(error){toast(`Could not pin report: ${error.message}`);}finally{updateReportButton();}});
document.querySelector('.bets-panel').addEventListener('click', (event) => {
  const button = event.target.closest('[data-bet]');
  if (!button) return;
  if (!activeRound()) { toast('Bets open when a round starts.'); return; }
  const side = button.dataset.bet;
  if (!state.bets.length) { placeBet(names[0], side, 10); placeBet(names[1], side, 15); placeBet(names[2], side === 'solo' ? 'caves' : 'solo', 8); }
  else placeBet(names.find((name) => !state.bets.some((bet) => bet.name === name)) || `guest${state.bets.length + 1}`, side, 10);
  document.querySelectorAll('.bet-option').forEach((node) => node.classList.toggle('selected', node === button));
});
document.querySelector('.main-nav').addEventListener('click', (event) => {
  const link = event.target.closest('a[href^="#"]'); if (!link) return;
  event.preventDefault();
  if (link.hash === '#receipts') {
    const entries = state.vows.filter((vow) => vow.status === 'broken');
    if (entries.length) { $('chat-feed').innerHTML = entries.slice(-15).map((vow) => `<div class="chat-line"><strong class="chat-system">RECEIPT · ${escapeHTML(vow.author)}</strong> “${escapeHTML(vow.text)}” · ${new Date(vow.brokenAt || vow.deadline).toLocaleString()}</div>`).join(''); $('chat-feed').scrollTop = $('chat-feed').scrollHeight; toast(`${entries.length} broken vow${entries.length === 1 ? '' : 's'} in the Hall of Shame.`); }
    else toast('No broken vows. The Hall of Shame awaits its first entry.');
    return;
  }
  if (link.hash === '#hall') $('hall').scrollIntoView({ behavior: 'smooth', block: 'center' });
  else if (link.hash === '#vault') $('vault').scrollIntoView({ behavior: 'smooth', block: 'center' });
  else window.scrollTo({ top: 0, behavior: 'smooth' });
});
document.querySelector('.top-actions').addEventListener('click', (event) => {
  if (event.target.closest('#twitch-connect')) {
    if (twitchSocket) { twitchSocket.close(); twitchSocket = null; twitchToken = null; twitchStatus(false, 'Disconnected from Twitch chat.'); }
    else { loadTwitchSettings(); $('connect-dialog').showModal(); }
  }
  if (event.target.closest('.icon-button')) { $('overlay-url').textContent = `${location.origin}/overlay`; $('overlay-dialog').showModal(); }
});
$('connect-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const clientId = $('twitch-client-id').value.trim();
  const channel = $('twitch-channel').value.trim().replace(/^#/, '').toLowerCase();
  if (!/^[a-zA-Z0-9]{20,40}$/.test(clientId)) { toast('Enter the Client ID from a registered Twitch developer app.'); return; }
  if (!/^[a-z0-9_]{1,25}$/.test(channel)) { toast('Enter a valid Twitch channel login.'); return; }
  const redirect = `${location.origin}/oauth/callback`;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ clientId, channel }));
  const stateBytes = crypto.getRandomValues(new Uint8Array(24));
  pendingOAuthState = [...stateBytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  sessionStorage.setItem('crowdquest.oauth.state', pendingOAuthState);
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: 'token', scope: 'chat:read chat:edit user:write:chat moderator:manage:chat_messages', state: pendingOAuthState });
  const popup = window.open(`https://id.twitch.tv/oauth2/authorize?${params}`, 'crowdquest-twitch-auth', 'popup,width=620,height=740');
  if (!popup) { toast('Allow the Twitch sign-in popup, then try again.'); return; }
  $('connect-dialog').close();
  toast('Approve chat access in the Twitch window to connect.');
});
window.addEventListener('message', (event) => {
  if (event.origin !== location.origin || event.data?.type !== 'crowdquest-twitch-oauth') return;
  const expected = sessionStorage.getItem('crowdquest.oauth.state');
  sessionStorage.removeItem('crowdquest.oauth.state');
  if (!expected || event.data.state !== expected) { toast('Twitch sign-in state did not match. Reconnect and try again.'); return; }
  if (event.data.error) { toast(`Twitch authorization was not completed: ${event.data.error}`); return; }
  if (!event.data.token) { toast('Twitch did not return a chat access token. Try connecting again.'); return; }
  pendingOAuthState = null;
  const config = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  validateAndJoin(event.data.token, config.channel);
});
document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', (event) => { event.preventDefault(); (button.closest('dialog') || $(button.dataset.close))?.close(); }));
$('close-overlay').addEventListener('click', () => $('overlay-dialog').close());
$('profile-menu-toggle').addEventListener('click', (event) => { event.stopPropagation(); const menu=$('profile-menu'); menu.hidden=!menu.hidden; $('profile-menu-toggle').setAttribute('aria-expanded',String(!menu.hidden)); });
$('profile-menu').addEventListener('click',(event)=>{const action=event.target.closest('[data-profile-action]')?.dataset.profileAction;if(!action)return;$('profile-menu').hidden=true;$('profile-menu-toggle').setAttribute('aria-expanded','false');if(action==='connect')$('twitch-connect').click();if(action==='overlay')document.querySelector('.icon-button').click();if(action==='reset')$('reset-demo').click();});
document.addEventListener('click',(event)=>{if(!event.target.closest('#profile-menu')&&!event.target.closest('#profile-menu-toggle')){$('profile-menu').hidden=true;$('profile-menu-toggle').setAttribute('aria-expanded','false');}});
document.addEventListener('keydown',(event)=>{if(event.key==='Escape'){$('profile-menu').hidden=true;$('profile-menu-toggle').setAttribute('aria-expanded','false');}});
$('copy-url').addEventListener('click', async () => { try { await navigator.clipboard.writeText(`${location.origin}/overlay`); toast('Overlay address copied.'); } catch { toast('Copy this address from the field above.'); } });
$('reset-demo').addEventListener('click', () => { if (!window.confirm('Reset your local CrowdQuest demo, points, rounds, and receipts?')) return; localStorage.removeItem(STORAGE_KEY); state = starter(); save(); toast('Demo reset.'); });
document.addEventListener('keydown', (event) => {
  if (event.altKey && event.key.toLowerCase() === 'v') $('vow-dialog').showModal();
  if (event.altKey && event.key.toLowerCase() === 's') $('solve-dialog').showModal();
});
window.addEventListener('beforeunload', () => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {} });
setInterval(tick, 1000);
setInterval(expireVows, 5000);
syncChannel?.addEventListener('message', (event) => {
  if (location.pathname !== '/overlay' || !event.data) return;
  state = event.data; render();
});
window.addEventListener('storage', (event) => {
  if (location.pathname === '/overlay' && event.key === STORAGE_KEY && event.newValue) { try { state = JSON.parse(event.newValue); render(); } catch {} }
});
render();
loadTwitchSettings();
publishState();

