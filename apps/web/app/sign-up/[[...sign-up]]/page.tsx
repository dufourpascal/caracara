import { SignUp } from "@clerk/nextjs"

export default function SignUpPage() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-4 sm:p-6">
      <SignUp forceRedirectUrl="/projects" />
    </main>
  )
}
