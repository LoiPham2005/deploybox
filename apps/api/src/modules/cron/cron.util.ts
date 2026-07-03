/**
 * Parser & matcher cho cron 5 trường: "phút giờ ngày-tháng tháng thứ".
 * Hỗ trợ toán tử: dấu sao, bước (sao chia n), khoảng a-b, danh sách a,b, số cụ thể.
 * Thứ (dow): 0 = Chủ nhật … 6 = Thứ bảy.
 * Không phụ thuộc thư viện ngoài — đủ cho lịch chạy định kỳ thông thường.
 */

export interface CronSpec {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
}

function parseField(field: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of field.split(',')) {
    if (!part) throw new Error('trường rỗng');
    let step = 1;
    let range = part;
    const slash = part.split('/');
    if (slash.length === 2) {
      range = slash[0];
      step = Number(slash[1]);
      if (!Number.isInteger(step) || step <= 0) throw new Error('bước không hợp lệ');
    } else if (slash.length > 2) {
      throw new Error('nhiều dấu /');
    }
    let lo = min;
    let hi = max;
    if (range === '*') {
      // toàn khoảng
    } else if (range.includes('-')) {
      const [a, b] = range.split('-').map(Number);
      if (!Number.isInteger(a) || !Number.isInteger(b)) throw new Error('khoảng không hợp lệ');
      lo = a;
      hi = b;
    } else {
      const n = Number(range);
      if (!Number.isInteger(n)) throw new Error('số không hợp lệ');
      lo = hi = n;
    }
    if (lo < min || hi > max || lo > hi) throw new Error('ngoài giới hạn');
    for (let i = lo; i <= hi; i += step) out.add(i);
  }
  if (out.size === 0) throw new Error('không match giá trị nào');
  return out;
}

export function parseCron(expr: string): CronSpec {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) {
    throw new Error('Cron phải có đúng 5 trường: phút giờ ngày tháng thứ');
  }
  return {
    minute: parseField(f[0], 0, 59),
    hour: parseField(f[1], 0, 23),
    dom: parseField(f[2], 1, 31),
    month: parseField(f[3], 1, 12),
    dow: parseField(f[4], 0, 6),
  };
}

export function isValidCron(expr: string): boolean {
  try {
    parseCron(expr);
    return true;
  } catch {
    return false;
  }
}

/** Cron có khớp thời điểm `d` (giờ server) không? */
export function cronMatches(spec: CronSpec, d: Date): boolean {
  if (!spec.minute.has(d.getMinutes())) return false;
  if (!spec.hour.has(d.getHours())) return false;
  if (!spec.month.has(d.getMonth() + 1)) return false;

  // Quy tắc cron chuẩn: nếu CẢ ngày-tháng và thứ đều bị giới hạn → khớp khi
  // MỘT trong hai đúng (OR). Nếu chỉ 1 bị giới hạn → theo cái đó. Không cái nào → luôn đúng.
  const domRestricted = spec.dom.size < 31;
  const dowRestricted = spec.dow.size < 7;
  const domOk = spec.dom.has(d.getDate());
  const dowOk = spec.dow.has(d.getDay());
  const dayOk =
    domRestricted && dowRestricted
      ? domOk || dowOk
      : domRestricted
        ? domOk
        : dowRestricted
          ? dowOk
          : true;
  return dayOk;
}
