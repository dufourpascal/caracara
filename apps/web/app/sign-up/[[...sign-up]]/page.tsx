import { SignUp } from "@clerk/nextjs"

export default function SignUpPage() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4 py-4 sm:px-6">
      <div className="w-full max-w-6xl border border-border bg-background p-4 sm:p-6">
        <SignUp forceRedirectUrl="/projects" />
      </div>
    </main>
  )
}
