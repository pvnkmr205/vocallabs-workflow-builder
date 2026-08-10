'use client';

import { NhostClient, NhostProvider } from '@nhost/nextjs';
import { NhostApolloProvider } from '@nhost/react-apollo';
import './globals.css';

// This points your frontend to your local Nhost backend
const nhost = new NhostClient({
  subdomain: 'local',
  region: 'local',
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <NhostProvider nhost={nhost}>
          <NhostApolloProvider nhost={nhost}>
            {children}
          </NhostApolloProvider>
        </NhostProvider>
      </body>
    </html>
  );
}