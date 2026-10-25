import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jetBrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "OptiFlow",
  description: "Control de producción para planta industrial",
};

export const viewport: Viewport = {
  themeColor: "#121416",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${inter.variable} ${jetBrainsMono.variable}`}>
      <body className="min-h-screen bg-industrial font-sans text-white antialiased">
        {children}
      </body>
    </html>
  );
}
