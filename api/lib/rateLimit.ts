// 요청 속도 제한. Cloudflare Rate Limiting 바인딩을 쓰고, 없으면(로컬 등) 메모리로 대신 센다.
// 바인딩은 지역(데이터센터)마다 따로 세는 근사값이라 "대충 막기"용이다.

const memory = new Map<string, { n: number; reset: number }>();

export async function allow(binding: RateLimit | undefined, key: string, fallbackLimit: number, periodSec = 60): Promise<boolean> {
  if (binding) {
    try {
      const { success } = await binding.limit({ key });
      return success;
    } catch {
      // 바인딩이 실패하면 막지 않고 아래 메모리 방식으로 센다
    }
  }
  const now = Date.now();
  const slot = memory.get(key);
  if (!slot || slot.reset < now) {
    memory.set(key, { n: 1, reset: now + periodSec * 1000 });
    if (memory.size > 5000) for (const [k, v] of memory) if (v.reset < now) memory.delete(k);
    return true;
  }
  slot.n += 1;
  return slot.n <= fallbackLimit;
}
