import type { Metadata } from "next"

import { HomeScreen } from "@/components/home-screen"

const description =
  "Caracara Score helps teams build a dark factory for app quality with scenario-based agent runs, structured scoring, and improvement feedback against deployed dev instances."

export const metadata: Metadata = {
  title: "Caracara Score | Scenario-based evaluation for local apps",
  description,
  keywords: [
    "scenario-based evaluation",
    "local application testing",
    "AI app evaluation",
    "CLI scoring",
    "developer tools",
  ],
  openGraph: {
    title: "Caracara Score",
    description,
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Caracara Score",
    description,
  },
}

export default function Page() {
  return (
    <>
      <script
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: "Caracara Score",
            applicationCategory: "DeveloperApplication",
            operatingSystem: "macOS, Linux, Windows",
            description,
            featureList: [
              "Scenario authoring",
              "Local CLI execution",
              "Structured scoring",
              "Run history review",
            ],
          }),
        }}
        type="application/ld+json"
      />
      <HomeScreen />
    </>
  )
}
