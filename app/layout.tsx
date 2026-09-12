import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Umoja Welfare — Mutual Aid",
  description: "Member-owned mutual aid welfare: contributions, claims, ballots and events.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <header className="border-b bg-white">
          <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
            <Link href="/" className="text-lg font-bold text-emerald-800">
              Umoja Welfare
            </Link>
            <div className="flex gap-4 text-sm">
              <Link href="/member" className="text-gray-600 hover:text-emerald-700">
                Member portal
              </Link>
              <Link href="/admin" className="text-gray-600 hover:text-emerald-700">
                Admin console
              </Link>
              <Link
                href="/login"
                className="rounded bg-emerald-700 px-3 py-1.5 text-white hover:bg-emerald-800"
              >
                Sign in
              </Link>
            </div>
          </nav>
        </header>
        <main className="min-h-screen bg-gray-50">{children}</main>
        <footer className="border-t bg-white py-6 text-center text-xs text-gray-500">
          Umoja Welfare Association — mutual aid, owned by its members.
        </footer>
      </body>
    </html>
  );
}
