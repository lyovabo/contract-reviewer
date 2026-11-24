import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Header } from "@/components/Header";
import { LawyerGate } from "@/components/LawyerGate";
import { Providers } from "@/components/Providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Contract Reviewer",
  description: "AI contract reviews for the firm's shared workspace",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <Providers>
          <Header />
          <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
            <LawyerGate>{children}</LawyerGate>
          </main>
        </Providers>
      </body>
    </html>
  );
}
