import { registerJob } from './index.js';
import { syncAllFeeds } from '../modules/ical/ical.service.js';

/** كل 5 دقائق نفحص التقاويم التي مرّ عليها أكثر من 14 دقيقة (مزامنة كل ~15 دقيقة) */
registerJob({
  name: 'ical-sync',
  everyMs: 5 * 60_000,
  run: () => syncAllFeeds(),
});
