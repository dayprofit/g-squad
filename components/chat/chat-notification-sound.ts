export async function playChatNotificationSound() {
  const context = new AudioContext();
  await context.resume();
  const now = context.currentTime;
  for (const [index, frequency] of [740, 880, 740].entries()) {
    const start = now + index * 0.2;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.001, start);
    gain.gain.exponentialRampToValueAtTime(0.65, start + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.16);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.17);
  }
  window.setTimeout(() => void context.close(), 900);
}
