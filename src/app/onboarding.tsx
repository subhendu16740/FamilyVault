import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

const { width } = Dimensions.get('window');

const slides = [
  {
    emoji: '🏛️',
    title: 'Welcome to FamilyVault',
    subtitle: 'Every document your family needs, in one place.',
  },
  {
    emoji: '📁',
    title: 'One Vault. Every Document.',
    subtitle: 'Passports, insurance, tax records, medical documents — all in one secure place.',
  },
  {
    emoji: '🔍',
    title: 'Just Ask. We\'ll Find It.',
    subtitle: 'Say \'Show me Dad\'s passport\' and AI finds it instantly.',
    showSearch: true,
  },
];

export default function OnboardingScreen() {
  const [currentSlide, setCurrentSlide] = useState(0);

  const handleNext = () => {
    if (currentSlide < slides.length - 1) {
      setCurrentSlide(currentSlide + 1);
    } else {
      router.replace('/login');
    }
  };

  const slide = slides[currentSlide];

  return (
    <LinearGradient
      colors={['#2A3D66', '#4A6491']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.container}
    >
      <SafeAreaView style={styles.safeArea}>
        {/* Content */}
        <View style={styles.content}>
          <Text style={styles.emoji}>{slide.emoji}</Text>
          <Text style={styles.title}>{slide.title}</Text>
          <Text style={styles.subtitle}>{slide.subtitle}</Text>

          {slide.showSearch && (
            <View style={styles.searchPreview}>
              <Text style={styles.searchText}>Show me Dad's passport</Text>
            </View>
          )}
        </View>

        {/* Bottom */}
        <View style={styles.bottom}>
          {/* Dots */}
          <View style={styles.dots}>
            {slides.map((_, index) => (
              <View
                key={index}
                style={[
                  styles.dot,
                  index === currentSlide ? styles.dotActive : styles.dotInactive,
                ]}
              />
            ))}
          </View>

          {/* Button */}
          <TouchableOpacity onPress={handleNext} style={styles.button} activeOpacity={0.8}>
            <Text style={styles.buttonText}>
              {currentSlide < slides.length - 1 ? 'Next' : 'Get Started'}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 32,
    maxWidth: 390,
    alignSelf: 'center',
    width: '100%',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: {
    fontSize: 80,
    marginBottom: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 16,
  },
  subtitle: {
    fontSize: 17,
    color: 'rgba(255,255,255,0.9)',
    textAlign: 'center',
    lineHeight: 26,
    maxWidth: 300,
  },
  searchPreview: {
    marginTop: 32,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    width: '100%',
    maxWidth: 300,
  },
  searchText: {
    color: '#FFFFFF',
    fontSize: 14,
  },
  bottom: {
    alignItems: 'center',
    marginBottom: 48,
  },
  dots: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 32,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
  dotActive: {
    width: 32,
    backgroundColor: '#FFFFFF',
  },
  dotInactive: {
    width: 8,
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  button: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 999,
    paddingHorizontal: 48,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    minWidth: 200,
    alignItems: 'center',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
});
