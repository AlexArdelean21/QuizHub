import Link from "next/link"
import { ArrowRight, Building2, User } from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"

export const metadata = { title: "Creare cont — QuizHub" }

export default function SignupSelectorPage() {
  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-12 sm:px-6 md:py-16 lg:px-8 lg:py-20">
        <div className="self-center text-center">
          <h1 className="bg-gradient-to-r from-primary via-sky-400 to-blue-500 bg-clip-text text-3xl font-bold text-transparent md:text-4xl">
            QuizHub
          </h1>
          <p className="mt-3 text-sm text-muted-foreground md:text-base">
            Cum vrei să începi?
          </p>
        </div>

        <div className="grid w-full gap-5 md:grid-cols-2">
          <Card className="flex flex-col justify-between transition-shadow hover:shadow-md">
            <div>
              <CardHeader>
                <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <User className="size-6" />
                </div>
                <CardTitle className="mt-4 text-xl">Cont personal gratuit</CardTitle>
                <CardDescription className="mt-1">
                  Creează-ți propriul cont, poți susține examene și crea până la 2
                  examene proprii.
                </CardDescription>
              </CardHeader>
            </div>
            <CardContent>
              <Button asChild className="w-full">
                <Link href="/signup/user">
                  Creează cont personal
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="flex flex-col justify-between transition-shadow hover:shadow-md">
            <div>
              <CardHeader>
                <div className="flex size-12 items-center justify-center rounded-2xl bg-blue-500/10 text-blue-600 dark:text-blue-300">
                  <Building2 className="size-6" />
                </div>
                <CardTitle className="mt-4 text-xl">Organizație nouă</CardTitle>
                <CardDescription className="mt-1">
                  Înregistrează organizația ta pe QuizHub și gestionează utilizatori,
                  examene și rapoarte.
                </CardDescription>
              </CardHeader>
            </div>
            <CardContent>
              <Button asChild className="w-full bg-blue-600 text-white hover:bg-blue-500">
                <Link href="/signup/new-org">
                  Înregistrează organizația
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>

        <p className="self-center text-sm text-muted-foreground">
          Ai deja un cont?{" "}
          <Link
            href="/login"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Conectează-te
          </Link>
        </p>
      </main>
    </div>
  )
}
