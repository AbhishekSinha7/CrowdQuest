const KEY = 'crowdquest.demo.v1';
const $ = (id) => document.getElementById(id);
let state;
try { state = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { state = null; }
function countdown(deadline) { const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000)); return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }
function render() {
  const round = state?.round;
  const active = round?.status === 'active';
  $('empty').classList.toggle('hidden', Boolean(active));
  $('overlay').classList.toggle('hidden', !active);
  if (!active) return;
  const hints = (state.hints || []).filter((hint) => hint.roundId === round.id);
  const sealed = hints.filter((hint) => !hint.unlocked);
  const pressure = Math.min(100, sealed.length * 20 + round.unlocks * 15);
  $('round-tag').textContent = `ROUND ${String(round.id).padStart(2, '0')}`;
  $('round-status').textContent = `${sealed.length} SEALED HINT${sealed.length === 1 ? '' : 'S'} · ${round.unlocks} UNLOCK${round.unlocks === 1 ? '' : 'S'}`;
  $('vault-title').innerHTML = `The vault is<br /><em>${pressure >= 75 ? 'under pressure.' : 'holding.'}</em>`;
  const snippets = hints.map((hint) => hint.revealUntil>Date.now()&&!hint.revealAt ? `<span class="hint-chip redacted" aria-label="Redacted hint">${escapeHTML(hint.text).replace(/[A-Za-z0-9]+/g,'████')}</span>` : hint.revealAt ? `<span class="hint-chip">${escapeHTML(hint.text)}</span>` : hint.unlocked ? `<span class="hint-chip">${escapeHTML(hint.text)}</span>` : `<span class="hint-chip redacted" aria-label="Sealed hint">████ ██████</span>`);
  $('hints').innerHTML = snippets.join('');
  const vow = [...(state.vows || [])].reverse().find((item) => item.status === 'active' && item.roundId === round.id);
  $('vow').classList.toggle('hidden', !vow);
  if (vow) $('vow').innerHTML = `♧ &nbsp;${escapeHTML(vow.text)} <b>${countdown(vow.deadline)}</b>`;
  $('pressure-bar').style.width = `${Math.max(2, pressure)}%`;
  $('pressure-name').textContent = pressure >= 75 ? 'STRAINING' : pressure >= 40 ? 'RISING' : pressure ? 'BUILDING' : 'CALM';
  document.querySelector('.vault').classList.toggle('pressure-2', pressure >= 40 && pressure < 75);
  document.querySelector('.vault').classList.toggle('pressure-3', pressure >= 75);
  $('hint-total').textContent = `${sealed.length} hint${sealed.length === 1 ? '' : 's'}`;
  $('unlock-total').textContent = `${round.unlocks} unlock${round.unlocks === 1 ? '' : 's'}`;
  $('spoiler-count').textContent=`${(state.spoilers||[]).length} spoilers caught`;
  const jailed=(state.spoilers||[]).slice(-3);const jail=$('spoiler-jail');jail.classList.toggle('hidden',!jailed.length);jail.innerHTML=jailed.map(item=>`<div class="spoiler-bar"><span>⚑ SPOILER CAUGHT${state.nameSpoilers?` · ${escapeHTML(item.name)}`:''}</span><i></i></div>`).join('');
  const bets = state.bets || [];
  const totals = { solo: 0, caves: 0 };
  bets.forEach((bet) => totals[bet.side] += bet.stake);
  $('bettors').textContent = bets.length;
  $('bet-call').textContent = `${totals.solo >= totals.caves ? '!solo' : '!caves'} is leading`;
}
function escapeHTML(value) { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
if ('BroadcastChannel' in window) { const channel = new BroadcastChannel('crowdquest-demo'); channel.addEventListener('message', (event) => { if (event.data) { state = event.data; render(); } }); }
const liveEvents=new EventSource('/api/events');
liveEvents.addEventListener('message',(event)=>{try{const incoming=JSON.parse(event.data);if(incoming){state=incoming;render();}}catch{}});
window.addEventListener('storage', (event) => { if (event.key === KEY && event.newValue) { try { state = JSON.parse(event.newValue); render(); } catch {} } });
setInterval(render, 1000);
render();
