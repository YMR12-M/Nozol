import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ثلاثة أصوات (انظر docs/BRAND.md): القاهرة للدفتر، وكوفام للافتة، وهاندجت للوحة الأرقام. كلها متغيّرة الوزن.
import '@fontsource-variable/cairo/index.css';
import '@fontsource-variable/kufam/index.css';
import '@fontsource-variable/handjet/index.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/layout.css';
import './styles/pages.css';
import './styles/print.css';

import App from './App.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { ConfirmProvider } from './components/ui/Overlays.jsx';
import { ApiRequestError } from './lib/api.js';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      // لا نعيد المحاولة على أخطاء منطقية (401/403/404/422)؛ فقط الشبكة والـ 5xx
      retry: (count, error) => count < 2 && (!(error instanceof ApiRequestError) || error.offline || error.status >= 500),
    },
  },
});

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <ConfirmProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </ConfirmProvider>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
