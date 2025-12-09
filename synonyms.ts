// Même type Item que dans index.tsx
export interface Item {
  id: string;
  name: string;
  location: string;
  date: string;
  photos?: string[];
}

// Dictionnaire de synonymes pour recherche intelligente
const synonyms: { [key: string]: string[] } = {
  // Objets du quotidien
  clés: ['clef', 'clefs', 'clé', 'trousseau', 'trousseau de clés', 'keys', 'key'],
  clefs: ['clés', 'clef', 'clé', 'trousseau', 'trousseau de clés', 'keys', 'key'],
  trousseau: ['clés', 'clefs', 'clef', 'clé', 'trousseau de clés', 'keys', 'key'],

  téléphone: ['portable', 'mobile', 'smartphone', 'phone', 'iphone', 'android', 'tel'],
  lunettes: ['lunette', 'binocles', 'glasses', 'monture'],
  portefeuille: ['porte-monnaie', 'portemonnaie', 'wallet', 'porte feuille'],
  passeport: ['passport', 'papiers', 'papier identité'],
  carte: ['cartes', 'cb', 'bancaire', 'visa', 'mastercard', 'card'],

  // Emplacements
  tiroir: ['tiroirs', 'drawer', 'commode'],
  armoire: ['placard', 'penderie', 'closet', 'garde-robe'],
  coffre: ['coffret', 'boite', 'boîte', 'box'],
  table: ['bureau', 'desk'],
  cuisine: ['kitchenette', 'kitchen'],
  salon: ['séjour', 'living'],
  chambre: ['bedroom', 'room'],
  cave: ['sous-sol', 'basement', 'cellier'],
};

// Mots à ignorer dans la recherche
const stopWords = ['où', 'sont', 'est', 'mes', 'mon', 'ma', 'le', 'la', 'les', 'des', 'un', 'une', 'de', 'du', 'dans', 'sur'];

// Fonction de recherche intelligente avec synonymes
export function searchWithSynonyms(searchTerm: string, items: Item[]): Item[] {
  const lowerSearch = searchTerm.toLowerCase().trim();
  
  if (!lowerSearch) {
    return items;
  }

  // ÉTAPE 1 : Recherche EXACTE dans le NAME (priorité absolue)
  const exactNameMatches = items.filter(item => {
    const name = item.name.toLowerCase();
    return name.includes(lowerSearch);
  });

  if (exactNameMatches.length > 0) {
    return exactNameMatches;
  }

  // ÉTAPE 2 : Recherche EXACTE dans le LOCATION
  const exactLocationMatches = items.filter(item => {
    const location = item.location.toLowerCase();
    return location.includes(lowerSearch);
  });

  if (exactLocationMatches.length > 0) {
    return exactLocationMatches;
  }

  // ÉTAPE 3 : Recherche par MOTS-CLÉS avec synonymes (fallback)
  const searchWords = lowerSearch
    .split(' ')
    .map(w => w.trim())
    .filter(w => w.length > 2 && !stopWords.includes(w));
  
  if (searchWords.length === 0) {
    return items;
  }
  
  const allSearchTerms: string[] = [];
  
  searchWords.forEach(word => {
    allSearchTerms.push(word);
    
    for (const [key, values] of Object.entries(synonyms)) {
      if (key === word || values.includes(word)) {
        allSearchTerms.push(key, ...values);
        break;
      }
    }
  });
  
  const uniqueTerms = [...new Set(allSearchTerms)];
  
  return items.filter(item => {
    const name = item.name.toLowerCase();
    const location = item.location.toLowerCase();
    const fullText = `${name} ${location}`;
    
    return uniqueTerms.some(term => fullText.includes(term));
  });
}
