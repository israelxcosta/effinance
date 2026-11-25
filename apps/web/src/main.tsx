import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { Providers } from '@/app/providers';
import { router } from '@/app/router';
import '@/styles/index.css';

// Inlined env check: only the desktop build carries the backup glue.
if (import.meta.env.VITE_DESKTOP === 'true') void import('@/desktop/runtime').then((m) => m.startDesktopRuntime());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  </StrictMode>,
);
