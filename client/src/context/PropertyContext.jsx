/**
 * المنشأة المختارة حاليًّا (مالك يدير عدّة منشآت يبدّل بينها من الشريط العلوي).
 * كل استعلام يُقيَّد بها عبر `usePropertyApi()`، ومفاتيح الكاش تحمل رقمها،
 * فلا يظهر حجز منشأة في شاشة منشأة أخرى بعد التبديل.
 */
import { createContext, useCallback, useContext, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from './AuthContext.jsx';
import { propertyApi } from '../lib/api.js';
import { useLocalStorage } from '../lib/hooks.js';

const PropertyContext = createContext(null);

export function PropertyProvider({ children }) {
  const { user } = useAuth();
  const properties = user?.properties ?? [];
  const [storedId, setStoredId] = useLocalStorage('nozol.property', null);

  // المخزَّن ما زال مسموحًا؟ وإلا الأولى
  const currentId = properties.some((property) => property.id === storedId) ? storedId : (properties[0]?.id ?? null);

  const api = useMemo(() => (currentId ? propertyApi(currentId) : null), [currentId]);

  /** إعدادات المنشأة الكاملة (ضرائب، مواعيد، سياسات) */
  const details = useQuery({
    queryKey: ['property', currentId],
    queryFn: () => api.get(''),
    enabled: Boolean(currentId),
    staleTime: 60_000,
  });

  const select = useCallback((id) => setStoredId(id), [setStoredId]);

  const value = useMemo(() => ({
    properties,
    propertyId: currentId,
    property: details.data ?? properties.find((property) => property.id === currentId) ?? null,
    propertyLoading: details.isLoading,
    api,
    select,
    refreshProperty: details.refetch,
  }), [properties, currentId, details.data, details.isLoading, details.refetch, api, select]);

  return <PropertyContext.Provider value={value}>{children}</PropertyContext.Provider>;
}

export const useProperty = () => {
  const context = useContext(PropertyContext);
  if (!context) throw new Error('useProperty خارج PropertyProvider');
  return context;
};

/** اختصار: واجهة المنشأة الحالية */
export const usePropertyApi = () => useProperty().api;
