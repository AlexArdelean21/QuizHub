import { PersonalSignupForm } from "@/components/signup/PersonalSignupForm"

export const metadata = { title: "Creare cont — QuizHub" }

export default function SignupPage() {
  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-12 sm:px-6 md:py-16 lg:px-8 lg:py-20">
        <div className="self-center text-center">
          <h1 className="bg-gradient-to-r from-primary via-sky-400 to-blue-500 bg-clip-text text-3xl font-bold text-transparent md:text-4xl">
            QuizHub
          </h1>
        </div>

        <PersonalSignupForm />
      </main>
    </div>
  )
}
