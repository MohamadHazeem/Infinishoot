import { t } from '../i18n';

type Kind = 'arena' | 'pack';
interface WorkshopItem { kind: Kind; id: string; raw: string }
declare global {
  interface Window {
    steamWorkshop?: {
      list(): Promise<WorkshopItem[]>;
      browse(): Promise<void>;
      publish(kind: Kind, title: string, raw: string): Promise<'agreement' | 'published'>;
    };
    steamKeyboard?: (label: string, limit: number, value: string, multi: boolean) => Promise<string | null>;
  }
}

export async function publishWorkshop(kind: Kind, title: string, raw: string): Promise<string> {
  if (!window.steamWorkshop) return t('launch.unavailable');
  try {
    return t((await window.steamWorkshop.publish(kind, title, raw)) === 'agreement' ? 'launch.agreement' : 'launch.published');
  } catch { return t('launch.publishFailed'); }
}
