import { SignIn } from "@clerk/nextjs"

export default function SignInPage() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-4 sm:p-6">
      <SignIn forceRedirectUrl="/projects" />
    </main>
  )
}
