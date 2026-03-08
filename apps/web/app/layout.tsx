import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { ClerkProvider } from "@clerk/nextjs"

import "@workspace/ui/globals.css"
import { ConvexClientProvider } from "@/components/convex-client-provider"
import { ThemeProvider } from "@/components/theme-provider"
import { cn } from "@workspace/ui/lib/utils"

const fontSans = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
})

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export const metadata: Metadata = {
  applicationName: "Caracara Score",
  title: "Caracara Score",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
  manifest: "/manifest.webmanifest",
}

const clerkAppearance = {
  variables: {
    borderRadius: "0rem",
  },
  elements: {
    card: "rounded-none border border-border shadow-none bg-background",
    cardBox: "rounded-none shadow-none",
    footer: "bg-transparent",
    formButtonPrimary:
      "rounded-none border border-transparent shadow-none bg-primary text-primary-foreground",
    formFieldInput:
      "rounded-none border border-input bg-background shadow-none focus-visible:ring-1 focus-visible:ring-ring",
    formFieldLabel: "text-foreground",
    footerActionLink: "rounded-none",
    socialButtonsBlockButton:
      "rounded-none border border-input bg-background text-foreground shadow-none",
    navbarButton: "rounded-none",
    userButtonPopoverCard: "rounded-none border border-border shadow-none",
    userButtonPopoverActionButton: "rounded-none",
    userButtonPopoverFooter: "hidden",
  },
} as const

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "antialiased",
        fontMono.variable,
        "font-sans",
        fontSans.variable
      )}
    >
      <body>
        <ClerkProvider appearance={clerkAppearance}>
          <ConvexClientProvider>
            <ThemeProvider>{children}</ThemeProvider>
          </ConvexClientProvider>
        </ClerkProvider>
      </body>
    </html>
  )
}
