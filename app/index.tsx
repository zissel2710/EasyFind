import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef, useState } from 'react';
import { Alert, FlatList, Image, Modal, Platform, ScrollView, Share, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { searchWithSynonyms } from '../synonyms';
import type { Item } from '../types';

function detectIntent(text: string): 'store' | 'search' {
  const t = text.trim().toLowerCase();
  if (!t) return 'search';

  if (t.endsWith('?')) return 'search';
  if (/^(o[uù]\s|qui\s|quel|quoi\s|quand\s|comment\s|c'est\s+o[uù]|cherche\b|trouve\b)/.test(t)) return 'search';
  if (t === 'ou' || t === 'où') return 'search';

  const hasPrep = /\s(dans|sur|sous|derri[èe]re)\s/.test(t);
  if (hasPrep) {
    const storageVerbs = [
      "j'ai rangé", "j'ai mis", "j'ai placé", "j'ai déposé",
      "j'ai stocké", "j'ai caché", "j'ai posé", "j'ai fourré", "j'ai laissé",
    ];
    if (storageVerbs.some(v => t.includes(v))) return 'store';
    if (/\s(est|sont|se\s+trouve|se\s+trouvent)\s/.test(t)) return 'store';
  }

  return 'search';
}

function isPluralName(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (/^(les|des|mes|tes|ses|nos|vos|leurs)\s/.test(n)) return true;
  const firstWord = n.split(/\s+/)[0] || '';
  return /[sx]$/.test(firstWord) && firstWord.length > 2;
}

export default function EasyFindScreen() {
  const [input, setInput] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [menuVisible, setMenuVisible] = useState<string | null>(null);
  const [photoViewVisible, setPhotoViewVisible] = useState(false);
  const [selectedPhotos, setSelectedPhotos] = useState<string[]>([]);
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [editName, setEditName] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const isVoiceInputRef = useRef(false);
  const currentInputRef = useRef('');
  const handleSubmitRef = useRef<((t: string) => void) | null>(null);
  const submitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSubmitTimer = () => {
    if (submitTimerRef.current) {
      clearTimeout(submitTimerRef.current);
      submitTimerRef.current = null;
    }
  };

  const speak = (text: string, onComplete?: () => void) => {
    if (Platform.OS !== 'web') return;
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      if (onComplete) onComplete();
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = (typeof navigator !== 'undefined' && navigator.language) || 'fr-FR';
      u.rate = 1.0;
      u.pitch = 1.0;
      if (onComplete) {
        u.onend = () => onComplete();
        u.onerror = () => onComplete();
      }
      window.speechSynthesis.speak(u);
    } catch {
      if (onComplete) onComplete();
    }
  };

  const playSuccessSound = () => {
    if (Platform.OS !== 'web') return;
    if (typeof window === 'undefined') return;
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    try {
      const ctx = new AC();
      // Double ding chaleureux : C5 → E5 (tierce majeure), sine, faible volume, attack doux.
      const notes = [
        { freq: 523.25, delay: 0.00, dur: 0.34, gain: 0.05 }, // C5
        { freq: 659.25, delay: 0.11, dur: 0.42, gain: 0.04 }, // E5
      ];
      notes.forEach(n => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g);
        g.connect(ctx.destination);
        o.type = 'sine';
        o.frequency.value = n.freq;
        const start = ctx.currentTime + n.delay;
        g.gain.setValueAtTime(0, start);
        g.gain.linearRampToValueAtTime(n.gain, start + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, start + n.dur);
        o.start(start);
        o.stop(start + n.dur + 0.02);
      });
      setTimeout(() => { try { ctx.close(); } catch {} }, 700);
    } catch {}
  };

  useEffect(() => {
    loadItems();
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (typeof document === 'undefined') return;
    let meta = document.querySelector('meta[name="viewport"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'viewport');
      meta.setAttribute('content', 'width=device-width, initial-scale=1');
      document.head.appendChild(meta);
    }
    const current = meta.getAttribute('content') || '';
    if (!current.includes('interactive-widget')) {
      meta.setAttribute('content', current + ', interactive-widget=resizes-content');
    }
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    window.speechSynthesis.getVoices();
    const handler = () => window.speechSynthesis.getVoices();
    (window.speechSynthesis as any).addEventListener?.('voiceschanged', handler);
    return () => {
      (window.speechSynthesis as any).removeEventListener?.('voiceschanged', handler);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (submitTimerRef.current) clearTimeout(submitTimerRef.current);
    };
  }, []);

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 2200);
  };

  const handleExport = async () => {
    if (items.length === 0) {
      showToast('Rien à exporter');
      return;
    }
    const payload = JSON.stringify({ exportedAt: new Date().toISOString(), items }, null, 2);
    const filename = `easyfind-${new Date().toISOString().slice(0, 10)}.json`;

    if (Platform.OS === 'web') {
      if (typeof document === 'undefined') return;
      const blob = new Blob([payload], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('✅ Exporté');
      return;
    }

    try {
      await Share.share({ message: payload, title: filename });
    } catch (e) {
      console.error('Export error:', e);
    }
  };

  const loadItems = async () => {
    try {
      const stored = await AsyncStorage.getItem('easyfind_items');
      if (stored) {
        setItems(JSON.parse(stored));
      }
    } catch (error) {
      console.error('Erreur chargement:', error);
    }
  };

  const saveItems = async (newItems: Item[]) => {
    try {
      await AsyncStorage.setItem('easyfind_items', JSON.stringify(newItems));
      setItems(newItems);
    } catch (error) {
      console.error('Erreur sauvegarde:', error);
    }
  };

  const pickImageWeb = (itemId: string) => {
    if (typeof document === 'undefined') return;
    
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    document.body.appendChild(input);
    
    input.onchange = (e: any) => {
      const file = e.target?.files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const photoUri = event.target?.result as string;
          
          const updatedItems = items.map(item => {
            if (item.id === itemId) {
              return {
                ...item,
                photos: [...(item.photos || []), photoUri]
              };
            }
            return item;
          });
          saveItems(updatedItems);
          document.body.removeChild(input);
        };
        reader.readAsDataURL(file);
      } else {
        document.body.removeChild(input);
      }
    };
    
    input.click();
  };

  const startCamera = () => {
    Alert.alert('📷 Photo', 'Sur web, utilise le menu ⋮ d\'un objet pour ajouter une photo !\n\nSur téléphone : installe Expo Go pour utiliser la caméra.');
  };

  const stopRecording = () => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
    }
    setIsRecording(false);
  };

  const startRecording = async () => {
    if (Platform.OS !== 'web') {
      showToast('🎤 Disponible bientôt sur mobile natif');
      return;
    }

    if (isRecording) {
      stopRecording();
      return;
    }

    clearSubmitTimer();

    const SpeechRecognition =
      typeof window !== 'undefined'
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : null;

    if (!SpeechRecognition) {
      showToast('Navigateur non supporté (essaie Chrome ou Safari)');
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.lang =
        (typeof navigator !== 'undefined' && navigator.language) || 'fr-FR';
      recognition.interimResults = true;
      recognition.continuous = false;
      recognition.maxAlternatives = 1;

      recognition.onresult = (event: any) => {
        let transcript = '';
        for (let i = 0; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        isVoiceInputRef.current = true;
        currentInputRef.current = transcript;
        setInput(transcript);

        // Reset debounced auto-submit: 1200 ms après le dernier résultat reçu.
        // Si l'utilisateur reparle, onresult re-fire et le timer redémarre.
        clearSubmitTimer();
        submitTimerRef.current = setTimeout(() => {
          submitTimerRef.current = null;
          const txt = currentInputRef.current;
          if (txt && txt.trim() && handleSubmitRef.current) {
            handleSubmitRef.current(txt);
          }
        }, 1200);
      };

      recognition.onerror = (event: any) => {
        console.error('SpeechRecognition error:', event.error);
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          showToast('🎤 Permission micro refusée');
        } else if (event.error === 'no-speech') {
          showToast('🎤 Aucune parole détectée');
        } else if (event.error !== 'aborted') {
          showToast('🎤 Erreur reconnaissance vocale');
        }
        recognitionRef.current = null;
        setIsRecording(false);
        clearSubmitTimer();
      };

      recognition.onend = () => {
        recognitionRef.current = null;
        setIsRecording(false);
        // Pas d'auto-submit ici : le timer programmé par le dernier onresult
        // continue à tourner et déclenche le submit ~1200 ms après le dernier mot.
      };

      recognitionRef.current = recognition;
      setIsRecording(true);
      recognition.start();
    } catch (e) {
      console.error('startRecording failed:', e);
      showToast('🎤 Impossible de démarrer le micro');
      recognitionRef.current = null;
      setIsRecording(false);
    }
  };

  const cleanObjectName = (s: string) =>
    s
      .replace(/j'ai\s+(rang[ée]|mis|plac[ée]|d[ée]pos[ée]|stock[ée]|cach[ée]|pos[ée]|fourr[ée]|laiss[ée])/i, '')
      .replace(/^mes\s+/i, '')
      .replace(/^mon\s+/i, '')
      .replace(/^ma\s+/i, '')
      .trim();

  const handleSubmitWithText = (text: string) => {
    const trimmedText = text.trim();
    if (!trimmedText) return;

    // Submit manuel ou auto : on annule toujours le timer d'auto-submit pendant.
    clearSubmitTimer();

    const fromVoice = isVoiceInputRef.current;
    isVoiceInputRef.current = false;

    const lowerText = trimmedText.toLowerCase();
    const intent = detectIntent(trimmedText);

    if (intent === 'store') {
      let name = '';
      let location = '';

      const firstDansIndex = lowerText.indexOf(' dans ');
      if (firstDansIndex !== -1) {
        const before = trimmedText.substring(0, firstDansIndex).trim();
        const after = trimmedText.substring(firstDansIndex + 6).trim();
        const cleaned = cleanObjectName(before);
        name = cleaned || before;
        location = after;
      }

      if ((!name || !location) && lowerText.includes(' sur ')) {
        const firstSurIndex = lowerText.indexOf(' sur ');
        const before = trimmedText.substring(0, firstSurIndex).trim();
        const after = trimmedText.substring(firstSurIndex + 5).trim();
        const cleaned = cleanObjectName(before);
        if (!name) name = cleaned || before;
        if (!location) location = after;
      }

      if (!name || !location) {
        showToast('Reformule, ex : « J\'ai rangé les clés dans le tiroir »');
        return;
      }

      const newItem: Item = {
        id: Date.now().toString(),
        name,
        location,
        date: new Date().toLocaleDateString('fr-FR'),
        photos: [],
      };

      const updatedItems = [newItem, ...items];
      saveItems(updatedItems);
      setInput('');
      currentInputRef.current = '';
      playSuccessSound();
      showToast('✓ Enregistré');
      return;
    }

    // intent === 'search' — UI déjà mise à jour via filteredItems live.
    // Réponse vocale uniquement si la demande vient de la voix.
    if (fromVoice) {
      const results = searchWithSynonyms(trimmedText, items);
      const submitted = trimmedText;
      const clearIfStillSubmitted = () => {
        // Ne pas effacer si l'utilisateur a déjà retapé/reparlé entretemps.
        if (currentInputRef.current === submitted) {
          currentInputRef.current = '';
          setInput('');
        }
      };
      if (results.length > 0) {
        const r = results[0];
        const verb = isPluralName(r.name) ? 'sont' : 'est';
        speak(`${r.name} ${verb} dans ${r.location}.`, clearIfStillSubmitted);
      } else {
        speak("Désolé, je n'ai rien trouvé.", clearIfStillSubmitted);
      }
    }
  };

  handleSubmitRef.current = handleSubmitWithText;

  const handleSubmit = () => {
    handleSubmitWithText(input);
  };

  const handleEditItem = (item: Item) => {
    setMenuVisible(null);
    setDrawerVisible(false);
    setEditingItem(item);
    setEditName(item.name);
    setEditLocation(item.location);
    setEditModalVisible(true);
  };

  const saveEdit = () => {
    if (!editingItem || !editName.trim() || !editLocation.trim()) {
      Alert.alert('Erreur', 'Le nom et l\'emplacement ne peuvent pas être vides.');
      return;
    }

    const updatedItems = items.map(item => {
      if (item.id === editingItem.id) {
        return {
          ...item,
          name: editName.trim(),
          location: editLocation.trim(),
        };
      }
      return item;
    });

    saveItems(updatedItems);
    setEditModalVisible(false);
    setEditingItem(null);
    showToast('✅ Modifié');
  };

  const handleDeleteItem = (itemId: string) => {
    setMenuVisible(null);
    Alert.alert(
      'Supprimer ?',
      'Es-tu sûr de vouloir supprimer cet objet ?',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: () => {
            const updatedItems = items.filter(i => i.id !== itemId);
            saveItems(updatedItems);
          },
        },
      ]
    );
  };

  const handleAddPhoto = (itemId: string) => {
    setMenuVisible(null);
    pickImageWeb(itemId);
  };

  const viewPhotos = (photos: string[]) => {
    if (photos && photos.length > 0) {
      setSelectedPhotos(photos);
      setCurrentPhotoIndex(0);
      setPhotoViewVisible(true);
    }
  };

  const lowerInput = input.toLowerCase();
  const isSearchMode =
    !!input.trim() &&
    !lowerInput.includes(' dans ') &&
    !lowerInput.includes(' sur ') &&
    !lowerInput.includes('j\'ai rangé') &&
    !lowerInput.includes('j\'ai mis');
  
  const filteredItems = isSearchMode
    ? searchWithSynonyms(input, items)
    : items;

  return (
    <View style={styles.container}>
      {toast && (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}

      {/* Header avec hamburger */}
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.hamburger}
          onPress={() => setDrawerVisible(true)}
        >
          <Ionicons name="menu" size={28} color="#333" />
        </TouchableOpacity>
        <Text style={styles.title}>EasyFind</Text>
        <View style={styles.headerSpacer} />
      </View>

      <Text style={styles.subtitle}>Retrouve ou enregistre en langage naturel</Text>

      <View style={styles.hintBox}>
        <Text style={styles.hintTitle}>Parlez naturellement…</Text>
        <Text style={styles.hintExample}>« J'ai rangé les passeports dans la boîte à documents »</Text>
        <Text style={styles.hintTransition}>3 mois après…</Text>
        <Text style={styles.hintExample}>« Où sont les passeports ? »</Text>
      </View>

      {/* Mode recherche : affiche résultats */}
      {isSearchMode && (
        <View style={styles.searchResults}>
          <Text style={styles.searchResultsTitle}>
            {filteredItems.length} résultat{filteredItems.length > 1 ? 's' : ''}
          </Text>
          <FlatList
            data={filteredItems}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity 
                style={styles.itemCard}
                onPress={() => item.photos && item.photos.length > 0 && viewPhotos(item.photos)}
              >
                {item.photos && item.photos.length > 0 && (
                  <Image 
                    source={{ uri: item.photos[0] }}
                    style={styles.thumbnail}
                  />
                )}
                
                <View style={styles.itemContent}>
                  <Text style={styles.itemName}>{item.name}</Text>
                  <Text style={styles.itemLocation}>📍 {item.location}</Text>
                  <Text style={styles.itemDate}>
                    {item.date}
                    {item.photos && item.photos.length > 0 && ` • ${item.photos.length} photo${item.photos.length > 1 ? 's' : ''}`}
                  </Text>
                </View>
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <Text style={styles.emptyText}>Aucun objet trouvé 😕</Text>
            }
          />
        </View>
      )}

      {/* Barre de saisie */}
      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          placeholder="J'ai rangé..."
          placeholderTextColor="#999"
          value={input}
          onChangeText={(text) => {
            isVoiceInputRef.current = false;
            currentInputRef.current = text;
            clearSubmitTimer();
            setInput(text);
          }}
          onSubmitEditing={handleSubmit}
          returnKeyType="done"
          autoCapitalize="sentences"
        />

        <TouchableOpacity 
          style={styles.iconButton}
          onPress={startCamera}
        >
          <Ionicons name="camera" size={26} color="#007AFF" />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.iconButton, isRecording && styles.iconButtonRecording]}
          onPress={startRecording}
        >
          <Ionicons 
            name={isRecording ? "radio-button-on" : "mic"} 
            size={26} 
            color={isRecording ? "#FF3B30" : "#007AFF"} 
          />
        </TouchableOpacity>
      </View>

      {isRecording && (
        <Text style={styles.recordingText}>🎤 J'écoute...</Text>
      )}

      {/* Drawer latéral (menu hamburger) */}
      <Modal
        visible={drawerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setDrawerVisible(false)}
      >
        <TouchableOpacity 
          style={styles.drawerOverlay}
          activeOpacity={1}
          onPress={() => setDrawerVisible(false)}
        >
          <View style={styles.drawer}>
            <View style={styles.drawerHeader}>
              <Text style={styles.drawerTitle}>Mes objets</Text>
              <TouchableOpacity onPress={() => setDrawerVisible(false)}>
                <Ionicons name="close" size={28} color="#333" />
              </TouchableOpacity>
            </View>

            <Text style={styles.drawerCount}>
              {items.length} objet{items.length > 1 ? 's' : ''} enregistré{items.length > 1 ? 's' : ''}
            </Text>

            <TouchableOpacity style={styles.exportButton} onPress={handleExport}>
              <Ionicons name="download-outline" size={18} color="#007AFF" />
              <Text style={styles.exportButtonText}>Exporter en JSON</Text>
            </TouchableOpacity>

            <FlatList
              data={items}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity 
                  style={styles.drawerItem}
                  onPress={() => {
                    if (item.photos && item.photos.length > 0) {
                      setDrawerVisible(false);
                      viewPhotos(item.photos);
                    }
                  }}
                >
                  {item.photos && item.photos.length > 0 && (
                    <Image 
                      source={{ uri: item.photos[0] }}
                      style={styles.drawerThumbnail}
                    />
                  )}
                  
                  <View style={styles.drawerItemContent}>
                    <Text style={styles.drawerItemName}>{item.name}</Text>
                    <Text style={styles.drawerItemLocation}>📍 {item.location}</Text>
                    <Text style={styles.drawerItemDate}>
                      {item.date}
                      {item.photos && item.photos.length > 0 && ` • ${item.photos.length} photo${item.photos.length > 1 ? 's' : ''}`}
                    </Text>
                  </View>
                  
                  <TouchableOpacity
                    style={styles.drawerMenuButton}
                    onPress={() => setMenuVisible(item.id)}
                  >
                    <Ionicons name="ellipsis-vertical" size={20} color="#999" />
                  </TouchableOpacity>

                  {menuVisible === item.id && (
                    <Modal
                      transparent
                      visible={menuVisible === item.id}
                      onRequestClose={() => setMenuVisible(null)}
                      animationType="fade"
                    >
                      <TouchableOpacity 
                        style={styles.modalOverlay}
                        activeOpacity={1}
                        onPress={() => setMenuVisible(null)}
                      >
                        <View style={styles.menuModal}>
                          <TouchableOpacity
                            style={styles.menuOption}
                            onPress={() => handleAddPhoto(item.id)}
                          >
                            <Ionicons name="camera" size={20} color="#007AFF" />
                            <Text style={styles.menuOptionText}>
                              {item.photos && item.photos.length > 0 ? 'Ajouter une photo' : 'Ajouter photo'}
                            </Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={styles.menuOption}
                            onPress={() => handleEditItem(item)}
                          >
                            <Ionicons name="pencil" size={20} color="#007AFF" />
                            <Text style={styles.menuOptionText}>Modifier</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={[styles.menuOption, styles.menuOptionDanger]}
                            onPress={() => handleDeleteItem(item.id)}
                          >
                            <Ionicons name="trash" size={20} color="#FF3B30" />
                            <Text style={[styles.menuOptionText, styles.menuOptionTextDanger]}>Supprimer</Text>
                          </TouchableOpacity>
                        </View>
                      </TouchableOpacity>
                    </Modal>
                  )}
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <Text style={styles.drawerEmptyText}>
                  Aucun objet enregistré.{'\n\n'}
                  Commence par enregistrer un objet !
                </Text>
              }
            />
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Visionneuse photos plein écran */}
      <Modal
        visible={photoViewVisible}
        transparent={false}
        onRequestClose={() => setPhotoViewVisible(false)}
        animationType="fade"
      >
        <View style={styles.photoViewContainer}>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={() => setPhotoViewVisible(false)}
          >
            <Ionicons name="close" size={30} color="#fff" />
          </TouchableOpacity>

          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onScroll={(e) => {
              const index = Math.round(e.nativeEvent.contentOffset.x / e.nativeEvent.layoutMeasurement.width);
              setCurrentPhotoIndex(index);
            }}
            scrollEventThrottle={16}
          >
            {selectedPhotos.map((photo, index) => (
              <View key={index} style={styles.photoPage}>
                <Image
                  source={{ uri: photo }}
                  style={styles.fullPhoto}
                  resizeMode="contain"
                />
              </View>
            ))}
          </ScrollView>

          {selectedPhotos.length > 1 && (
            <Text style={styles.photoCounter}>
              {currentPhotoIndex + 1} / {selectedPhotos.length}
            </Text>
          )}
        </View>
      </Modal>

      {/* Modal d'édition */}
      <Modal
        visible={editModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setEditModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.editModal}>
            <Text style={styles.editModalTitle}>✏️ Modifier l'objet</Text>
            
            <Text style={styles.editLabel}>Nom de l'objet :</Text>
            <TextInput
              style={styles.editInput}
              value={editName}
              onChangeText={setEditName}
              placeholder="Ex: Clés du coffre"
              autoFocus
            />

            <Text style={styles.editLabel}>Emplacement :</Text>
            <TextInput
              style={styles.editInput}
              value={editLocation}
              onChangeText={setEditLocation}
              placeholder="Ex: Tiroir de la cuisine"
            />

            <View style={styles.editButtons}>
              <TouchableOpacity
                style={[styles.editButton, styles.editButtonCancel]}
                onPress={() => setEditModalVisible(false)}
              >
                <Text style={styles.editButtonTextCancel}>Annuler</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.editButton, styles.editButtonSave]}
                onPress={saveEdit}
              >
                <Text style={styles.editButtonTextSave}>Sauvegarder</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    paddingTop: 50,
    paddingBottom: Platform.OS === 'web' ? 80 : 0,
  },
  toast: {
    position: 'absolute',
    top: 60,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(40, 40, 40, 0.95)',
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 10,
    zIndex: 999,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
  },
  toastText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 5,
  },
  hamburger: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#333',
  },
  headerSpacer: {
    width: 44,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 20,
    paddingHorizontal: 20,
  },
  
  // Barre de saisie - adaptative web/mobile
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    position: (Platform.OS === 'web' ? 'fixed' : 'absolute') as any,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  input: {
    flex: 1,
    height: 48,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 24,
    paddingHorizontal: 18,
    fontSize: 16,
    backgroundColor: '#fff',
    marginRight: 10,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 5,
  },
  iconButtonRecording: {
    backgroundColor: '#ffe6e6',
  },
  recordingText: {
    textAlign: 'center',
    color: '#FF3B30',
    fontSize: 14,
    fontWeight: '600',
    position: (Platform.OS === 'web' ? 'fixed' : 'absolute') as any,
    bottom: Platform.OS === 'web' ? 80 : 70,
    left: 0,
    right: 0,
  },

  hintBox: {
    backgroundColor: '#e3f2fd',
    padding: 12,
    borderRadius: 10,
    marginHorizontal: 20,
    marginBottom: Platform.OS === 'web' ? 15 : 80,
  },
  hintTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 6,
  },
  hintText: {
    fontSize: 13,
    color: '#555',
    marginBottom: 2,
  },
  hintExample: {
    fontSize: 14,
    color: '#1a1a1a',
    fontStyle: 'italic',
    marginBottom: 10,
    paddingLeft: 4,
  },
  hintTransition: {
    fontSize: 13,
    color: '#666',
    marginBottom: 2,
  },

  searchResults: {
    flex: 1,
    paddingHorizontal: 20,
    marginBottom: Platform.OS === 'web' ? 0 : 80,
  },
  searchResultsTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 12,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  thumbnail: {
    width: 60,
    height: 60,
    borderRadius: 8,
    marginRight: 12,
  },
  itemContent: {
    flex: 1,
  },
  itemName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  itemLocation: {
    fontSize: 16,
    color: '#007AFF',
    marginBottom: 3,
  },
  itemDate: {
    fontSize: 11,
    color: '#999',
  },
  emptyText: {
    textAlign: 'center',
    color: '#999',
    fontSize: 16,
    marginTop: 40,
    lineHeight: 24,
  },

  // Drawer (menu hamburger)
  drawerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  drawer: {
    width: '85%',
    maxWidth: 350,
    height: '100%',
    backgroundColor: '#fff',
    paddingTop: 50,
  },
  drawerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  drawerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  drawerCount: {
    fontSize: 14,
    color: '#666',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  exportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 20,
    marginBottom: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#eaf3ff',
    alignSelf: 'flex-start',
  },
  exportButtonText: {
    color: '#007AFF',
    fontSize: 14,
    fontWeight: '600',
  },
  drawerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#f5f5f5',
  },
  drawerThumbnail: {
    width: 50,
    height: 50,
    borderRadius: 8,
    marginRight: 12,
  },
  drawerItemContent: {
    flex: 1,
  },
  drawerItemName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 3,
  },
  drawerItemLocation: {
    fontSize: 14,
    color: '#007AFF',
    marginBottom: 2,
  },
  drawerItemDate: {
    fontSize: 11,
    color: '#999',
  },
  drawerMenuButton: {
    padding: 8,
  },
  drawerEmptyText: {
    textAlign: 'center',
    color: '#999',
    fontSize: 15,
    marginTop: 60,
    paddingHorizontal: 30,
    lineHeight: 22,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuModal: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 8,
    minWidth: 200,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  menuOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 8,
  },
  menuOptionText: {
    fontSize: 16,
    color: '#333',
    marginLeft: 12,
    fontWeight: '500',
  },
  menuOptionDanger: {
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  menuOptionTextDanger: {
    color: '#FF3B30',
  },

  // Visionneuse photos
  photoViewContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  closeButton: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoPage: {
    width: 800,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullPhoto: {
    width: 800,
    height: '100%',
  },
  photoCounter: {
    position: 'absolute',
    bottom: 50,
    alignSelf: 'center',
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },

  // Modal d'édition
  editModal: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    width: '90%',
    maxWidth: 400,
  },
  editModalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#333',
    marginBottom: 20,
    textAlign: 'center',
  },
  editLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginBottom: 8,
    marginTop: 12,
  },
  editInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#f9f9f9',
  },
  editButtons: {
    flexDirection: 'row',
    marginTop: 24,
    gap: 12,
  },
  editButton: {
    flex: 1,
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  editButtonCancel: {
    backgroundColor: '#f0f0f0',
  },
  editButtonSave: {
    backgroundColor: '#007AFF',
  },
  editButtonTextCancel: {
    color: '#666',
    fontSize: 16,
    fontWeight: '600',
  },
  editButtonTextSave: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
