import { Suspense, type ReactNode } from 'react';
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { ThemeProvider, useTheme } from '@/lib/theme';
import { ApiRequestError } from '@/lib/api';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthProvider } from '@/features/auth/auth-context';
import { FullPageLoader } from '@/components/layout/app-shell';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (count, error) => {
        if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500) return false;
        return count < 2;
      },
    },
  },
  mutationCache: new MutationCache(),
});

function ThemedToaster() {
  const { resolved } = useTheme();
  return (
    <Toaster
      theme={resolved}
      position="top-right"
      richColors
      closeButton
      toastOptions={{ className: 'font-sans', style: { borderRadius: 14 } }}
    />
  );
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={300}>
          <AuthProvider>
            <Suspense fallback={<FullPageLoader />}>{children}</Suspense>
          </AuthProvider>
          <ThemedToaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
