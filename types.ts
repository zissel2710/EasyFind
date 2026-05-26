export interface Item {
  id: string;
  name: string;
  location: string;
  date: string;
  photos?: string[];
  category?: string;
  type?: 'object' | 'info' | 'link';
}

export const CATEGORIES = ['Tout', 'Général', 'Maison', 'Travail', 'Cave', 'Voiture', 'Outils', 'Liens'] as const;
export type Category = typeof CATEGORIES[number];
export const DEFAULT_CATEGORY: Category = 'Général';
