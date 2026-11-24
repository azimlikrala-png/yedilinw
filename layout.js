import "./globals.css";

export const metadata = {
  title: "Yedili Network | Minecraft Sunucusu",
  description: "Yedili Network Minecraft sunucusu",
  icons: { icon: "/logo.jpg" },
};

export const viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
