import { escapeHtml, t } from '../i18n';
import { titleOf } from '../data/coopAchievements';

/** A co-op title chip (trading lane, src/data/coopAchievements.ts); '' for none. Styled by src/ui/tradeMenu.ts. */
export function titleChip(id: string): string {
  const ti = titleOf(id);
  if (!ti) return '';
  return `<span class="tr-title ${ti.id === 'co_mythic' ? 'mythic' : ''}" style="--tc:${ti.color}" translate="no">${escapeHtml(t(`trading.title.${ti.id}` as Parameters<typeof t>[0]))}</span>`;
}
