/** uxpass lane: menu fit and scroll-cue copy (src/ui/menuFit.ts); menuhud lane: shop life, game-over timeline hint (src/ui/menuHud.ts). */
export const uxpassEn = {
  'uxpass.more': 'MORE',
  'menuhud.life': 'LIFE',
  'menuhud.details': 'POINT OR FOCUS FOR DETAILS',
} as const;

export const uxpassAr: Record<keyof typeof uxpassEn, string> = {
  'uxpass.more': 'المزيد',
  'menuhud.life': 'الحياة',
  'menuhud.details': 'مرّر المؤشر أو حدّده لعرض التفاصيل',
};
