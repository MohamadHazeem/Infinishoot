import { customRelayText, hasRelay, parseRelay, setCustomRelay } from '../net/ice';

/**
 * PLAY ONLINE > CUSTOM RELAY (fixes lane): an optional TURN server for players
 * whose network blocks direct connections (docs/TURN.md). Saved as you type
 * once it reads as a relay; hidden in the lobby. Injects its own CSS.
 */
const CSS = `
.field.relay-field { display: flex; flex-direction: column; align-items: center; gap: 6px; font: 16px var(--font); color: var(--mist); }
.field.relay-field[hidden] { display: none; }
.field.relay-field input { width: 440px; max-width: 86vw; padding: 6px 10px; font: 18px var(--font); letter-spacing: 0; }
.relay-field .relay-hint { font: 12px var(--label); min-height: 1em; color: var(--white); }
.relay-field .relay-hint.bad { color: var(--yellow); }
.relay-field .relay-hint.good { color: var(--white); }
`;

export function mountRelayField(screen: HTMLElement): void {
  if (screen.querySelector('.relay-field')) return;
  const after = screen.querySelector('.join-row');
  if (!after) return;
  if (!document.getElementById('relay-field-css')) {
    const st = document.createElement('style');
    st.id = 'relay-field-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const box = document.createElement('label');
  box.className = 'field relay-field';
  box.innerHTML = `<span>CUSTOM RELAY (OPTIONAL)</span><input type="text" spellcheck="false" autocomplete="off" placeholder="turn:relay.example.com:3478 user password"><span class="relay-hint"></span>`;
  after.insertAdjacentElement('afterend', box);
  const input = box.querySelector('input')!;
  const hint = box.querySelector<HTMLElement>('.relay-hint')!;
  input.value = customRelayText();
  const check = () => {
    const ok = parseRelay(input.value) !== null;
    if (ok) setCustomRelay(input.value);
    hint.className = `relay-hint ${ok ? (input.value.trim() ? 'good' : '') : 'bad'}`;
    hint.textContent = !ok ? 'Format: turn:host:port username password' : input.value.trim() ? 'Relay saved: used when you host or join' : hasRelay() ? 'This build has a relay' : 'Only needed if friends cannot connect';
  };
  input.addEventListener('input', check);
  check();
}

export function showRelayField(screen: HTMLElement, show: boolean): void {
  const el = screen.querySelector<HTMLElement>('.relay-field');
  if (el) el.hidden = !show;
}
