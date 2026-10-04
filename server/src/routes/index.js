import { Router } from 'express';
import authRoutes from '../modules/auth/auth.routes.js';
import userRoutes from '../modules/users/users.routes.js';
import propertyRoutes from '../modules/properties/properties.routes.js';
import publicRoutes from '../modules/public/public.routes.js';
import { publicIcalRouter } from '../modules/ical/ical.routes.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/properties', propertyRoutes);

// مسارات عامة بلا مصادقة (ضيوف الإنترنت ومنصّات الحجز)
router.use('/public', publicRoutes);
router.use('/ical', publicIcalRouter);

export default router;
