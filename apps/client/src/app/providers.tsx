import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ThemeRoot } from '@/theme/theme-root';

/** Everything a screen needs around it: the query cache and the theme. */
export function Providers({
  queryClient,
  children,
}: {
  queryClient: QueryClient;
  children: ReactNode;
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeRoot>{children}</ThemeRoot>
    </QueryClientProvider>
  );
}
