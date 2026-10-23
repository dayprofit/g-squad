let context: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!context || context.state === 'closed') context = new AudioContext();
  return context;
}

export function unlockChatNotificationSound() {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return;
  const audio = getAudioContext();
  void audio.resume().catch((error: unknown) => {
    console.warn('Chat notification sound could not be enabled:', error instanceof Error ? error.message : 'Unsupported browser audio');
  });
}

export async function playChatNotificationSound() {
  const audio = getAudioContext();
  await audio.resume();
  const now = audio.currentTime;
  for (const [index, frequency] of [740, 880, 740].entries()) {
    const start = now + index * 0.2;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.001, start);
    gain.gain.exponentialRampToValueAtTime(0.65, start + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.16);
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.17);
  }
}
