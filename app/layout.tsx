export const metadata = { title: "iHelp Ops", description: "Humans and agents, one board" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
