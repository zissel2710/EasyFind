import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

export default function EasyFindScreen() {
  const [searchText, setSearchText] = useState('');

  return (
    <View style={styles.container}>
      <Text style={styles.title}>EasyFind</Text>
      <Text style={styles.subtitle}>Enregistre où tu ranges. Retrouve en 1 seconde.</Text>
      
      <TextInput
        style={styles.input}
        placeholder="Dis-moi ce que tu cherches ou ranges..."
        placeholderTextColor="#999"
        value={searchText}
        onChangeText={setSearchText}
      />
      
      <TouchableOpacity style={styles.micButton}>
        <Ionicons name="mic" size={40} color="white" />
      </TouchableOpacity>
      
      <Text style={styles.hint}>Tape ou appuie sur le micro</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 40,
    textAlign: 'center',
  },
  input: {
    width: '100%',
    height: 50,
    borderWidth: 2,
    borderColor: '#ddd',
    borderRadius: 25,
    paddingHorizontal: 20,
    fontSize: 16,
    marginBottom: 20,
  },
  micButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#007AFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  hint: {
    fontSize: 14,
    color: '#999',
  },
});
