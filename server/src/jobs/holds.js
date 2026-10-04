import { registerJob } from './index.js';
import { expireHolds } from '../modules/reservations/reservations.service.js';
import { logger } from '../utils/logger.js';

/** يحرّر الحجوزات المعلّقة المنتهية مهلتها فتعود وحداتها للبيع */
registerJob({
  name: 'expire-holds',
  everyMs: 60_000,
  run: async () => {
    const expired = await expireHolds();
    if (expired > 0) logger.info(`اتحرّر ${expired} حجز معلّق منتهي المهلة`);
  },
});
