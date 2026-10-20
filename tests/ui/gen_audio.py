# Тестовые звуки для проверок: громкий и тихий синус по 35 секунд (создаются при запуске, в git не хранятся)
import wave, math, struct
for name, amp in (('loud.wav', 0.9), ('quiet.wav', 0.05)):
    with wave.open(name, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(8000)
        w.writeframes(b''.join(struct.pack('<h', int(amp * 32767 * math.sin(2 * math.pi * 440 * i / 8000))) for i in range(8000 * 35)))
